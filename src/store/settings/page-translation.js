import { extensionStore } from '../storage.js';

/** Store full-page enablement separately; navigation and settings saves preserve it, and it does not enter translation cache signatures. */
export async function loadPageTranslationEnabled() {
  const { pageTranslationEnabled } = await extensionStore().get('pageTranslationEnabled');
  return pageTranslationEnabled === true;
}

export async function savePageTranslationEnabled(enabled) {
  if (typeof enabled !== 'boolean')
    throw new Error('The page translation switch must be on or off.');
  await extensionStore().set({ pageTranslationEnabled: enabled });
  return enabled;
}
