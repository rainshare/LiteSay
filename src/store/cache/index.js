import { extensionStore } from '../storage.js';
const STORAGE_KEY = 'translationCacheV2';
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Local translation cache survives page refreshes, background suspension/restart, and browser restarts.
 * Store only content/configuration SHA-256 indexes and successful translations, not source text, URLs, session credentials, or API keys.
 * The fixed seven-day validity does not renew on reads; evict by LRU when capacity is exceeded.
 * Caller hashes isolate services, languages, private settings, and site text policy, without URL or DOM-node keys.
 */
export function createTranslationCache({
  storage = extensionStore(),
  maxEntries = 1500,
  maxBytes = Math.floor((storage.QUOTA_BYTES || 1000000) * 0.65),
  ttlMs = CACHE_TTL_MS,
  now = Date.now,
} = {}) {
  const entries = new Map();
  let bytes = 0,
    revision = 0,
    written = 0,
    pendingWrite;
  const sizeOf = (key, value) => (key.length + value.text.length) * 4 + 80;
  const expired = (entry) =>
    !Number.isFinite(entry?.createdAt) ||
    entry.createdAt > now() ||
    now() - entry.createdAt >= ttlMs;
  const remove = (key) => {
    if (!entries.has(key)) return;
    bytes -= sizeOf(key, entries.get(key));
    entries.delete(key);
  };
  const insert = (key, value) => {
    remove(key);
    entries.set(key, value);
    bytes += sizeOf(key, value);
    while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
  };
  function pruneExpired() {
    let removed = false;
    for (const [key, entry] of entries)
      if (expired(entry)) {
        remove(key);
        removed = true;
      }
    if (removed) revision++;
    return removed;
  }
  const ready = storage.get(STORAGE_KEY).then(async (stored) => {
    if (!Array.isArray(stored[STORAGE_KEY])) return;
    for (const entry of stored[STORAGE_KEY]) {
      if (
        Array.isArray(entry) &&
        /^[a-f0-9]{64}$/.test(entry[0]) &&
        typeof entry[1]?.text === 'string' &&
        !expired(entry[1])
      )
        insert(entry[0], entry[1]);
    }
    // Discard expired or oversized data at startup; background restarts must not grant another full seven-day validity period.
    revision++;
    await persist();
  });
  // Coalesce concurrent paragraph writes into snapshots; if results arrive during a write, persist another revision without dropping the tail.
  function persist() {
    if (!pendingWrite) {
      pendingWrite = Promise.resolve()
        .then(async () => {
          while (written < revision) {
            const version = revision;
            await storage.set({ [STORAGE_KEY]: [...entries] });
            written = version;
          }
        })
        .finally(() => {
          pendingWrite = null;
        });
    }
    return pendingWrite;
  }
  return {
    ttlMs,
    async stats() {
      await ready;
      if (pruneExpired()) await persist();
      return { entries: entries.size, bytes, maxBytes, ttlMs };
    },
    async getEntry(key) {
      await ready;
      const value = entries.get(key);
      if (value && expired(value)) {
        remove(key);
        revision++;
        await persist();
        return undefined;
      }
      if (value !== undefined) insert(key, value);
      return value && { ...value };
    },
    async get(key) {
      return (await this.getEntry(key))?.text;
    },
    async put(key, value) {
      await ready;
      pruneExpired();
      insert(key, { text: value, createdAt: now() });
      revision++;
      await persist();
    },
    async clear() {
      await ready;
      entries.clear();
      bytes = 0;
      revision++;
      await persist();
    },
  };
}
