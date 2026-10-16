import { extensionStore } from '../storage.js';
import { FREE_SERVICE_PRESETS } from '../../config/services/catalog.js';
import { DEFAULT_PREFERENCES } from '../../config/webpage/defaults.js';
import { PROVIDER_ICON_RESOURCES } from '../../config/icons/catalog.js';
import { isLanguageCode } from '../../i18n/languages/index.js';
import { LLM_PRESETS } from '../../api/providers/presets.js';
import { normalizeSiteRules, resolveSiteRules } from '../../plugins/sites/index.js';
import {
  normalizeSiteRuleOverrides,
  validateSiteRuleDefinitions,
} from '../../plugins/sites/site-rules/rule-schema.js';

/**
 * @typedef {Object} TranslationSettings
 * @property {string} provider The user's sole selected service; never switch external services automatically.
 * @property {string} sourceLanguage Source language code; auto delegates detection to the remote service.
 * @property {string} targetLanguage Target language code; auto is not allowed.
 */
export const PROVIDERS = {
  ...FREE_SERVICE_PRESETS,
  ...Object.fromEntries(
    Object.entries(LLM_PRESETS).map(([id, preset]) => [
      id,
      { label: preset.label, description: preset.description },
    ]),
  ),
};
export const DEFAULT_SETTINGS = {
  ...DEFAULT_PREFERENCES,
  siteRules: normalizeSiteRules(),
  siteRuleOverrides: null,
};
/** Recover missing or corrupt local storage, retaining only currently defined fields. */
export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    provider: Object.hasOwn(PROVIDERS, value.provider) ? value.provider : DEFAULT_SETTINGS.provider,
    customApiIcon: Object.hasOwn(PROVIDER_ICON_RESOURCES, value.customApiIcon)
      ? value.customApiIcon
      : DEFAULT_SETTINGS.customApiIcon,
    sourceLanguage: isLanguageCode(value.sourceLanguage, true)
      ? value.sourceLanguage
      : DEFAULT_SETTINGS.sourceLanguage,
    targetLanguage: isLanguageCode(value.targetLanguage)
      ? value.targetLanguage
      : DEFAULT_SETTINGS.targetLanguage,
    // Normalize switches against the effective catalog so browser-added/deleted rules need no extra settings fields.
    siteRules: normalizeSiteRules(value.siteRules, resolveSiteRules(value)),
    siteRuleOverrides: normalizeSiteRuleOverrides(value.siteRuleOverrides),
    selectionTranslation:
      typeof value.selectionTranslation === 'boolean'
        ? value.selectionTranslation
        : DEFAULT_SETTINGS.selectionTranslation,
    selectionTrigger: ['dot', 'icon', 'direct', 'ctrl', 'alt', 'shift'].includes(
      value.selectionTrigger,
    )
      ? value.selectionTrigger
      : DEFAULT_SETTINGS.selectionTrigger,
    hoverTranslation:
      typeof value.hoverTranslation === 'boolean'
        ? value.hoverTranslation
        : DEFAULT_SETTINGS.hoverTranslation,
    hoverTrigger: ['ctrl', 'shift', 'alt', 'hold', 'direct'].includes(value.hoverTrigger)
      ? value.hoverTrigger
      : DEFAULT_SETTINGS.hoverTrigger,
    hoverAction: ['toggle', 'translate', 'restore'].includes(value.hoverAction)
      ? value.hoverAction
      : DEFAULT_SETTINGS.hoverAction,
    displayMode: ['bilingual', 'translation-only'].includes(value.displayMode)
      ? value.displayMode
      : DEFAULT_SETTINGS.displayMode,
    translationStyle: ['none', 'underline', 'highlight'].includes(value.translationStyle)
      ? value.translationStyle
      : DEFAULT_SETTINGS.translationStyle,
    highlightSimilarLanguages:
      typeof value.highlightSimilarLanguages === 'boolean'
        ? value.highlightSimilarLanguages
        : DEFAULT_SETTINGS.highlightSimilarLanguages,
    configRevision:
      Number.isSafeInteger(value.configRevision) && value.configRevision >= 0
        ? value.configRevision
        : 0,
  };
}
export function validateSettings(settings, providers = PROVIDERS) {
  if (
    settings?.customApiIcon !== undefined &&
    !Object.hasOwn(PROVIDER_ICON_RESOURCES, settings.customApiIcon)
  )
    throw new Error('Select a valid API icon.');
  // Validate against the current UI catalog by default; background instances can inject adapters to independently validate future LLMs.
  if (!settings || !Object.hasOwn(providers, settings.provider))
    throw new Error('Choose a valid translation service.');
  if (!isLanguageCode(settings.sourceLanguage, true) || !isLanguageCode(settings.targetLanguage))
    throw new Error('Enter a valid language code, such as en, zh-CN, or ja.');
  if (settings.sourceLanguage === settings.targetLanguage)
    throw new Error(
      'Source and target languages are the same. Choose a different language or Auto-detect.',
    );
  // Strictly validate definitions on save; normalizeSettings tolerates errors only when reading old/corrupt storage.
  if (settings.siteRuleOverrides !== undefined && settings.siteRuleOverrides !== null)
    validateSiteRuleDefinitions(settings.siteRuleOverrides);
  if (
    settings.siteRules !== undefined &&
    (!settings.siteRules ||
      typeof settings.siteRules !== 'object' ||
      Array.isArray(settings.siteRules) ||
      Object.values(settings.siteRules).some((enabled) => typeof enabled !== 'boolean'))
  )
    throw new Error('Site rule switches must be on or off.');
  if (
    settings.selectionTranslation !== undefined &&
    typeof settings.selectionTranslation !== 'boolean'
  )
    throw new Error('The selection translation switch must be on or off.');
  if (settings.hoverTranslation !== undefined && typeof settings.hoverTranslation !== 'boolean')
    throw new Error('The hover translation switch must be on or off.');
  if (
    settings.selectionTrigger !== undefined &&
    !['dot', 'icon', 'direct', 'ctrl', 'alt', 'shift'].includes(settings.selectionTrigger)
  )
    throw new Error('Choose a valid selection trigger.');
  if (
    settings.hoverTrigger !== undefined &&
    !['ctrl', 'shift', 'alt', 'hold', 'direct'].includes(settings.hoverTrigger)
  )
    throw new Error('Choose a valid hover trigger.');
  if (
    settings.hoverAction !== undefined &&
    !['toggle', 'translate', 'restore'].includes(settings.hoverAction)
  )
    throw new Error('Choose a valid hover action.');
  if (
    settings.displayMode !== undefined &&
    !['bilingual', 'translation-only'].includes(settings.displayMode)
  )
    throw new Error('Choose bilingual or translation only.');
  if (
    settings.translationStyle !== undefined &&
    !['none', 'underline', 'highlight'].includes(settings.translationStyle)
  )
    throw new Error('Choose a valid translation style.');
  if (
    settings.highlightSimilarLanguages !== undefined &&
    typeof settings.highlightSimilarLanguages !== 'boolean'
  )
    throw new Error('The related-language background switch must be on or off.');
  return settings;
}
export async function loadSettings() {
  const { settings } = await extensionStore().get('settings');
  return normalizeSettings(settings);
}
export async function saveSettings(settings) {
  validateSettings(settings);
  const normalized = normalizeSettings(settings);
  validateSettings(normalized);
  await extensionStore().set({ settings: normalized });
  return normalized;
}
/**
 * Page-visible settings boundary: retain preferences, site switches, and configRevision; remove complete rule definitions.
 * The background separately returns current-site execution settings based on sender.url; pages need no other sites' rules.
 * Definition changes increment configRevision so stale runs are rejected even with identical public preferences.
 * Private endpoints, model configuration, and keys are never part of this object and cannot cross this boundary.
 */
export function publicSettings(settings) {
  const { siteRuleOverrides, ...preferences } = normalizeSettings(settings);
  return preferences;
}
