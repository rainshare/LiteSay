import { LLM_SERVICE_PRESETS } from '../../config/services/catalog.js';
/** Public presets are generated from config/services/<provider>/service.json and contain no keys. */
export const LLM_PRESETS = LLM_SERVICE_PRESETS;
export function defaultProviderConfigs() {
  return Object.fromEntries(
    Object.entries(LLM_PRESETS).map(([id, preset]) => [
      id,
      {
        endpoint: preset.endpoint,
        model: preset.model,
        protocol: preset.protocol || 'openai',
        apiKey: '',
        thinking: false,
        thinkingProtocol: preset.thinkingProtocol,
      },
    ]),
  );
}
