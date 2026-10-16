import { LLM_PRESETS } from '../presets.js';
import { buildLlmRequest, parseLlmResponse } from './openai-compatible.js';
import { validateProviderConfig } from '../config.js';
import { BatchAlignmentError } from '../shared/batch.js';
import { buildClaudeRequest, parseClaudeResponse } from './claude-compatible.js';
import { resolveApiUsage } from './usage.js';
import { thinkingPolicy, withThinking } from './thinking.js';
const PROTOCOLS = {
  openai: { build: buildLlmRequest, parse: parseLlmResponse },
  claude: { build: buildClaudeRequest, parse: parseClaudeResponse },
};

function buildBatch(texts, settings, session, config, id, build = buildLlmRequest) {
  const request = build(
    JSON.stringify(texts.map((text, id) => ({ id, text }))),
    settings,
    session,
    config,
  );
  const body = JSON.parse(request.init.body);
  const instruction =
    ' The user content is a JSON array of independent paragraphs with numeric ids. Translate each text. Return ONLY a JSON object {"translations":[{"id":0,"text":"translation"}]}, with every input id exactly once. Do not merge paragraphs or translate ids.';
  if (typeof body.system === 'string') body.system += instruction;
  else body.messages[0].content += instruction;
  request.init.body = JSON.stringify(body);
  return withThinking(request, id, config);
}
function parseBatch(payload, texts, parse = parseLlmResponse) {
  const content = parse(payload);
  let parsed;
  try {
    parsed = JSON.parse(content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1'));
  } catch {
    throw new BatchAlignmentError();
  }
  const items = parsed?.translations;
  if (!Array.isArray(items) || items.length !== texts.length) throw new BatchAlignmentError();
  const indexed = new Map();
  for (const item of items) {
    if (
      !Number.isInteger(item?.id) ||
      item.id < 0 ||
      item.id >= texts.length ||
      indexed.has(item.id) ||
      typeof item.text !== 'string' ||
      !item.text.trim()
    )
      throw new BatchAlignmentError();
    indexed.set(item.id, item.text.trim());
  }
  return texts.map((_text, id) => indexed.get(id));
}
export function createLlmAdapters() {
  const protocol = (id, config) =>
    id === 'custom' ? config?.protocol || 'openai' : LLM_PRESETS[id].protocol || 'openai';
  return Object.fromEntries(
    Object.keys(LLM_PRESETS).map((id) => [
      id,
      {
        chunkSize: 3500,
        batchLimits: { maxItems: 8, maxCharacters: 3500, separatorCharacters: 0 },
        requestTimeoutMs: (config) => (thinkingPolicy(id, config).enabled ? 60000 : 30000),
        language: (code) => code,
        validateConfig: (config) => validateProviderConfig(id, config),
        buildRequest: (text, settings, session, config) =>
          withThinking(
            PROTOCOLS[protocol(id, config)].build(text, settings, session, config),
            id,
            config,
          ),
        parseResponse: (payload, config) => PROTOCOLS[protocol(id, config)].parse(payload),
        parseUsage: (payload, config, requestBody) =>
          resolveApiUsage(payload, protocol(id, config), requestBody),
        buildBatchRequest: (texts, settings, session, config) =>
          buildBatch(texts, settings, session, config, id, PROTOCOLS[protocol(id, config)].build),
        parseBatchResponse: (payload, texts, config) =>
          parseBatch(payload, texts, PROTOCOLS[protocol(id, config)].parse),
      },
    ]),
  );
}
