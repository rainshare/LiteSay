import { extensionStore } from '../storage.js';
import { LLM_PRESETS } from '../../api/providers/presets.js';

const counters = ['input', 'output', 'total', 'requests', 'reported', 'estimated', 'missing'];
const empty = () => Object.fromEntries(counters.map((field) => [field, 0]));
const valid = (value) => Number.isSafeInteger(value) && value >= 0;

/** Store only provider, model, and cumulative usage, not keys, endpoints, or source text. Serialize updates to avoid lost concurrent counts. */
export function createUsageStore({ storage = extensionStore(), now = Date.now } = {}) {
  let tail = Promise.resolve();
  const serial = (task) => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
  async function read() {
    const { apiUsage } = await storage.get('apiUsage');
    return {
      since: valid(apiUsage?.since) ? apiUsage.since : now(),
      entries: (Array.isArray(apiUsage?.entries) ? apiUsage.entries : [])
        .filter(
          (entry) =>
            Object.hasOwn(LLM_PRESETS, entry?.provider) &&
            typeof entry.model === 'string' &&
            counters.every((field) => valid(entry[field])) &&
            valid(entry.lastUsedAt),
        )
        .map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          ...Object.fromEntries(counters.map((field) => [field, entry[field]])),
          lastUsedAt: entry.lastUsedAt,
        })),
    };
  }
  const add = (totals, entry) => {
    for (const field of counters) totals[field] += entry[field];
  };
  return {
    record({ provider, model, usage }) {
      return serial(async () => {
        if (
          !Object.hasOwn(LLM_PRESETS, provider) ||
          typeof model !== 'string' ||
          !model.trim() ||
          model.length > 256
        )
          throw new Error('Invalid service or model for API usage.');
        const state = await read();
        let entry = state.entries.find(
          (item) => item.provider === provider && item.model === model,
        );
        if (!entry) {
          entry = { provider, model, ...empty(), lastUsedAt: now() };
          state.entries.push(entry);
        }
        entry.requests++;
        if (usage && ['input', 'output', 'total'].every((field) => valid(usage[field]))) {
          for (const field of ['input', 'output', 'total']) entry[field] += usage[field];
          entry[usage.source === 'local' ? 'estimated' : 'reported']++;
        } else entry.missing++;
        entry.lastUsedAt = now();
        await storage.set({ apiUsage: state });
      });
    },
    summary() {
      return serial(async () => {
        const state = await read();
        const summary = { since: state.since, totals: empty(), providers: {} };
        for (const entry of state.entries) {
          const provider = (summary.providers[entry.provider] ||= { ...empty(), models: [] });
          add(provider, entry);
          add(summary.totals, entry);
          provider.models.push(entry);
        }
        return summary;
      });
    },
    reset(provider) {
      return serial(async () => {
        if (provider !== undefined && !Object.hasOwn(LLM_PRESETS, provider))
          throw new Error('Choose a valid translation service.');
        const state = await read();
        state.entries = provider
          ? state.entries.filter((entry) => entry.provider !== provider)
          : [];
        if (!provider) state.since = now();
        await storage.set({ apiUsage: state });
      });
    },
  };
}
