import { LLM_PRESETS, defaultProviderConfigs } from './presets.js';
import { MODEL_CATALOG, CUSTOM_REASONING_PROTOCOLS } from '../../config/services/catalog.js';
import { thinkingPolicy } from './llm/thinking.js';
import { validateLlmConfig } from './llm/openai-compatible.js';

/** Private background configuration uses TRUSTED_CONTEXTS storage access; never include it in publicSettings(). */
export function normalizeProviderConfigs(value = {}) {
  const result = defaultProviderConfigs();
  for (const [id, defaults] of Object.entries(result)) {
    const input = value?.[id];
    if (!input || typeof input !== 'object') continue;
    for (const field of [
      'endpoint',
      'model',
      'apiKey',
      'thinkingProtocol',
      'protocol',
      'reasoningLevel',
    ])
      if (typeof input[field] === 'string') defaults[field] = input[field].trim();
    defaults.thinking = input.thinking === true;
    // Presets control fixed-service protocols; custom services can choose their reasoning parameter format.
    if (id !== 'custom') {
      // Official services use only the current static catalog; stored values must not reintroduce custom model names.
      if (!MODEL_CATALOG.providers[id].models.includes(defaults.model))
        defaults.model = LLM_PRESETS[id].model;
      defaults.thinkingProtocol = LLM_PRESETS[id].thinkingProtocol;
      defaults.protocol = LLM_PRESETS[id].protocol || 'openai';
    }
    if (id === 'custom' && defaults.protocol === 'claude') {
      defaults.thinkingProtocol = 'none';
      defaults.thinking = false;
      defaults.reasoningLevel = 'off';
    }
    const policy = thinkingPolicy(id, defaults);
    defaults.reasoningLevel = policy.levelId;
    defaults.thinking = policy.enabled;
  }
  return result;
}
export function validateProviderConfig(
  id,
  config,
  requireKey = true,
  { allowEmptyModel = false } = {},
) {
  if (!LLM_PRESETS[id]) return; // Free services require no private configuration.
  validateLlmConfig(config, { allowEmptyModel });
  if (!['openai', 'claude'].includes(config.protocol || LLM_PRESETS[id].protocol || 'openai'))
    throw new Error('Select the OpenAI or Claude API protocol.');
  if (id === 'custom' && !Object.hasOwn(CUSTOM_REASONING_PROTOCOLS, config.thinkingProtocol))
    throw new Error('Choose a valid reasoning protocol.');
  if (requireKey && LLM_PRESETS[id].needsKey && !config.apiKey?.trim())
    throw new Error(`Enter the ${LLM_PRESETS[id].label} API key in Translation services first.`);
}
