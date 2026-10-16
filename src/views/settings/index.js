import { sendExtensionMessage, subscribeStorageChanges } from '../../platform/webextension/api.js';
import {
  getLocale,
  setLocale,
  onLocaleChange,
  localize,
  setMessage,
  t,
} from '../../i18n/engine/index.js';
import { mountLocaleSwitch } from '../../components/locale-switch/index.js';
import { mountCapsuleSlider } from '../../components/capsule-slider/index.js';
import { mountPopover } from '../../components/popover/index.js';
import { storageKey } from '../../store/storage.js';
import { orderedLanguages } from '../../i18n/languages/index.js';
import { PROVIDERS, validateSettings } from '../../store/settings/index.js';
import { LLM_PRESETS, defaultProviderConfigs } from '../../api/providers/presets.js';
import { normalizeProviderConfigs } from '../../api/providers/config.js';
import { thinkingPolicy } from '../../api/providers/llm/thinking.js';
import { enhanceSelect, refreshSelect } from '../../components/select/index.js';
import { createSiteRuleEditor } from '../../components/site-rules/editor.js';
import { createTokenUsageView } from '../../components/token-usage/index.js';
import { providerIcon, uiIcon } from '../../components/icons/index.js';
import {
  FREE_SERVICE_PRESETS,
  MODEL_CATALOG,
  CUSTOM_REASONING_PROTOCOLS,
} from '../../config/services/catalog.js';

const $ = (selector) => document.querySelector(selector);
let renderedReasoningProfile;
const reasoningSlider = mountCapsuleSlider($('#thinking-control'), {
  id: 'thinking',
  label: 'services.reasoningStrength',
  onChange() {
    captureProfile();
    updateThinking();
  },
});
const modelPopover = mountPopover({
  trigger: $('#model-control-trigger'),
  panel: $('#model-control-panel'),
  align: 'end',
  onOpen() {
    if (inspectedProvider !== 'custom') $('#model-choice-settings').hidden = true;
    $('#model-popup-choose').setAttribute('aria-expanded', 'false');
  },
});
$('#model-popup-choose').onclick = () => {
  if (inspectedProvider === 'custom') {
    modelPopover.close();
    $('#api-model').focus();
    return;
  }
  $('#model-choice-settings').hidden = !$('#model-choice-settings').hidden;
  $('#model-popup-choose').setAttribute(
    'aria-expanded',
    String(!$('#model-choice-settings').hidden),
  );
  modelPopover.reposition();
};
for (const [id, profile] of Object.entries(CUSTOM_REASONING_PROTOCOLS))
  $('#thinking-protocol').add(new Option(profile.label, id));
const panelIds = new Set(
  [...document.querySelectorAll('.nav[data-panel]')].map((item) => item.dataset.panel),
);
for (const [panel, name] of Object.entries({
  basic: 'settings',
  services: 'services',
  filters: 'sites',
  about: 'info',
}))
  $(`.nav[data-panel="${panel}"] span`).replaceChildren(uiIcon(name));
// The site editor receives mount points and draft callbacks only; this module handles unified saves and background communication.
// read() returns switches and definition overrides; load() applies background-confirmed settings on initialization/successful save.
const siteRuleEditor = createSiteRuleEditor({
  list: $('#site-rule-list'),
  source: $('#site-rule-source'),
  error: $('#site-rule-error'),
  resetButton: $('#reset-site-rules'),
  addButton: $('#add-site-rule'),
  onChange: markSiteDirty,
  onSave: persistSiteRules,
});
let otherSettingsDirty = false;
let siteSettingsDirty = false;
let inspectedProvider = 'microsoft';
let savedProvider = 'microsoft';
let providerConfigs = defaultProviderConfigs();
let customApiIcon = 'openai';
// Keep new providers editable with partial background catalogs; switching details must not enter an undefined state.
function loadProviderProfiles(metadata) {
  return Object.fromEntries(
    Object.entries(normalizeProviderConfigs(metadata)).map(([id, config]) => [
      id,
      { ...metadata?.[id], ...config },
    ]),
  );
}
const serviceDetails = {
  ...Object.fromEntries(
    Object.entries(FREE_SERVICE_PRESETS).map(([id, preset]) => [
      id,
      { title: preset.label, description: preset.detail },
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(LLM_PRESETS).map(([id, preset]) => [
      id,
      { title: preset.label, description: preset.description },
    ]),
  ),
};
// All selectable services share the background catalog; never put keys in DOM attributes or service lists.
for (const [id, provider] of Object.entries(PROVIDERS))
  $('#provider').add(new Option(provider.label, id));
const group = document.createElement('div');
group.className = 'service-group';
setMessage(group, 'services.models');
$('.service-list').append(group);
for (const [id, preset] of Object.entries(LLM_PRESETS)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'service-item';
  button.dataset.provider = id;
  const logo = document.createElement('span');
  logo.className = 'provider-logo monogram';
  logo.setAttribute('aria-hidden', 'true');
  logo.append(providerIcon(id));
  const name = document.createElement('span');
  name.textContent = preset.label;
  const badge = document.createElement('small');
  badge.className = 'default-label';
  button.append(logo, name, badge);
  $('.service-list').append(button);
}
const message = async (payload) => {
  const response = await sendExtensionMessage(payload);
  if (!response?.ok) throw new Error(response?.error || 'errors.extensionUnresponsive');
  return response;
};
const usageView = createTokenUsageView({
  root: $('#api-usage'),
  load: async () => (await message({ type: 'GET_API_USAGE' })).usage,
  reset: (provider) => message({ type: 'RESET_API_USAGE', provider }),
  onError: (error) => notify(error.message, true),
});
const serviceIcon = (id) => providerIcon(id, document, customApiIcon);
function notify(text, error = false) {
  setMessage($('#message'), text);
  $('#message').classList.toggle('error', error);
}
function showPanel(id) {
  modelPopover.close();
  if (id === 'services') inspectProvider($('#provider').value);
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== id;
  for (const item of document.querySelectorAll('.nav')) {
    item.classList.toggle('active', item.dataset.panel === id);
    if (item.dataset.panel === id) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}
// Keep sections in the URL for refresh/history; form drafts remain only in the current page.
function restorePanel() {
  const requested = location.hash.slice(1);
  const id = panelIds.has(requested) ? requested : 'basic';
  if (requested && requested !== id) history.replaceState(null, '', `#${id}`);
  showPanel(id);
}
function navigatePanel(id) {
  if (!panelIds.has(id)) id = 'basic';
  if (location.hash === `#${id}`) showPanel(id);
  else location.hash = id;
}
function updateProviderCards() {
  localize(document);
  // Programmatic background/detail assignments do not fire change; explicitly refresh the shared select view.
  for (const select of document.querySelectorAll('select')) refreshSelect(select);
  for (const button of document.querySelectorAll('.service-item')) {
    const selected = button.dataset.provider === inspectedProvider;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.querySelector('.default-label').textContent =
      button.dataset.provider === savedProvider ? 'services.defaultBadge' : '';
    button.querySelector('.provider-logo').replaceChildren(serviceIcon(button.dataset.provider));
  }
  if (inspectedProvider === 'custom') $('#detail-other').replaceChildren(serviceIcon('custom'));
  $('#use-provider').disabled = inspectedProvider === $('#provider').value;
  $('#use-provider').textContent =
    inspectedProvider === $('#provider').value
      ? inspectedProvider === savedProvider
        ? 'services.currentDefault'
        : 'services.pendingDefault'
      : 'services.setDefault';
  localize(document);
}
/** List selection changes details only; default and tested services are separate, so viewing details cannot change page preferences. */
function inspectProvider(provider) {
  captureProfile();
  inspectedProvider = provider;
  modelPopover.close();
  $('#service-title').textContent = serviceDetails[provider].title;
  $('#service-description').textContent = serviceDetails[provider].description;
  $('#detail-microsoft').hidden = provider !== 'microsoft';
  $('#detail-google').hidden = provider !== 'google';
  const llm = Boolean(LLM_PRESETS[provider]);
  $('#detail-other').hidden = !llm;
  $('#detail-other').replaceChildren(serviceIcon(provider));
  $('#service-type').textContent = llm ? 'services.modelApi' : 'services.freeWeb';
  $('#free-key-note').hidden = llm;
  $('#llm-settings').hidden = !llm;
  if (llm) {
    const config = providerConfigs[provider];
    $('#api-key').value = config.apiKey || '';
    $('#api-key').placeholder =
      provider === 'custom' ? 'key.optional' : config.hasKey ? 'key.replace' : 'key.input';
    $('#key-status').textContent = config.clearKey
      ? 'key.pendingClear'
      : config.hasKey
        ? 'key.configured'
        : 'key.unconfigured';
    $('#api-endpoint').value = config.endpoint;
    $('#api-protocol').value = config.protocol;
    $('#api-icon').value = customApiIcon;
    populateModels(config.model);
    $('#thinking-protocol').value = config.thinkingProtocol;
    $('#custom-protocol').hidden = provider !== 'custom' || config.protocol === 'claude';
    $('#custom-settings').hidden = provider !== 'custom';
    $('#show-key').checked = false;
    $('#api-key').type = 'password';
    updateThinking(config);
    $('#api-advanced').open = provider === 'custom';
  }
  usageView.show(provider, llm);
  $('#test-result').textContent = '';
  updateProviderCards();
  localize(document);
}
/** New keys exist only in settings drafts; GET_SETTINGS never returns saved keys or ciphertext. */
function captureProfile() {
  if (!LLM_PRESETS[inspectedProvider]) return;
  const config = providerConfigs[inspectedProvider];
  config.apiKey = $('#api-key').value.trim();
  config.endpoint = $('#api-endpoint').value.trim();
  config.model =
    inspectedProvider === 'custom' ? $('#api-model').value.trim() : $('#api-model-choice').value;
  if (inspectedProvider === 'custom') {
    config.protocol = $('#api-protocol').value;
    config.thinkingProtocol = config.protocol === 'claude' ? 'none' : $('#thinking-protocol').value;
  }
  const policy = thinkingPolicy(inspectedProvider, config);
  const key = `${inspectedProvider}/${config.model}/${config.thinkingProtocol}`;
  config.reasoningLevel =
    renderedReasoningProfile === key
      ? reasoningSlider.value() || policy.profile.defaultLevel
      : policy.profile.defaultLevel;
  config.thinking = thinkingPolicy(inspectedProvider, config).enabled;
  if (config.apiKey) config.clearKey = false;
}
function updateThinking(config = providerConfigs[inspectedProvider]) {
  const policy = thinkingPolicy(inspectedProvider, config);
  const modelName =
    MODEL_CATALOG.providers[inspectedProvider]?.labels?.[config.model] ||
    config.model ||
    t('services.model');
  $('#model-control-name').textContent = modelName;
  $('#model-popup-name').textContent = modelName;
  setMessage($('#model-control-level'), policy.level.label);
  setMessage($('#model-popup-level'), policy.level.label);
  $('#model-control-trigger').title = t(policy.profile.notice);
  config.reasoningLevel = policy.levelId;
  config.thinking = policy.enabled;
  $('#thinking-row').hidden = !policy.visible;
  renderedReasoningProfile = `${inspectedProvider}/${config.model}/${config.thinkingProtocol}`;
  reasoningSlider.setChoices(
    policy.levels.map((level) => ({ value: level.id, label: level.label })),
    policy.levelId,
  );
  setMessage($('#thinking-help'), policy.profile.notice);
  if (!$('#model-control-panel').hidden) modelPopover.reposition();
}
function populateModels(model) {
  const choice = $('#api-model-choice');
  const custom = inspectedProvider === 'custom';
  // Edit custom names in the main form; keep official candidates in the model popover.
  const modelSettings = $('#model-choice-settings');
  const destination = $(custom ? '#model-custom-settings' : '#model-popup-settings');
  if (modelSettings.parentElement !== destination) {
    destination.append(modelSettings);
    modelSettings.hidden = !custom;
  }
  const models = custom ? [] : MODEL_CATALOG.providers[inspectedProvider].models;
  const labels = MODEL_CATALOG.providers[inspectedProvider]?.labels;
  choice.replaceChildren(...models.map((id) => new Option(labels?.[id] || id, id)));
  choice.value = model;
  setMessage($('#api-model-label'), custom ? 'services.model' : 'services.chooseModel');
  $('#api-model-label').htmlFor = custom ? 'api-model' : 'api-model-choice';
  $('#api-model-options').hidden = custom;
  $('#api-model').value = model;
  $('#api-model-custom').hidden = !custom;
  refreshSelect(choice);
}
function updateSaveState() {
  updatePreview();
  const dirty = otherSettingsDirty || siteSettingsDirty;
  setMessage($('#save-state'), dirty ? 'common.unsaved' : 'common.saved');
  $('#save-state').classList.toggle('dirty', dirty);
  updateProviderCards();
}
function markDirty(event) {
  if (event?.target?.closest('#filters')) siteSettingsDirty = true;
  else otherSettingsDirty = true;
  updateSaveState();
}
function markSiteDirty() {
  siteSettingsDirty = true;
  updateSaveState();
}
/** Dialogs save site patches only; other language/API page drafts remain unsaved. */
async function persistSiteRules(patch) {
  const current = await message({ type: 'GET_SETTINGS' });
  const saved = await message({
    type: 'SAVE_SETTINGS',
    settings: { ...current.settings, ...patch },
  });

  siteSettingsDirty = false;
  updateSaveState();
  notify('rules.saved');
  return saved.settings;
}
function readForm() {
  const settings = {
    provider: $('#provider').value,
    customApiIcon,
    ...siteRuleEditor.read(),
    selectionTranslation: $('#selection-translation').checked,
    hoverTranslation: $('#hover-translation').checked,
    selectionTrigger: $('#selection-trigger').value,
    hoverTrigger: $('#hover-trigger').value,
    hoverAction: $('#hover-action').value,
    displayMode: $('#display-mode').value,
    translationStyle: $('#translation-style').value,
    highlightSimilarLanguages: $('#highlight-similar').checked,
  };
  for (const [id, key] of [
    ['source', 'sourceLanguage'],
    ['target', 'targetLanguage'],
  ])
    settings[key] =
      $(`#${id}`).value === '__custom' ? $(`#${id}-custom`).value.trim() : $(`#${id}`).value;
  validateSettings(settings);
  return settings;
}
/** Previews modify fixed examples only, without translation requests; draft display changes appear immediately. */
function updatePreview() {
  $('.preview .original').hidden = $('#display-mode').value === 'translation-only';
  $('.preview .translated').dataset.style = $('#translation-style').value;
}

function populateLanguages() {
  for (const id of ['source', 'target']) {
    const select = $(`#${id}`);
    const previous = select.value;
    select.replaceChildren();
    if (id === 'source') select.add(new Option(t('languages.auto'), 'auto'));
    for (const language of orderedLanguages()) {
      const option = new Option(language.name, language.code);
      option.dataset.search = language.search;
      select.add(option);
    }
    select.add(new Option(t('languages.custom'), '__custom'));
    if (previous) select.value = previous;
    refreshSelect(select);
  }
}
populateLanguages();
for (const id of ['source', 'target']) {
  const select = $(`#${id}`);
  select.addEventListener('change', () => {
    $(`#${id}-custom`).hidden = select.value !== '__custom';
    if (!$(`#${id}-custom`).hidden) $(`#${id}-custom`).focus();
  });
}
function refreshLocale() {
  document.documentElement.lang = getLocale();
  localize(document);
  populateLanguages();
  if (LLM_PRESETS[inspectedProvider]) {
    captureProfile();
    populateModels(providerConfigs[inspectedProvider].model);
    updateThinking();
  }
  usageView.refresh();
  for (const select of document.querySelectorAll('select')) refreshSelect(select);
}
onLocaleChange(refreshLocale);
mountLocaleSwitch($('#ui-locale'), async (uiLocale) => {
  try {
    const saved = await message({ type: 'SET_UI_LOCALE', uiLocale });
    setLocale(saved.uiLocale);
  } catch (error) {
    notify(error.message, true);
  }
});
subscribeStorageChanges((changes, area) => {
  if (area === 'local' && changes[storageKey('uiLocale')])
    setLocale(changes[storageKey('uiLocale')].newValue);
  if (area === 'local' && changes[storageKey('apiUsage')]) usageView.refresh();
});
for (const button of document.querySelectorAll('[data-panel]'))
  button.onclick = () => navigatePanel(button.dataset.panel);
for (const button of document.querySelectorAll('[data-go]'))
  button.onclick = () => navigatePanel(button.dataset.go);
window.addEventListener('hashchange', restorePanel);
restorePanel();
for (const button of document.querySelectorAll('[data-provider]'))
  button.onclick = () => inspectProvider(button.dataset.provider);
$('#use-provider').onclick = () => {
  $('#provider').value = inspectedProvider;
  markDirty();
  notify('services.applyHelp');
};
$('#settings-form').addEventListener('input', markDirty);
$('#settings-form').addEventListener('change', markDirty);
$('#thinking-protocol').addEventListener('change', () => {
  captureProfile();
  updateThinking();
});
$('#api-model-choice').addEventListener('change', () => {
  captureProfile();
  updateThinking();
});
$('#api-model').addEventListener('input', () => {
  captureProfile();
  updateThinking();
});
$('#reset-model').onclick = () => {
  populateModels(LLM_PRESETS[inspectedProvider].model);
  captureProfile();
  updateThinking();
  markDirty();
  if (!$('#api-model-custom').hidden) $('#api-model').focus();
};
$('#api-protocol').addEventListener('change', () => {
  captureProfile();
  const claude = $('#api-protocol').value === 'claude';
  $('#custom-protocol').hidden = claude;
  if (claude) {
    $('#thinking-protocol').value = 'none';
    $('#thinking-row').hidden = true;
  }
  updateThinking();
  $('#api-endpoint').placeholder = claude
    ? t('services.fullClaudeEndpoint')
    : t('services.endpointPlaceholder');
  populateModels(providerConfigs.custom.model);
});
$('#api-icon').addEventListener('change', () => {
  customApiIcon = $('#api-icon').value;
  updateProviderCards();
});
$('#clear-key').onclick = () => {
  providerConfigs[inspectedProvider].clearKey = true;
  providerConfigs[inspectedProvider].apiKey = '';
  $('#api-key').value = '';
  setMessage($('#key-status'), 'key.pendingClear');
  markDirty();
};
/** Clear translations only, retaining service configuration and keys; the background also clears page-local document caches. */
$('#clear-cache').onclick = async () => {
  $('#clear-cache').disabled = true;
  try {
    await message({ type: 'CLEAR_CACHE' });
    setMessage($('#cache-state'), 'cache.clearedHelp');
    notify('cache.cleared');
  } catch (error) {
    notify(error.message, true);
  } finally {
    $('#clear-cache').disabled = false;
  }
};
$('#settings-form').onsubmit = async (event) => {
  event.preventDefault();
  $('#save').disabled = true;
  try {
    captureProfile();
    const saved = await message({ type: 'SAVE_SETTINGS', settings: readForm(), providerConfigs });

    otherSettingsDirty = false;
    siteSettingsDirty = false;
    // Discard plaintext drafts immediately after success so keys do not linger in the page.
    $('#api-key').value = '';
    providerConfigs = loadProviderProfiles(saved.providerConfigs);
    if (LLM_PRESETS[inspectedProvider]) {
      setMessage(
        $('#key-status'),
        providerConfigs[inspectedProvider].hasKey ? 'key.configured' : 'key.unconfigured',
      );
      $('#api-key').placeholder = inspectedProvider === 'custom' ? 'key.optional' : 'key.keepHelp';
    }
    savedProvider = $('#provider').value;
    siteRuleEditor.load(saved.settings);
    updateProviderCards();
    setMessage($('#save-state'), 'common.saved');
    $('#save-state').classList.remove('dirty');
    notify('settings.saved');
  } catch (error) {
    notify(error.message, true);
  } finally {
    $('#save').disabled = false;
  }
};
$('#test').onclick = async () => {
  const testedProvider = inspectedProvider;
  const result = $('#test-result');
  $('#test').disabled = true;
  result.classList.remove('error');
  setMessage(result, 'services.connecting');
  try {
    captureProfile();
    const response = await message({
      type: 'TEST_SERVICE',
      settings: { ...readForm(), provider: testedProvider },
      providerConfig: providerConfigs[testedProvider],
    });
    if (testedProvider === inspectedProvider)
      setMessage(result, 'services.connected', { text: response.text });
  } catch (error) {
    if (testedProvider === inspectedProvider) {
      setMessage(result, error.message);
      result.classList.add('error');
    }
  } finally {
    $('#test').disabled = false;
    usageView.refresh();
  }
};
$('#show-key').onchange = () => {
  $('#api-key').type = $('#show-key').checked ? 'text' : 'password';
};
try {
  const { uiLocale } = await message({ type: 'GET_UI_LOCALE' });
  setLocale(uiLocale);
  refreshLocale();
  for (const select of document.querySelectorAll('select'))
    enhanceSelect(
      select,
      ['provider', 'api-icon'].includes(select.id)
        ? { optionIcon: (id) => (select.id === 'api-icon' ? providerIcon(id) : serviceIcon(id)) }
        : {},
    );
  for (const button of document.querySelectorAll('.service-item'))
    button.querySelector('.provider-logo').replaceChildren(providerIcon(button.dataset.provider));
  $('#detail-microsoft').replaceChildren(providerIcon('microsoft'));
  $('#detail-google').replaceChildren(providerIcon('google'));
  const { settings, providerConfigs: savedConfigs } = await message({ type: 'GET_SETTINGS' });

  providerConfigs = loadProviderProfiles(savedConfigs);
  customApiIcon = settings.customApiIcon || 'openai';
  $('#provider').value = settings.provider;
  savedProvider = settings.provider;
  siteRuleEditor.load(settings);
  $('#selection-translation').checked = settings.selectionTranslation;
  $('#hover-translation').checked = settings.hoverTranslation;
  $('#selection-trigger').value = settings.selectionTrigger;
  $('#hover-trigger').value = settings.hoverTrigger;
  $('#hover-action').value = settings.hoverAction;
  $('#display-mode').value = settings.displayMode;
  $('#translation-style').value = settings.translationStyle;
  $('#highlight-similar').checked = settings.highlightSimilarLanguages;
  updatePreview();
  const { cache } = await message({ type: 'GET_CACHE_INFO' });
  setMessage($('#cache-state'), 'cache.summary', {
    count: cache.entries,
    size: Math.ceil(cache.bytes / 1024),
  });
  for (const [id, key] of [
    ['source', 'sourceLanguage'],
    ['target', 'targetLanguage'],
  ]) {
    const select = $(`#${id}`);
    const known = [...select.options].some((option) => option.value === settings[key]);
    select.value = known ? settings[key] : '__custom';
    $(`#${id}-custom`).hidden = known;
    $(`#${id}-custom`).value = known ? '' : settings[key];
  }
  inspectProvider(settings.provider);
} catch (error) {
  notify(error.message, true);
}
