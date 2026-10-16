import { extensionStore } from '../storage.js';
import { LLM_PRESETS } from '../../api/providers/presets.js';
import { normalizeProviderConfigs, validateProviderConfig } from '../../api/providers/config.js';
import { normalizeSettings, validateSettings } from '../settings/index.js';
import { createKeyVault } from './key-vault.js';

/** Private storage boundary: UI receives configuration and hasKey only; pages receive no profiles. */
export function createProviderStore({ storage = extensionStore(), vault = createKeyVault() } = {}) {
  let tail = Promise.resolve();
  // Serialize saves and reads so stale reads cannot overwrite newly saved keys.
  const serialized = (work) => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
  async function readStored() {
    const { providerConfigs = {} } = await storage.get('providerConfigs');
    const normalized = normalizeProviderConfigs(providerConfigs);
    for (const [id, config] of Object.entries(normalized)) {
      const previous = providerConfigs?.[id];
      config.encryptedKey = previous?.encryptedKey || null;
      delete config.apiKey;
    }
    return normalized;
  }
  const redact = (configs) =>
    Object.fromEntries(
      Object.entries(configs).map(([id, { encryptedKey, ...profile }]) => [
        id,
        { ...profile, hasKey: Boolean(encryptedKey) },
      ]),
    );
  async function runtime(id, draft) {
    if (!LLM_PRESETS[id]) return {};
    const stored = (await readStored())[id];
    const config = normalizeProviderConfigs({ [id]: { ...stored, ...draft } })[id];
    if (draft?.clearKey === true) config.apiKey = '';
    // Use a newly entered key for testing; blank means retain the saved key. Decrypt only the required service here.
    else if (!config.apiKey) config.apiKey = await vault.decrypt(stored.encryptedKey, id);
    validateProviderConfig(id, config);
    return config;
  }
  return {
    metadata: () => serialized(async () => redact(await readStored())),
    ready: (id) =>
      serialized(async () => {
        if (!LLM_PRESETS[id]) return;
        const config = (await readStored())[id];
        validateProviderConfig(id, config, false);
        if (LLM_PRESETS[id].needsKey && !config.encryptedKey)
          throw new Error(
            `Enter the ${LLM_PRESETS[id].label} API key in Translation services first.`,
          );
      }),
    runtime: (id, draft) => serialized(() => runtime(id, draft)),
    save: (settings, updates = {}) =>
      serialized(async () => {
        validateSettings(settings);
        const stored = await readStored();
        const merged = normalizeProviderConfigs(
          Object.fromEntries(
            Object.keys(LLM_PRESETS).map((id) => [id, { ...stored[id], ...updates[id] }]),
          ),
        );
        for (const [id, config] of Object.entries(merged)) {
          validateProviderConfig(id, config, false, {
            allowEmptyModel: id === 'custom',
          });
          config.encryptedKey = updates[id]?.clearKey === true ? null : stored[id].encryptedKey;
          if (config.apiKey) config.encryptedKey = await vault.encrypt(config.apiKey, id);
          delete config.apiKey;
        }
        if (LLM_PRESETS[settings.provider]?.needsKey && !merged[settings.provider].encryptedKey)
          throw new Error(`Enter the ${LLM_PRESETS[settings.provider].label} API key first.`);
        // Write public preferences and encrypted profiles together; failures must not leave a partial configuration.
        const normalized = normalizeSettings(settings);
        // Return a nonsensitive revision with public preferences so stale page runs detect private model/key changes.
        const previousSettings = normalizeSettings((await storage.get('settings')).settings);
        // Rule definitions are outside public settings, so edits/deletions/resets notify stale page runs through the revision.
        // Compare complete normalized definitions; repeated saves do not increment the revision, while public preferences distinguish display changes.
        // Persist revision and configuration together, then cancel in-flight tasks and broadcast at the message entry point to avoid partial settings.
        normalized.configRevision =
          previousSettings.configRevision +
          (JSON.stringify(stored) === JSON.stringify(merged) &&
          JSON.stringify(previousSettings.siteRuleOverrides) ===
            JSON.stringify(normalized.siteRuleOverrides)
            ? 0
            : 1);
        await storage.set({ settings: normalized, providerConfigs: merged });
        return { settings: normalized, providerConfigs: redact(merged) };
      }),
  };
}
