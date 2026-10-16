/**
 * Shared select view for settings and page Shadow DOM.
 * The native select retains options and values; business code still listens for input/change. This module does not access settings.
 * Replace visible interaction with a searchable rounded menu; call refreshSelect() after external value assignments.
 */
import { t, onLocaleChange } from '../../i18n/engine/index.js';
const instances = new WeakMap();
const openMenus = new WeakMap();
let nextId = 0;
const styles = /* CSS */ `
  .litesay-select { position: relative; width: 100%; min-width: 0; }
  .litesay-select select.litesay-select-native {
    position: absolute; width: 1px; height: 1px; min-height: 0;
    padding: 0; border: 0; opacity: 0; pointer-events: none;
  }
  .litesay-select-trigger {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    width: 100%; min-width: 0; height: 47px; padding: 12px 14px;
    border: 1px solid #ccd5df; border-radius: 10px; background: #fff;
    color: #536474; font: inherit; font-size: 14px; text-align: left; cursor: pointer;
  }
  .litesay-select-trigger:hover { border-color: #cba9bc; }
  .litesay-select-trigger[aria-expanded='true'] { border-color: #e94789; }
  .litesay-select-trigger:disabled { opacity: .5; cursor: default; }
  .litesay-select-value { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .litesay-select-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .litesay-select-chevron { width: 16px; height: 16px; flex-shrink: 0; color: #8995a3; }
  .litesay-select-trigger[aria-expanded='true'] .litesay-select-chevron { transform: rotate(180deg); }
  .litesay-select-menu {
    display: flex; flex-direction: column; gap: 6px;
    position: absolute; z-index: 10; top: calc(100% + 8px); left: 0;
    width: 100%; min-width: 220px; max-width: calc(100vw - 24px); padding: 7px;
    border: 1px solid #eceef3; border-radius: 15px; background: #fff;
    box-shadow: 0 10px 32px #27324822, 0 2px 6px #27324808; box-sizing: border-box;
    color: #536474; font-size: 14px;
  }
  .litesay-select-menu[hidden] { display: none !important; }
  .litesay-select-menu .litesay-select-search {
    flex: none; width: 100%; min-height: 36px; height: 36px; margin: 0; padding: 8px 10px;
    background: #f6f7f9; color: #536474; border: 1px solid transparent;
    border-radius: 9px; box-sizing: border-box; font: inherit; font-size: 13px; appearance: none;
  }
  .litesay-select-search::placeholder { color: #a1aab5; }
  .litesay-select-list {
    min-height: 0;
    max-height: var(--litesay-menu-height, 300px); overflow-y: auto; overscroll-behavior: contain;
    scrollbar-width: thin; scrollbar-color: #dce1e7 transparent;
  }
  .litesay-select-option {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    min-height: 38px; padding: 9px 11px; border-radius: 9px; cursor: pointer;
    line-height: 1.4; box-sizing: border-box; overflow-wrap: anywhere;
  }
  .litesay-select-option + .litesay-select-option { margin-top: 3px; }
  .litesay-select-option[aria-selected='true'] { color: #d83f7f; background: #fff0f6; font-weight: 600; }
  .litesay-select-option.is-active { background: #f3f5f8; }
  .litesay-select-option.is-active[aria-selected='true'] { background: #ffe7f1; }
  .litesay-select-option[aria-disabled='true'] { opacity: .45; cursor: default; }
  .litesay-select-check { width: 16px; flex-shrink: 0; color: #e94789; text-align: center; }
  .litesay-select-empty { margin: 0; padding: 13px 11px; font-size: 13px; color: #9aa5b2; }
  .litesay-select-trigger:focus-visible, .litesay-select-search:focus-visible {
    outline: 2px solid #e94789; outline-offset: 2px;
  }
`;

export function enhanceSelect(select, { optionIcon, showSelectedIcon = true } = {}) {
  if (instances.has(select)) return instances.get(select);
  const root = select.getRootNode();
  const doc = select.ownerDocument;
  // Install styles per Document / ShadowRoot to prevent page CSS interference or duplicate insertion.
  if (!root.querySelector('style[data-litesay-select-style]')) {
    const style = doc.createElement('style');
    style.dataset.litesaySelectStyle = '';
    style.textContent = styles;
    (root === doc ? doc.head : root).append(style);
  }
  const wrapper = doc.createElement('div');
  wrapper.className = 'litesay-select';
  select.before(wrapper);
  wrapper.append(select);
  select.classList.add('litesay-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const name =
    select.getAttribute('aria-label') ||
    [...select.labels].map((label) => label.textContent.trim()).join(' ') ||
    select.id;
  const trigger = doc.createElement('button');
  trigger.type = 'button';
  trigger.className = 'litesay-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-label', name);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const value = doc.createElement('span');
  value.className = 'litesay-select-value';
  const chevron = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('viewBox', '0 0 16 16');
  chevron.setAttribute('class', 'litesay-select-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(chevron.namespaceURI, 'path');
  path.setAttribute('d', 'm4 6 4 4 4-4');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  chevron.append(path);
  trigger.append(value, chevron);
  const menu = doc.createElement('div');
  menu.className = 'litesay-select-menu';
  menu.hidden = true;
  const list = doc.createElement('div');
  list.id = `litesay-list-${++nextId}`;
  list.className = 'litesay-select-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', name);
  trigger.setAttribute('aria-controls', list.id);
  // Service lists need no search; larger language lists support filtering by Chinese name or language code.
  const searchable = select.options.length > 12;
  let search;
  if (searchable) {
    search = doc.createElement('input');
    search.type = 'search';
    search.className = 'litesay-select-search';
    search.placeholder = t('languages.search');
    search.setAttribute('aria-label', t('languages.searchLabel', { language: name }));
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-controls', list.id);
    search.setAttribute('aria-expanded', 'true');
    search.autocomplete = 'off';
    menu.append(search);
    // Search is temporary view state; do not bubble into the settings form or mark configuration as unsaved.
    search.addEventListener('input', (event) => {
      event.stopPropagation();
      render();
    });
    search.addEventListener('change', (event) => event.stopPropagation());
  }
  menu.append(list);
  wrapper.append(trigger, menu);
  let rows = [],
    active = -1;
  const focusOwner = () => search || trigger;
  function activate(index, scroll = false) {
    active = index;
    rows.forEach((row, i) => row.node.classList.toggle('is-active', i === index));
    for (const owner of [trigger, search].filter(Boolean)) {
      if (rows[index]) owner.setAttribute('aria-activedescendant', rows[index].node.id);
      else owner.removeAttribute('aria-activedescendant');
    }
    // Scroll only the options list; scrollIntoView would also scroll settings and popover ancestor containers.
    if (scroll && rows[index]) {
      const row = rows[index].node.getBoundingClientRect();
      const viewport = list.getBoundingClientRect();
      if (row.top < viewport.top) list.scrollTop += row.top - viewport.top;
      else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
    }
  }
  function render() {
    list.replaceChildren();
    const query = (search?.value || '').trim().toLocaleLowerCase();
    rows = [...select.options]
      .filter(
        (option) =>
          !option.hidden &&
          (!query ||
            `${option.textContent} ${option.value} ${option.dataset.search || ''}`
              .toLocaleLowerCase()
              .includes(query)),
      )
      .map((option, index) => {
        const node = doc.createElement('div');
        node.className = 'litesay-select-option';
        node.id = `${list.id}-${index}`;
        node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', String(option.selected));
        node.setAttribute('aria-disabled', String(option.disabled));
        const label = doc.createElement('span');
        label.textContent = option.textContent;
        const check = doc.createElement('span');
        check.className = 'litesay-select-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = option.selected ? '✓' : '';
        if (optionIcon) {
          const icon = optionIcon(option.value, doc);
          if (icon) node.append(icon);
          label.style.flex = '1';
        }
        node.append(label, check);
        node.addEventListener('pointermove', () => {
          if (!option.disabled) activate(index);
        });
        node.addEventListener('pointerdown', (event) => event.preventDefault());
        node.addEventListener('click', () => choose(index));
        list.append(node);
        return { option, node };
      });
    if (!rows.length) {
      const empty = doc.createElement('p');
      empty.className = 'litesay-select-empty';
      empty.textContent = t('languages.noMatches');
      list.append(empty);
    }
    const selected = rows.findIndex((row) => row.option.selected && !row.option.disabled);
    activate(selected >= 0 ? selected : rows.findIndex((row) => !row.option.disabled), true);
  }
  function position() {
    const rect = wrapper.getBoundingClientRect();
    const view = doc.defaultView;
    const width = Math.min(Math.max(rect.width, searchable ? 230 : 220), view.innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.minWidth = '0';
    menu.style.left = `${Math.max(12 - rect.left, Math.min(0, view.innerWidth - 12 - rect.left - width))}px`;
    const below = view.innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const flip = below < 270 && above > below;
    menu.style.top = flip ? 'auto' : 'calc(100% + 8px)';
    menu.style.bottom = flip ? 'calc(100% + 8px)' : 'auto';
    list.style.setProperty(
      '--litesay-menu-height',
      `${Math.max(60, Math.min(300, (flip ? above : below) - (searchable ? 56 : 14)))}px`,
    );
  }
  function close() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    if (openMenus.get(root) === instance) openMenus.delete(root);
  }
  function open() {
    if (select.disabled) return;
    openMenus.get(root)?.close();
    openMenus.set(root, instance);
    if (search) search.value = '';
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    position();
    render();
    focusOwner().focus({ preventScroll: true });
  }
  function choose(index) {
    const option = rows[index]?.option;
    if (!option || option.disabled) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    close();
    sync();
    trigger.focus({ preventScroll: true });
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function sync() {
    const selected = select.selectedOptions[0];
    const label = doc.createElement('span');
    label.className = 'litesay-select-label';
    label.textContent = selected?.textContent || t('common.select');
    value.replaceChildren();
    if (selected && showSelectedIcon && optionIcon) {
      const icon = optionIcon(selected.value, doc);
      if (icon) value.append(icon);
    }
    value.append(label);
    trigger.disabled = select.disabled;
    if (!menu.hidden) render();
  }
  trigger.addEventListener('click', () => (menu.hidden ? open() : close()));
  select.addEventListener('change', sync);
  for (const label of select.labels)
    label.addEventListener('click', (event) => {
      event.preventDefault();
      trigger.focus();
    });
  wrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      // Home/End still move the search caret; arrow keys select candidate languages.
      if (event.target === search && ['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (menu.hidden) {
        open();
        return;
      }
      const available = rows.map((row, i) => (row.option.disabled ? -1 : i)).filter((i) => i >= 0);
      const current = available.indexOf(active);
      const next =
        event.key === 'Home'
          ? available[0]
          : event.key === 'End'
            ? available.at(-1)
            : available[
                (current + (event.key === 'ArrowDown' ? 1 : -1) + available.length) %
                  available.length
              ];
      activate(next ?? -1, true);
    } else if (event.key === 'Enter' && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      choose(active);
    }
  });
  // composedPath recognizes clicks inside Shadow DOM so outside listeners do not close their own menus.
  doc.addEventListener(
    'pointerdown',
    (event) => {
      if (!menu.hidden && !event.composedPath().includes(wrapper)) close();
    },
    true,
  );
  wrapper.addEventListener('focusout', () =>
    queueMicrotask(() => {
      if (!wrapper.contains(root.activeElement)) close();
    }),
  );
  doc.defaultView.addEventListener('resize', () => {
    if (!menu.hidden) position();
  });
  doc.addEventListener(
    'scroll',
    (event) => {
      if (!menu.hidden && !event.composedPath().includes(menu)) position();
    },
    true,
  );
  const instance = { sync, close };
  onLocaleChange(() => {
    const label = [...select.labels].map((label) => label.textContent.trim()).join(' ') || t(name);
    trigger.setAttribute('aria-label', label);
    list.setAttribute('aria-label', label);
    if (search) {
      search.placeholder = t('languages.search');
      search.setAttribute('aria-label', label);
    }
    close();
    sync();
  });
  instances.set(select, instance);
  sync();
  return instance;
}

export function refreshSelect(select) {
  instances.get(select)?.sync();
}

export function closeSelect(select) {
  instances.get(select)?.close();
}
