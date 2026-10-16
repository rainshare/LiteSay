import { SITE_RULES, normalizeSiteRules, resolveSiteRules } from '../../plugins/sites/index.js';
import { validateSiteRuleDefinitions } from '../../plugins/sites/site-rules/rule-schema.js';
import { t, setMessage, localize, onLocaleChange } from '../../i18n/engine/index.js';
import { createSectionEditor } from './sections.js';

const TEXT_FIELDS = [
  ['label', 'rules.name', 'rules.namePlaceholder'],
  ['domains', 'rules.domains', 'rules.domainsPlaceholder'],
  ['description', 'rules.description', 'rules.descriptionPlaceholder'],
  ['bodySelector', 'rules.content', 'rules.contentPlaceholder'],
  ['excludedSelector', 'rules.excludedRegions', 'rules.excludedRegionsPlaceholder'],
  ['contentExcludedSelector', 'rules.excludedContent', 'rules.excludedContentPlaceholder'],
  ['inlineLinkSelector', 'rules.inlineLinkSelector', 'rules.inlineLinkPlaceholder'],
  ['renderedTextSelector', 'rules.renderedTextSelector', 'rules.renderedTextPlaceholder'],
  ['inlineFormatSelector', 'rules.inlineFormatSelector', 'rules.inlineFormatPlaceholder'],
  ['inlinePreserveSelector', 'rules.inlinePreserveSelector', 'rules.inlinePreservePlaceholder'],
];
const CHECK_FIELDS = [
  ['preserveMentions', 'rules.preserveMentions'],
  ['preserveEmojiImages', 'rules.preserveEmoji'],
  ['translateInlineLinks', 'rules.translateInlineLinks'],
  ['defaultEnabled', 'rules.defaultEnabled'],
];
const SELECTOR_FIELDS = [
  'bodySelector',
  'excludedSelector',
  'contentExcludedSelector',
  'inlineLinkSelector',
  'renderedTextSelector',
  'inlineFormatSelector',
  'inlinePreserveSelector',
];
const copy = (rules) => structuredClone(rules);
const domainsFrom = (value) =>
  value
    .trim()
    .split(/[\s,，]+/)
    .filter(Boolean)
    .map((domain) => {
      // Allow pasted website URLs, but strictly store hostnames only.
      if (/^https?:\/\//i.test(domain)) {
        try {
          return new URL(domain).hostname;
        } catch {
          /* Let field validation report the error. */
        }
      }
      return domain;
    });

/**
 * Rule list and modal editor. Dialog drafts are independent; cancellation changes neither the list nor storage.
 * After validation, pass the complete rule patch to host onSave and replace the list only on success.
 * This module does not access Chrome APIs; the host handles sender checks, storage, and save state.
 *
 * @param {{list: HTMLElement, source: HTMLElement, error: HTMLElement,
 *   resetButton: HTMLButtonElement, addButton: HTMLButtonElement,
 *   onChange: () => void, onSave: (patch: object) => Promise<object>}} options
 */
export function createSiteRuleEditor({
  list,
  source,
  error,
  resetButton,
  addButton,
  onChange,
  onSave,
}) {
  const doc = list.ownerDocument;
  let definitions = copy(SITE_RULES);
  let enabled = normalizeSiteRules();
  let custom = false;
  let session = null;
  let saving = false;
  const create = (tag, className, text, localized = true) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) {
      if (localized) setMessage(node, text);
      else {
        node.textContent = text;
        node.dataset.i18nIgnore = '';
      }
    }
    return node;
  };
  const button = (text, className = 'rule-button') => {
    const node = create('button', className, text);
    node.type = 'button';
    return node;
  };

  // Native dialog provides focus containment, background isolation, and Esc; its separate form is not nested in the host settings form.
  const dialog = create('dialog', 'site-rule-dialog');
  dialog.id = 'site-rule-dialog';
  dialog.setAttribute('aria-labelledby', 'site-rule-dialog-title');
  dialog.setAttribute('aria-describedby', 'site-rule-dialog-description');
  const form = create('form', 'site-rule-dialog-form');
  form.noValidate = true;
  const header = create('div', 'site-rule-dialog-header');
  const titleBox = create('div');
  const title = create('h2', '', 'rules.editorTitle');
  title.id = 'site-rule-dialog-title';
  const subtitle = create('p', '', 'rules.editorHelp');
  subtitle.id = 'site-rule-dialog-description';
  titleBox.append(title, subtitle);
  const close = button('×', 'site-rule-close');
  close.setAttribute('aria-label', 'rules.close');
  header.append(titleBox, close);
  const body = create('div', 'site-rule-dialog-body');
  const fieldset = create('fieldset', 'site-rule-dialog-fields');
  const basics = create('div', 'site-rule-fields');
  const sections = createSectionEditor({ doc, onChange: clearError });
  const advanced = create('details', 'site-rule-advanced');
  const summary = create('summary', '', 'rules.advanced');
  summary.append(create('span', '', 'rules.protection'));
  const advancedFields = create('div', 'site-rule-selectors');
  const protections = create('div', 'site-rule-protections');
  advanced.append(summary, advancedFields, protections);
  fieldset.append(basics, sections.element, advanced);
  const deleteNote = create('p', 'site-rule-delete-note');
  deleteNote.hidden = true;
  const dialogError = create('p', 'site-rule-error');
  dialogError.id = 'site-rule-dialog-error';
  dialogError.setAttribute('role', 'alert');
  dialogError.hidden = true;
  body.append(fieldset, deleteNote, dialogError);
  const footer = create('div', 'site-rule-dialog-footer');
  const secondaryActions = create('div', 'site-rule-secondary-actions');
  const remove = button('rules.delete', 'rule-button rule-button-danger');
  const restore = button('rules.restore');
  secondaryActions.append(remove, restore);
  const mainActions = create('div', 'site-rule-main-actions');
  const cancel = button('common.cancel');
  const save = button('rules.save', 'rule-button rule-button-primary');
  save.type = 'submit';
  mainActions.append(cancel, save);
  footer.append(secondaryActions, mainActions);
  form.append(header, body, footer);
  dialog.append(form);
  doc.body.append(dialog);

  function clearError() {
    error.textContent = '';
    error.hidden = true;
    dialogError.textContent = '';
    dialogError.hidden = true;
    for (const field of Object.values(session?.fields || {})) field.removeAttribute('aria-invalid');
    sections.clearError();
  }

  function focusField(field) {
    if (advanced.contains(field)) advanced.open = true;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', dialogError.id);
    field.focus();
  }

  function showFailure(failure) {
    const target = dialog.open ? dialogError : error;
    setMessage(target, failure.message);
    target.hidden = false;
    if (!session || session.deleting) return;
    const name = failure.message.toLowerCase().includes('domain')
      ? 'domains'
      : TEXT_FIELDS.find(([field]) => failure.message.includes(field))?.[0];
    if (name) focusField(session.fields[name]);
  }

  function render() {
    list.replaceChildren();
    for (const rule of [...definitions].sort((first, second) =>
      first.label.localeCompare(second.label, 'en', { sensitivity: 'base' }),
    )) {
      const card = create('article', 'site-rule-card');
      card.dataset.siteRule = rule.id;
      const heading = create('div', 'site-rule-heading');
      const text = create('div', 'site-rule-copy');
      const label = create('label', '', rule.label, false);
      label.htmlFor = 'site-rule-' + rule.id;
      const domains = create('p', 'site-rule-domains', rule.domains.join(' · '));
      text.append(label, domains);
      if (rule.description) {
        const preset = SITE_RULES.find((item) => item.id === rule.id);
        // Saving switches also creates overrides; unchanged built-in copy still follows UI language.
        text.append(
          create(
            'p',
            'site-rule-description',
            rule.description,
            !custom || rule.description === preset?.description,
          ),
        );
      }
      const actions = create('div', 'site-rule-actions');
      const edit = button('rules.edit');
      edit.dataset.ruleEdit = rule.id;
      edit.setAttribute('aria-haspopup', 'dialog');
      edit.setAttribute('aria-controls', dialog.id);
      edit.setAttribute('aria-label', t('rules.editLabel', { site: rule.label }));
      edit.onclick = () => openEditor(rule, edit);
      const switchLabel = create('label', 'switch');
      const toggle = create('input');
      toggle.type = 'checkbox';
      toggle.id = label.htmlFor;
      toggle.checked = enabled[rule.id] ?? rule.defaultEnabled;
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', t('rules.enableLabel', { site: rule.label }));
      toggle.onchange = () => {
        enabled[rule.id] = toggle.checked;
        clearError();
        onChange();
      };
      const icon = create('span');
      icon.setAttribute('aria-hidden', 'true');
      switchLabel.append(toggle, icon);
      actions.append(edit, switchLabel);
      heading.append(text, actions);
      card.append(heading);
      list.append(card);
    }
    if (!definitions.length) list.append(create('p', 'site-rule-empty', 'rules.empty'));
    setMessage(source, custom ? 'rules.custom' : 'rules.default');
    source.dataset.source = custom ? 'custom' : 'config';
    clearError();
  }

  function populate(rule, restoreDefaults = false) {
    basics.replaceChildren();
    advancedFields.replaceChildren();
    protections.replaceChildren();
    session.fields = {};
    sections.load(rule, restoreDefaults ? {} : enabled);
    for (const [name, label, placeholder] of TEXT_FIELDS) {
      const isSelector = SELECTOR_FIELDS.includes(name);
      const field = create('div', 'site-rule-field' + (isSelector ? ' selector-field' : ''));
      if (name === 'description') field.classList.add('site-rule-field-wide');
      const fieldLabel = create('label', '', label);
      const input = create(name === 'domains' || isSelector ? 'textarea' : 'input');
      input.id = 'site-rule-dialog-' + name;
      fieldLabel.htmlFor = input.id;
      input.dataset.ruleField = name;
      input.placeholder = t(placeholder);
      input.setAttribute('data-i18n-placeholder', placeholder);
      input.value = name === 'domains' ? rule.domains.join('\n') : rule[name] || '';
      if (input.tagName === 'TEXTAREA') input.rows = 2;
      input.spellcheck = false;
      input.autocapitalize = 'off';
      if (name === 'label' || name === 'domains' || name === 'bodySelector') input.required = true;
      const help =
        name === 'domains'
          ? 'rules.domainsHelp'
          : name === 'bodySelector'
            ? 'rules.contentHelp'
            : name === 'inlineLinkSelector'
              ? 'rules.inlineLinkHelp'
              : name === 'renderedTextSelector'
                ? 'rules.renderedTextHelp'
                : name === 'inlineFormatSelector'
                  ? 'rules.inlineFormatHelp'
                  : name === 'inlinePreserveSelector'
                    ? 'rules.inlinePreserveHelp'
                    : isSelector
                      ? 'rules.excludeHelp'
                      : '';
      field.append(fieldLabel, input);
      if (help) {
        const note = create('p', 'site-rule-field-help', help);
        note.id = input.id + '-help';
        input.setAttribute('aria-describedby', note.id);
        field.append(note);
      }
      input.oninput = clearError;
      session.fields[name] = input;
      (isSelector ? advancedFields : basics).append(field);
    }
    for (const [name, text] of CHECK_FIELDS) {
      const label = create('label');
      const input = create('input');
      input.type = 'checkbox';
      input.dataset.ruleField = name;
      input.checked = rule[name];
      input.onchange = clearError;
      session.fields[name] = input;
      label.append(input, create('span', '', text));
      protections.append(label);
    }
    fieldset.hidden = false;
    deleteNote.hidden = true;
    remove.hidden = session.adding;
    restore.hidden = !SITE_RULES.some((item) => item.id === rule.id) || session.adding;
    setMessage(save, 'rules.save');
    save.classList.remove('rule-button-danger');
  }

  function openEditor(rule, opener, adding = false) {
    if (dialog.open || saving) return;
    session = { rule: copy(rule), opener, fields: {}, adding, deleting: false };
    setMessage(title, adding ? 'rules.add' : 'rules.editSite', { site: rule.label });
    setMessage(subtitle, 'rules.savedHelp');
    advanced.open = adding;
    populate(rule);
    clearError();
    dialog.showModal();
    session.fields[adding ? 'domains' : 'label'].focus();
  }

  function closeEditor() {
    if (!saving) dialog.close();
  }
  close.onclick = closeEditor;
  cancel.onclick = closeEditor;
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    const opener = session?.opener;
    session = null;
    if (opener?.isConnected) opener.focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeEditor();
  });
  restore.onclick = () => {
    populate(
      SITE_RULES.find((rule) => rule.id === session.rule.id),
      true,
    );
    clearError();
    session.fields.label.focus();
  };
  remove.onclick = () => {
    session.deleting = true;
    fieldset.hidden = true;
    deleteNote.hidden = false;
    setMessage(deleteNote, 'rules.deleteSiteHelp', { site: session.rule.label });
    setMessage(title, 'rules.deleteSite', { site: session.rule.label });
    setMessage(subtitle, 'rules.restoreHelp');
    remove.hidden = true;
    restore.hidden = true;
    setMessage(save, 'rules.deleteSave');
    save.classList.add('rule-button-danger');
    clearError();
    cancel.focus();
  };

  function setSaving(value) {
    saving = value;
    fieldset.disabled = value;
    for (const action of [close, cancel, save, remove, restore]) action.disabled = value;
    setMessage(
      save,
      value ? 'common.saving' : session?.deleting ? 'rules.deleteSave' : 'rules.save',
    );
  }

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (saving || !session) return;
    clearError();
    const active = session;
    try {
      let definitionsUnchanged = !custom && !active.deleting && !active.adding;
      let next = definitions.filter((rule) => rule.id !== active.rule.id);
      if (!active.deleting) {
        const rule = { ...active.rule };
        for (const [field] of TEXT_FIELDS)
          rule[field] =
            field === 'domains'
              ? domainsFrom(active.fields[field].value)
              : active.fields[field].value.trim();
        for (const [field] of CHECK_FIELDS) rule[field] = active.fields[field].checked;
        rule.sections = sections.read((field) => focusField(field));
        // Keep inheriting built-in rules for switch-only edits, avoiding frozen selectors that miss later compatibility fixes.
        definitionsUnchanged &&=
          TEXT_FIELDS.every(
            ([field]) => JSON.stringify(rule[field]) === JSON.stringify(active.rule[field] ?? ''),
          ) &&
          CHECK_FIELDS.every(([field]) => rule[field] === Boolean(active.rule[field])) &&
          rule.sections.length === (active.rule.sections || []).length &&
          rule.sections.every((section, index) =>
            Object.entries(section).every(
              ([field, value]) => value === (active.rule.sections[index][field] ?? ''),
            ),
          );
        for (const field of SELECTOR_FIELDS) {
          if (!rule[field]) continue;
          try {
            doc.querySelector(rule[field]);
          } catch {
            focusField(active.fields[field]);
            const label = TEXT_FIELDS.find(([name]) => name === field)[1];
            throw new Error(t('rules.invalidSelector', { field: label }, 'en'));
          }
        }
        const index = definitions.findIndex((item) => item.id === rule.id);
        next.splice(index < 0 ? next.length : index, 0, rule);
      }
      next = validateSiteRuleDefinitions(next, (selector) => doc.querySelector(selector));
      const switches = { ...enabled };
      Object.assign(switches, sections.switches());
      if (active.adding) switches[active.rule.id] = active.fields.defaultEnabled.checked;
      delete switches[active.deleting ? active.rule.id : ''];
      setSaving(true);
      const saved = await onSave({
        siteRules: normalizeSiteRules(switches, next),
        siteRuleOverrides: definitionsUnchanged ? null : next,
      });
      setSaving(false);
      dialog.close();
      session = null;
      load(saved);
      const edit = list.querySelector('[data-rule-edit="' + active.rule.id + '"]');
      (edit || addButton).focus();
    } catch (failure) {
      setSaving(false);
      showFailure(failure);
    }
  };

  function load(settings) {
    definitions = copy(resolveSiteRules(settings));
    enabled = normalizeSiteRules(settings.siteRules, definitions);
    custom = Array.isArray(settings.siteRuleOverrides);
    render();
  }

  function read() {
    const rules = validateSiteRuleDefinitions(definitions, (selector) =>
      doc.querySelector(selector),
    );
    return {
      siteRules: normalizeSiteRules(enabled, rules),
      siteRuleOverrides: custom ? rules : null,
    };
  }

  async function reset() {
    if (saving) return;
    resetButton.disabled = true;
    addButton.disabled = true;
    clearError();
    try {
      const saved = await onSave({ siteRuleOverrides: null, siteRules: normalizeSiteRules() });
      load(saved);
    } catch (failure) {
      showFailure(failure);
    } finally {
      resetButton.disabled = false;
      addButton.disabled = false;
    }
  }

  resetButton.onclick = reset;
  addButton.onclick = () => {
    let count = 1;
    while (definitions.some((rule) => rule.id === 'custom-' + count)) count += 1;
    openEditor(
      {
        id: 'custom-' + count,
        label: t('rules.new'),
        description: '',
        domains: [],
        defaultEnabled: true,
        bodySelector: 'article',
        excludedSelector: '',
        contentExcludedSelector: '',
        preserveMentions: false,
        preserveEmojiImages: true,
      },
      addButton,
      true,
    );
  };
  render();
  // Resolve static dialog labels once so accessibility attributes keep following the interface language.
  localize(dialog);
  onLocaleChange(() => {
    localize(list);
    localize(dialog);
  });
  return { load, read, reset };
}
