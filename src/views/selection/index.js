(() => {
  const app = (globalThis.LiteSay ||= {});
  const { t, localize, onLocaleChange, setMessage } = globalThis.LiteSayI18n;
  /** Shared result view renders plain text, positioning, and interactions only; no collection, settings reads, or service requests. */
  class TranslationPopup {
    constructor(actions) {
      this.host = document.createElement('div');
      this.host.dataset.litesaySelection = '';
      this.root = this.host.attachShadow({ mode: 'open' });
      // Keep local static templates separate from dynamic content; write service results through textContent.
      this.root.innerHTML = globalThis.LiteSayViews.selection;
      localize(this.root);
      onLocaleChange(() => {
        localize(this.root);
        if (this.providerLabel) this.service(this.providerLabel);
        if (this.targetLanguage && this.infoSource === 'selection.translatedTo')
          this.info('selection.translatedTo', {
            language: globalThis.LiteSayLanguages.languageName(this.targetLanguage),
          });
        if (this.result.querySelector('.loading'))
          this.result.lastChild.textContent = t('status.translating');
        if (this.errorSource) this.result.textContent = t(this.errorSource);
      });
      this.trigger = this.root.querySelector('.trigger');
      this.card = this.root.querySelector('.card');
      this.result = this.root.querySelector('.result');
      this.copy = this.root.querySelector('.copy');
      this.retry = this.root.querySelector('.retry');
      document.documentElement.append(this.host);
      // Mouse clicks must not collapse the original selection first; Enter/Space use native button activation.
      this.trigger.addEventListener('pointerdown', (event) => event.preventDefault());
      // Focus the close button only on keyboard activation; mouse opening must not leave a programmatic focus ring.
      this.trigger.onclick = (event) => actions.translate(event.detail === 0);
      this.root.querySelector('.close').onclick = actions.close;
      this.root.querySelector('.service').onclick = actions.options;
      this.copy.onclick = actions.copy;
      this.retry.onclick = (event) => actions.translate(event.detail === 0);
    }
    get visible() {
      return !this.trigger.hidden || !this.card.hidden;
    }
    contains(event) {
      return event.composedPath().includes(this.host);
    }
    service(label) {
      this.providerLabel = label;
      this.root.querySelector('.service').textContent = t(label) + ' ↗';
    }
    info(source, params = {}) {
      this.infoSource = source;
      setMessage(this.root.querySelector('.info'), source, params);
    }
    showDot(label, anchor, kind = 'dot') {
      this.service(label);
      this.trigger.style.width = kind === 'icon' ? '30px' : '12px';
      this.trigger.style.height = kind === 'icon' ? '30px' : '12px';
      this.trigger.replaceChildren();
      if (kind === 'icon') this.trigger.append(globalThis.LiteSayProviderIcons.uiIcon('translate'));
      this.trigger.hidden = false;
      this.place(anchor);
    }
    loading(text, entry, anchor, focus) {
      this.trigger.hidden = true;
      this.card.hidden = false;
      this.errorSource = '';
      this.targetLanguage = null;
      const titleSource = entry === 'hover' ? 'hover.title' : 'selection.title';
      const title = t(titleSource);
      this.card.setAttribute('aria-label', title);
      this.card.dataset.i18nAriaLabel = titleSource;
      setMessage(this.root.querySelector('.header strong'), titleSource);
      const source = this.root.querySelector('.source');
      source.textContent = text;
      source.classList.toggle('word', /^[\p{L}\p{M}'’-]+$/u.test(text));
      const spinner = document.createElement('span');
      spinner.className = 'loading';
      spinner.setAttribute('aria-hidden', 'true');
      this.result.classList.remove('error');
      this.result.replaceChildren(spinner, document.createTextNode(t('status.translating')));
      this.card.setAttribute('aria-busy', 'true');
      this.copy.disabled = true;
      setMessage(this.copy, 'selection.copy');
      this.retry.hidden = true;
      this.info('selection.savedPreferences');
      this.place(anchor);
      // Keyboard activation enters the card with visible focus and Tab navigation; mouse clicks retain natural focus.
      if (focus) this.root.querySelector('.close').focus({ preventScroll: true });
    }
    complete(text, info, targetLanguage) {
      this.targetLanguage = targetLanguage;
      this.result.textContent = text;
      this.info(info.source, info.params);
      this.copy.disabled = false;
    }
    error(text) {
      this.errorSource = text;
      this.result.textContent = t(text);
      this.result.classList.add('error');
      this.retry.hidden = false;
      this.info('selection.retryHelp');
    }
    finish(anchor) {
      this.card.removeAttribute('aria-busy');
      this.place(anchor);
    }
    copied() {
      setMessage(this.copy, 'selection.copied');
    }
    /** Position in viewport coordinates; open upward when bottom space is insufficient and scroll long content inside the card. */
    place(anchor) {
      if (!anchor) return;
      const rect = this.card.hidden
        ? this.trigger.getBoundingClientRect()
        : this.card.getBoundingClientRect();
      const left = Math.max(12, Math.min(anchor.right, innerWidth - rect.width - 12));
      const below = anchor.bottom + 8;
      const top = below + rect.height <= innerHeight - 12 ? below : anchor.top - rect.height - 8;
      this.host.style.setProperty('left', left + 'px', 'important');
      this.host.style.setProperty(
        'top',
        Math.max(12, Math.min(top, innerHeight - rect.height - 12)) + 'px',
        'important',
      );
    }
    clear() {
      this.errorSource = '';
      this.targetLanguage = null;
      this.trigger.hidden = true;
      this.card.hidden = true;
      this.result.textContent = '';
      this.root.querySelector('.source').textContent = '';
      this.card.removeAttribute('aria-busy');
    }
  }
  app.TranslationPopup = TranslationPopup;
})();
