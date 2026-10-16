/**
 * Split by Unicode characters, preferring sentence boundaries.
 * Rejoining all chunks must exactly reproduce the source, without truncating text or splitting emoji surrogate pairs.
 */
export function splitText(text, limit = 900) {
  const points = [...text];
  const chunks = [];
  for (let start = 0; start < points.length; ) {
    let end = Math.min(start + limit, points.length);
    if (end < points.length) {
      for (let i = end - 1; i > start + limit / 2; i--) {
        if (/[\n。！？.!?]/u.test(points[i])) {
          end = i + 1;
          break;
        }
      }
    }
    chunks.push(points.slice(start, end).join(''));
    start = end;
  }
  return chunks;
}

/**
 * Recognize emoji as complete graphemes, including skin tones, flags, and ZWJ families; handles are also protected.
 * Restore these fragments locally, sending only surrounding natural language without relying on returned placeholders.
 */
export function protectedTextParts(text, { preserveMentions = false } = {}) {
  const parts = [];
  const mention = /(?<![\w@])@[A-Za-z0-9_]{1,15}(?![A-Za-z0-9_])/g;
  const protectEmoji = (value) => {
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
      value,
    )) {
      const literal = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(segment);
      const previous = parts.at(-1);
      if (previous && previous.literal === literal) previous.text += segment;
      else parts.push({ text: segment, literal });
    }
  };
  let offset = 0;
  // Restore DOM-generated link markers locally; the service need not recognize or return placeholders.
  const markupToken = /[\uE000\uE002\uE004\uE006]\d+:\d+[\uE001\uE003\uE005\uE007]/gu;
  if (markupToken.test(text)) {
    markupToken.lastIndex = 0;
    for (const match of text.matchAll(markupToken)) {
      parts.push(...protectedTextParts(text.slice(offset, match.index), { preserveMentions }));
      parts.push({ text: match[0], literal: true });
      offset = match.index + match[0].length;
    }
    parts.push(...protectedTextParts(text.slice(offset), { preserveMentions }));
    return parts;
  }
  if (!preserveMentions) {
    protectEmoji(text);
    return parts;
  }
  for (const match of text.matchAll(mention)) {
    protectEmoji(text.slice(offset, match.index));
    parts.push({ text: match[0], literal: true });
    offset = match.index + match[0].length;
  }
  protectEmoji(text.slice(offset));
  return parts;
}
