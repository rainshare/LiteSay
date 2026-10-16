import { t } from '../../i18n/engine/index.js';

/** Browser events, document injection and sender authentication stay in the platform layer. */
export function messageSource(api, sender) {
  if (sender.id !== api.runtime.id) throw new Error('Invalid message source.');
  const settingsUrl = api.runtime.getURL(api.runtime.getManifest().options_page);
  return { trusted: sender.url?.split(/[?#]/, 1)[0] === settingsUrl };
}

export async function broadcast(api, type) {
  const tabs = await api.tabs.query({});
  await Promise.all(tabs.map((tab) => api.tabs.sendMessage(tab.id, { type }).catch(() => {})));
}

export async function sendPageAction(api, tabId, action) {
  if (!tabId) throw new Error('The current page was not found.');
  try {
    return await api.tabs.sendMessage(tabId, { type: 'PAGE_ACTION', action });
  } catch {
    try {
      // The manifest is the single source for both automatic and fallback injection.
      const content = api.runtime.getManifest().content_scripts[0];
      await api.scripting.insertCSS({ target: { tabId }, files: content.css });
      await api.scripting.executeScript({ target: { tabId }, files: content.js });
      return await api.tabs.sendMessage(tabId, { type: 'PAGE_ACTION', action });
    } catch {
      throw new Error(
        'This page cannot be translated. Use a normal HTTP or HTTPS page; browser internal pages, extension stores, and PDFs are not supported.',
      );
    }
  }
}

export function bindExtensionEvents(api, controller) {
  api.tabs.onRemoved.addListener(controller.removeTab);
  api.runtime.onInstalled.addListener(() => controller.installed().catch(() => {}));
  api.action.onClicked.addListener((tab) => {
    sendPageAction(api, tab.id, 'toggle')
      .then(async (result) => {
        if (result?.error) await api.runtime.openOptionsPage();
      })
      .catch(async () => {
        await api.action.setBadgeText({ tabId: tab.id, text: '!' });
        await api.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#e44785' });
        const { uiLocale } = await controller.handle({ type: 'GET_UI_LOCALE' }, {});
        await api.action.setTitle({
          tabId: tab.id,
          title: t('errors.actionUnsupportedTitle', {}, uiLocale),
        });
      });
  });
  api.runtime.onMessage.addListener((message, sender, respond) => {
    Promise.resolve()
      .then(() => controller.handle(message || {}, sender, messageSource(api, sender)))
      .then(
        (value) => respond({ ok: true, ...value }),
        (error) =>
          respond({
            ok: false,
            error: error.message || 'The action failed. Please retry.',
            ...(error.retryable === true
              ? { retryable: true, retryAfterMs: error.retryAfterMs || 0 }
              : {}),
          }),
      );
    // A callback channel also works on browsers with different Promise listener support.
    return true;
  });
}
