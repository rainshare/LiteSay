/**
 * Multi-paragraph request utilities for free web endpoints. Source and translation arrays always align by position.
 * Free endpoints delimit paragraphs with line breaks; LLMs use a separate JSON protocol with IDs.
 * Do not cache misaligned results or amplify requests by resending every paragraph individually.
 */
export class BatchAlignmentError extends Error {
  constructor() {
    super('The service returned a different number of paragraphs.');
    this.name = 'BatchAlignmentError';
  }
}
export function joinParagraphs(texts) {
  return texts.join('\n\n');
}
export function splitParagraphs(translation, count) {
  // Bing often collapses two line breaks into one; also support CRLF and preserve actual paragraph boundaries.
  const parts = translation
    .trim()
    .split(/\r?\n+/)
    .map((part) => part.trim());
  if (parts.length !== count || parts.some((part) => !part)) throw new BatchAlignmentError();
  return parts;
}

/** Split long text within protocol budgets; enforce encoding limits for each unit to avoid oversized queries. */
export function splitBatchText(text, limits) {
  const points = [...text],
    chunks = [];
  for (let start = 0; start < points.length; ) {
    let end = start,
      chars = 0,
      encoded = 0;
    while (end < points.length) {
      const point = points[end];
      const bytes = limits.maxEncodedLength ? encodeURIComponent(point).length : 0;
      if (
        chars + point.length > limits.maxCharacters ||
        encoded + bytes > (limits.maxEncodedLength || Infinity)
      )
        break;
      chars += point.length;
      encoded += bytes;
      end++;
    }
    if (end === start) throw new Error('The service batch limit cannot fit a single character.');
    if (end < points.length) {
      for (let index = end - 1; index > start + (end - start) / 2; index--) {
        if (/[。！？.!?]/u.test(points[index])) {
          end = index + 1;
          break;
        }
      }
    }
    chunks.push(points.slice(start, end).join(''));
    start = end;
  }
  return chunks;
}

/** Inputs are {text,...} units already within individual budgets; each protocol declares delimiter overhead. */
export function packParagraphs(items, limits) {
  const groups = [];
  let group = [];
  let chars = 0,
    encoded = 0;
  const flush = () => {
    if (group.length) groups.push(group);
    group = [];
    chars = 0;
    encoded = 0;
  };
  for (const item of items) {
    const length = item.text.length;
    const bytes = limits?.maxEncodedLength ? encodeURIComponent(item.text).length : 0;
    if (
      !limits ||
      /[\r\n]/.test(item.text) ||
      length > limits.maxCharacters ||
      bytes > (limits.maxEncodedLength || Infinity)
    ) {
      flush();
      groups.push([item]);
      continue;
    }
    const separator = group.length ? (limits.separatorCharacters ?? 2) : 0;
    if (
      group.length >= limits.maxItems ||
      chars + length + separator > limits.maxCharacters ||
      encoded + bytes + separator * 3 > (limits.maxEncodedLength || Infinity)
    )
      flush();
    chars += length + (group.length ? (limits.separatorCharacters ?? 2) : 0);
    encoded += bytes + (group.length ? (limits.separatorCharacters ?? 2) * 3 : 0);
    group.push(item);
  }
  flush();
  return groups;
}
