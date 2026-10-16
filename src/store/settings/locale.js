import { extensionStore } from '../storage.js';
import { isUiLocale, normalizeUiLocale } from '../../i18n/engine/locale.js';

// Interface language is independent of translation preferences and request signatures.
export async function loadUiLocale() {
  const { uiLocale } = await extensionStore().get('uiLocale');
  return normalizeUiLocale(uiLocale);
}
export async function saveUiLocale(uiLocale) {
  if (!isUiLocale(uiLocale)) throw new Error('Choose a registered interface language.');
  await extensionStore().set({ uiLocale });
  return uiLocale;
}
