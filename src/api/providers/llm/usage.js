import { countTokens } from '../../../utils/tokenizer/index.js';

const count = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * Read actual API-reported usage, without character-count estimates. Do not add cache/reasoning details to totals twice.
 * OpenAI: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
 * Claude: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */
export function parseApiUsage(payload, protocol = 'openai') {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') return null;
  let input, output, total;
  if (protocol === 'claude') {
    const fields = [
      usage.input_tokens,
      usage.cache_creation_input_tokens ?? 0,
      usage.cache_read_input_tokens ?? 0,
    ];
    if (!fields.every(count)) return null;
    input = fields.reduce((sum, value) => sum + value, 0);
    output = usage.output_tokens;
    total = input + output;
  } else {
    input = usage.prompt_tokens;
    output = usage.completion_tokens;
    total = usage.total_tokens ?? input + output;
  }
  if (![input, output, total].every(count) || total < input + output) return null;
  return { input, output, total };
}

/** Prefer provider usage; when missing or invalid, tokenize locally in the background. Exclude keys and endpoint addresses. */
export async function resolveApiUsage(payload, protocol, requestBody) {
  const reported = parseApiUsage(payload, protocol);
  if (reported) return { ...reported, source: 'provider' };
  const body = JSON.parse(requestBody);
  const text = (content) =>
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => part.text || part.thinking || '').join('\n')
        : '';
  // Estimate message-boundary overhead using a generic chat format; hidden reasoning and wrappers are unknown locally.
  let input = 3 + countTokens(text(body.system));
  for (const message of body.messages || [])
    input += 3 + countTokens(message.role || '') + countTokens(text(message.content));
  const outputText =
    protocol === 'claude'
      ? text(payload?.content)
      : [
          text(payload?.choices?.[0]?.message?.content),
          payload?.choices?.[0]?.message?.reasoning_content || '',
        ].join('');
  const output = countTokens(outputText);
  return { input, output, total: input + output, source: 'local' };
}
