/**
 * Claude Messages-compatible protocol; constructs and parses data without network or private configuration access.
 * Reference: https://platform.claude.com/docs/en/api/http/messages/create
 */
import { buildLlmRequest } from './openai-compatible.js';
export function buildClaudeRequest(text, settings, session, config) {
  const request = buildLlmRequest(text, settings, session, config);
  const common = JSON.parse(request.init.body);
  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (config.apiKey) headers['x-api-key'] = config.apiKey;
  request.init.headers = headers;
  request.init.body = JSON.stringify({
    model: common.model,
    stream: false,
    max_tokens: 8192,
    system: common.messages[0].content,
    messages: common.messages.slice(1),
  });
  return request;
}
export function parseClaudeResponse(payload) {
  if (payload?.stop_reason === 'max_tokens')
    throw new Error(
      'The model output was cut off. Raise its output limit or translate smaller paragraphs.',
    );
  if (payload?.stop_reason === 'refusal')
    throw new Error('The model declined this translation. Switch services.');
  if (
    payload?.stop_reason === 'tool_use' ||
    payload?.content?.some((block) => block.type === 'tool_use')
  )
    throw new Error('The model returned a tool call instead of a translation. Check its settings.');
  if (!Array.isArray(payload?.content))
    throw new Error('The model returned no translation. Check the endpoint type and model.');
  const text = payload.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text)
    throw new Error('The model returned no translation. Check the endpoint type and model.');
  return text;
}
