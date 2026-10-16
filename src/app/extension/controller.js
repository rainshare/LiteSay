import {
  loadSettings,
  saveSettings,
  publicSettings,
  validateSettings,
  PROVIDERS,
} from '../../store/settings/index.js';
import { createTranslator } from '../../api/translation/translator.js';
import { createPageRuns } from './task-runs.js';
import { checkAbort } from '../../utils/async/cancellation.js';
import { siteFilterConfig, siteTranslationPolicy } from '../../plugins/sites/index.js';
import { createProviderStore } from '../../store/providers/index.js';
import { createTranslationCache } from '../../store/cache/index.js';
import { createUsageStore } from '../../store/usage/index.js';
import { loadUiLocale, saveUiLocale } from '../../store/settings/locale.js';
import {
  loadPageTranslationEnabled,
  savePageTranslationEnabled,
} from '../../store/settings/page-translation.js';

/**
 * Shared application layer for translation tasks, configuration, and cancellation; the platform injects browser events and sender validation.
 * Separate modules handle requests, caching, and protocol parsing; temporary sessions never return to content scripts.
 */
export function createExtensionController({ storageReady, broadcast, openOptions }) {
  const translationCache = createTranslationCache();
  const usageStore = createUsageStore();
  const translator = createTranslator({ cacheStore: translationCache, onUsage: usageStore.record });
  const pageRuns = createPageRuns();
  // Use three run registries per document so selection closure, paragraph restoration, and full-page cancellation remain independent.
  const selectionRuns = createPageRuns();
  const paragraphRuns = createPageRuns();
  const providerStore = createProviderStore();
  const publicProviderCatalog = Object.entries(PROVIDERS).map(([id, provider]) => ({
    id,
    label: provider.label,
  }));
  storageReady.catch(() => {});
  function removeTab(tabId) {
    pageRuns.removeTab(tabId);
    selectionRuns.removeTab(tabId);
    paragraphRuns.removeTab(tabId);
  }
  async function installed() {
    await storageReady;
    await saveSettings(await loadSettings());
  }
  async function handle(message, sender, { trusted = false } = {}) {
    await storageReady;
    switch (message.type) {
      case 'GET_UI_LOCALE':
        return { uiLocale: await loadUiLocale() };
      case 'SET_UI_LOCALE':
        if (trusted || (sender.tab && sender.frameId === 0)) {
          const uiLocale = await saveUiLocale(message.uiLocale);
          await broadcast('UI_LOCALE_CHANGED');
          return { uiLocale };
        }
        break;
      case 'GET_PUBLIC_SETTINGS': {
        const settings = await loadSettings();
        return {
          pageTranslationEnabled: await loadPageTranslationEnabled(),
          uiLocale: await loadUiLocale(),
          settings: publicSettings(settings),
          providerLabel: PROVIDERS[settings.provider].label,
          providers: publicProviderCatalog,
          siteRules: siteFilterConfig(sender.url, settings),
        };
      }
      case 'CHECK_READY': {
        const settings = await loadSettings();
        validateSettings(settings);
        await providerStore.ready(settings.provider);
        return {
          pageTranslationEnabled: await loadPageTranslationEnabled(),
          settings: publicSettings(settings),
          providerLabel: PROVIDERS[settings.provider].label,
          providers: publicProviderCatalog,
          siteRules: siteFilterConfig(sender.url, settings),
        };
      }
      case 'SET_PAGE_TRANSLATION_ENABLED':
        if (trusted || (sender.tab && sender.frameId === 0)) {
          const pageTranslationEnabled = await savePageTranslationEnabled(message.enabled);
          await broadcast('PAGE_TRANSLATION_CHANGED');
          return { pageTranslationEnabled };
        }
        break;
      case 'UPDATE_PUBLIC_SETTINGS': {
        const settings = await loadSettings();
        const patch = message.settings || {};
        for (const field of [
          'provider',
          'sourceLanguage',
          'targetLanguage',
          'displayMode',
          'translationStyle',
          'selectionTrigger',
          'hoverTrigger',
          'hoverAction',
        ])
          if (typeof patch[field] === 'string') settings[field] = patch[field];
        // Ordinary pages may only change site enablement; definitions and domains require SAVE_SETTINGS from the trusted settings page.
        // Ignore patch.siteRuleOverrides and retain the current custom rules returned by loadSettings.
        if (patch.siteRules !== undefined) settings.siteRules = patch.siteRules;
        if (typeof patch.selectionTranslation === 'boolean')
          settings.selectionTranslation = patch.selectionTranslation;
        if (typeof patch.hoverTranslation === 'boolean')
          settings.hoverTranslation = patch.hoverTranslation;
        if (typeof patch.highlightSimilarLanguages === 'boolean')
          settings.highlightSimilarLanguages = patch.highlightSimilarLanguages;
        await saveSettings(settings);
        const saved = await loadSettings();
        await broadcast('PUBLIC_SETTINGS_CHANGED');
        return { settings: publicSettings(saved), siteRules: siteFilterConfig(sender.url, saved) };
      }
      case 'TRANSLATE_PARAGRAPH':
      case 'TRANSLATE_TEXT': {
        if (!sender.tab || sender.frameId !== 0)
          throw new Error('Only the main document of the current page is supported.');
        // Selection translation independently manages requests with an epoch; retain compatibility with existing requests without one.
        const signal =
          message.epoch === undefined
            ? undefined
            : (message.type === 'TRANSLATE_PARAGRAPH' ? paragraphRuns : selectionRuns).signal(
                sender,
                message.epoch,
              );
        const settings = await loadSettings();
        checkAbort(signal);
        if (
          signal &&
          !(message.type === 'TRANSLATE_PARAGRAPH'
            ? settings.hoverTranslation
            : settings.selectionTranslation)
        )
          throw new Error('This text translation entry point is disabled.');
        // Reject stale runs after another page changes settings, avoiding mixed services or languages within one translation run.
        if (message.signature !== JSON.stringify(publicSettings(settings)))
          throw new Error('Translation settings changed. Start the translation again.');
        return {
          text: await translator.translate(
            message.text,
            { ...settings, ...siteTranslationPolicy(sender.url, settings) },
            await providerStore.runtime(settings.provider),
            { signal },
          ),
        };
      }
      case 'TRANSLATE_BATCH': {
        // Register the run before awaiting storage so a concurrent cancellation can immediately abort its requests.
        const signal = pageRuns.signal(sender, message.epoch);
        const settings = await loadSettings();
        checkAbort(signal);
        if (message.signature !== JSON.stringify(publicSettings(settings)))
          throw new Error('Translation settings changed. Start the translation again.');
        const config = await providerStore.runtime(settings.provider);
        checkAbort(signal);
        return {
          results: await translator.translateMany(
            message.texts,
            { ...settings, ...siteTranslationPolicy(sender.url, settings) },
            config,
            { signal },
          ),
        };
      }
      case 'CANCEL_TRANSLATION':
        pageRuns.cancel(sender, message.epoch);
        return {};
      case 'CANCEL_SELECTION':
        selectionRuns.cancel(sender, message.epoch);
        return {};
      case 'CANCEL_PARAGRAPH':
        paragraphRuns.cancel(sender, message.epoch);
        return {};
      case 'GET_SETTINGS':
        if (trusted)
          return {
            settings: await loadSettings(),
            providerConfigs: await providerStore.metadata(),
          };
        break;
      case 'GET_API_USAGE':
        if (trusted) return { usage: await usageStore.summary() };
        break;
      case 'RESET_API_USAGE':
        if (trusted) {
          await usageStore.reset(message.provider);
          return { usage: await usageStore.summary() };
        }
        break;
      case 'GET_CACHE_INFO':
        if (trusted) return { cache: await translationCache.stats() };
        break;
      case 'CLEAR_CACHE':
        if (trusted) {
          pageRuns.cancelAll();
          selectionRuns.cancelAll();
          paragraphRuns.cancelAll();
          await translator.clearCache();
          await broadcast('CACHE_CLEARED');
          return { cache: await translationCache.stats() };
        }
        break;
      case 'SAVE_SETTINGS':
        if (trusted) {
          validateSettings(message.settings);
          const saved = await providerStore.save(message.settings, message.providerConfigs);
          pageRuns.cancelAll();
          selectionRuns.cancelAll();
          paragraphRuns.cancelAll();
          await broadcast('PUBLIC_SETTINGS_CHANGED');
          // Cache keys include service, languages, and private configuration digests; display/filter changes must not clear successful translations.
          return saved;
        }
        break;
      case 'TEST_SERVICE':
        if (trusted)
          return {
            text: await translator.testConnection(
              'Hello! Welcome to a world without language barriers.',
              message.settings,
              await providerStore.runtime(message.settings?.provider, message.providerConfig),
            ),
          };
        break;
      case 'OPEN_OPTIONS':
        await openOptions();
        return {};
    }
    throw new Error('Unsupported action.');
  }

  return { handle, removeTab, installed };
}
