import { MODEL_CATALOG, CUSTOM_REASONING_PROTOCOLS } from '../../../config/services/catalog.js';

/** Provider, model, level, and parameters come from separate configuration; UI and requests share the same rules. */
export function thinkingPolicy(id, config) {
  const profile =
    id === 'custom'
      ? CUSTOM_REASONING_PROTOCOLS[config.thinkingProtocol] || CUSTOM_REASONING_PROTOCOLS.none
      : MODEL_CATALOG.providers[id].reasoning[config.model];
  const levels = profile.levels;
  const requested =
    config.reasoningLevel ?? (config.thinking ? levels.find((level) => level.enabled)?.id : 'off');
  const level =
    levels.find((entry) => entry.id === requested) ||
    levels.find((entry) => entry.id === profile.defaultLevel);
  return {
    profile,
    levels,
    level,
    levelId: level.id,
    canDisable: levels.some((entry) => !entry.enabled),
    enabled: level.enabled,
    visible: levels.some((entry) => entry.enabled),
  };
}

export function withThinking(request, id, config) {
  const { level } = thinkingPolicy(id, config);
  request.init.body = JSON.stringify({ ...JSON.parse(request.init.body), ...level.body });
  return request;
}
