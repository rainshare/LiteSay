import { SITE_RULES } from '../../plugins/sites/index.js';
import { setMessage, t } from '../../i18n/engine/index.js';

const FIELDS = [
  ['label', 'rules.regionName', 'rules.regionNamePlaceholder'],
  ['description', 'rules.description', 'rules.regionDescriptionPlaceholder'],
  ['bodySelector', 'rules.content', 'rules.contentPlaceholder'],
  ['excludedSelector', 'rules.excludedRegions', 'rules.excludedRegionsPlaceholder'],
];

/** Independent draft control for optional scopes; return only rules and switches for host validation and saving. */
export function createSectionEditor({ doc, onChange }) {
  const create = (tag, className, message) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (message) setMessage(node, message);
    return node;
  };
  const button = (message) => {
    const node = create('button', 'rule-button', message);
    node.type = 'button';
    return node;
  };
  const element = create('section', 'site-rule-sections');
  const header = create('div', 'site-rule-section-header');
  const add = button('rules.addRegion');
  add.dataset.sectionAdd = '';
  header.append(create('h3', '', 'rules.optionalRegions'), add);
  const empty = create('p', 'site-rule-field-help', 'rules.emptyRegions');
  const list = create('div', 'site-rule-section-fields');
  element.append(header, create('p', 'site-rule-field-help', 'rules.optionalHelp'), empty, list);
  let ruleId = '';
  let drafts = [];

  function update() {
    empty.hidden = drafts.length > 0;
    add.disabled = drafts.length >= 10;
  }

  function append(section, checked, expanded = false) {
    const card = create('article', 'site-rule-section');
    card.dataset.ruleSection = section.id;
    const heading = create('div', 'site-rule-section-header');
    const label = create('label', 'site-rule-section-toggle');
    const toggle = create('input');
    toggle.type = 'checkbox';
    toggle.id = 'site-rule-' + ruleId + '-' + section.id;
    toggle.dataset.siteSection = section.id;
    toggle.checked = checked;
    toggle.onchange = onChange;
    const copy = create('span');
    const name = create('span');
    const description = create('small');
    copy.append(name, description);
    label.append(toggle, copy);
    const remove = button('rules.removeRegion');
    remove.dataset.sectionRemove = section.id;
    heading.append(label, remove);
    const details = create('details', 'site-rule-section-details');
    details.open = expanded;
    details.append(create('summary', '', 'rules.editRegion'));
    const fields = {};
    const grid = create('div', 'site-rule-section-inputs');
    const preset = SITE_RULES.find((rule) => rule.id === ruleId)?.sections?.find(
      (item) => item.id === section.id,
    );
    const displayText = (node, value, presetValue, fallback) => {
      if (value && value === presetValue) {
        delete node.dataset.i18nIgnore;
        setMessage(node, value);
      } else if (value) {
        node.dataset.i18nIgnore = '';
        node.textContent = value;
      } else {
        delete node.dataset.i18nIgnore;
        setMessage(node, fallback);
      }
    };
    const refreshCopy = () => {
      displayText(name, fields.label.value.trim(), preset?.label, 'rules.unnamedRegion');
      displayText(description, fields.description.value.trim(), preset?.description, '');
      description.hidden = !fields.description.value.trim();
    };
    for (const [field, message, placeholder] of FIELDS) {
      const selector = field.endsWith('Selector');
      const wrapper = create(
        'div',
        'site-rule-field' + (selector ? ' selector-field site-rule-field-wide' : ''),
      );
      const caption = create('label', '', message);
      const input = create(selector ? 'textarea' : 'input');
      input.id = toggle.id + '-' + field;
      input.dataset.sectionField = field;
      input.value = section[field] || '';
      input.placeholder = t(placeholder);
      input.setAttribute('data-i18n-placeholder', placeholder);
      input.spellcheck = false;
      input.autocapitalize = 'off';
      input.required = field === 'label' || field === 'bodySelector';
      if (selector) input.rows = 2;
      caption.htmlFor = input.id;
      input.oninput = () => {
        onChange();
        refreshCopy();
      };
      wrapper.append(caption, input);
      grid.append(wrapper);
      fields[field] = input;
    }
    refreshCopy();
    details.append(grid);
    card.append(heading, details);
    list.append(card);
    const draft = { section, toggle, fields, card, details };
    drafts.push(draft);
    remove.onclick = () => {
      drafts = drafts.filter((item) => item !== draft);
      card.remove();
      update();
      onChange();
      add.focus();
    };
    update();
    return draft;
  }

  add.onclick = () => {
    let count = 1;
    while (drafts.some(({ section }) => section.id === 'region-' + count)) count += 1;
    const draft = append({ id: 'region-' + count, defaultEnabled: false }, false, true);
    onChange();
    draft.fields.label.focus();
  };

  function load(rule, enabled) {
    ruleId = rule.id;
    drafts = [];
    list.replaceChildren();
    for (const section of rule.sections || [])
      append(section, enabled[rule.id + ':' + section.id] ?? section.defaultEnabled);
    update();
  }

  function read(focusField) {
    return drafts.map(({ section, fields, details }) => {
      const result = { id: section.id, defaultEnabled: section.defaultEnabled };
      for (const [field, message] of FIELDS) {
        const input = fields[field];
        result[field] = input.value.trim();
        let failure;
        if (input.required && !result[field])
          failure = t('rules.requiredField', { field: message }, 'en');
        else if (
          result[field].length >
          (field.endsWith('Selector') ? 8000 : field === 'label' ? 100 : 1000)
        )
          failure = t('rules.regionFieldTooLong', { field: message }, 'en');
        else if (field.endsWith('Selector') && result[field]) {
          try {
            doc.querySelector(result[field]);
          } catch {
            failure = t('rules.invalidSelector', { field: message }, 'en');
          }
        }
        if (failure) {
          details.open = true;
          focusField(input);
          throw new Error(failure);
        }
      }
      return result;
    });
  }

  return {
    element,
    load,
    read,
    switches: () =>
      Object.fromEntries(
        drafts.map(({ section, toggle }) => [ruleId + ':' + section.id, toggle.checked]),
      ),
    clearError: () => {
      for (const { fields } of drafts)
        for (const input of Object.values(fields)) input.removeAttribute('aria-invalid');
    },
  };
}
