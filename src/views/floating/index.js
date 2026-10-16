(() => {
  const app = (globalThis.LiteSay ||= {});
  const { orderedLanguages } = globalThis.LiteSayLanguages;
  const { enhanceSelect, refreshSelect, closeSelect } = globalThis.LiteSaySelectUi;
  const { providerIcon } = globalThis.LiteSayProviderIcons;
  const ICONS = globalThis.LiteSayResources.UI_ICON_RESOURCES;
  const { t, setLocale, getLocale, localize, setMessage } = globalThis.LiteSayI18n;
  /**
   * Interaction/display only. actions injects controller methods; UI does not call translation APIs or manipulate page content.
   * Controllers save settings before UI feedback and update progress through status().
   */
  class Dock {
    constructor(actions) {
      this.actions = actions;
      this.host = document.createElement('div');
      this.host.dataset.litesayUi = '';
      // Shadow DOM isolates panel styles; page translations still inherit original paragraph styles.
      this.root = this.host.attachShadow({ mode: 'open' });
      // Write local static templates only; set user languages and API translations with DOM APIs / textContent.
      this.root.innerHTML = globalThis.LiteSayViews.floating;
      globalThis.LiteSayLocaleSwitch.mountLocaleSwitch(this.$('#ui-locale'), async (locale) => {
        try {
          await actions.locale(locale);
        } catch (error) {
          this.status(error.message, true);
        }
      });
      // Do not move original page elements; fix the overlay to the viewport's right. Exclude every UI node from content extraction.
      document.documentElement.append(this.host);
      for (const id of ['source', 'target']) this.populate(this.$(`#${id}`), id === 'source');
      // The checkmark is inside the button, so clicks bubble to the same translation/restoration entry point.
      this.$('#quick').onclick = () => actions.toggle();
      this.$('#translate').onclick = () => actions.toggle();
      this.$('#options').onclick = () => actions.options();
      this.$('#cache-options').onclick = () => actions.options();
      this.$('#selection-settings').onclick = () => this.openFeature('selection');
      this.$('#hover-settings').onclick = () => this.openFeature('hover');
      for (const button of this.root.querySelectorAll('.feature-close'))
        button.onclick = () => this.closeFeatures();
      this.$('#display-toggle').onclick = () => {
        this.mode = this.mode === 'bilingual' ? 'translation-only' : 'bilingual';
        this.change();
      };
      for (const [attribute, field] of [
        ['selection-trigger', 'selectionTrigger'],
        ['hover-trigger', 'hoverTrigger'],
        ['hover-action', 'hoverAction'],
      ])
        for (const button of this.root.querySelectorAll(`[data-${attribute}]`))
          button.onclick = () => {
            this.settings = { ...this.settings, [field]: button.getAttribute(`data-${attribute}`) };
            this.change();
          };
      this.$('#selection-enabled').onchange = () => {
        this.$('#more-selection').checked = this.$('#selection-enabled').checked;
      };
      this.$('#hover-enabled').onchange = () => {
        this.$('#more-hover').checked = this.$('#hover-enabled').checked;
      };
      this.$('#settings').onclick = () => this.toggle();
      this.$('#more').onclick = () => this.toggleMore(true);
      this.$('.more-close').onclick = () => this.toggleMore(false);
      for (const button of this.root.querySelectorAll('[data-mode]'))
        button.onclick = () => {
          this.mode = button.dataset.mode;
          this.change();
        };
      this.$('.close').onclick = () => this.toggle(false);
      for (const element of this.root.querySelectorAll('select,input'))
        element.addEventListener('change', () => this.change());
      for (const select of this.root.querySelectorAll('select'))
        enhanceSelect(
          select,
          select.id === 'provider'
            ? {
                optionIcon: (id) => providerIcon(id, document, this.settings?.customApiIcon),
                showSelectedIcon: false,
              }
            : {},
        );
      // Capture listeners bypass page-stopped bubbling; composedPath preserves interaction ownership inside Shadow DOM.
      // Check on pointer-down only so dragging out of the panel and releasing does not accidentally close it.
      this.onOutsidePointerDown = (event) => {
        if (!event.composedPath().includes(this.host)) this.toggle(false);
      };
      for (const overlay of this.root.querySelectorAll('.more-overlay'))
        overlay.addEventListener('pointerdown', (event) => {
          if (event.target !== overlay) return;
          if (overlay.classList.contains('feature-modal')) this.closeFeatures();
          else this.toggleMore(false);
        });
      this.root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          if (!this.$('#selection-modal').hidden || !this.$('#hover-modal').hidden) {
            this.closeFeatures();
            return;
          }
          if (!this.$('.more-overlay').hidden) this.toggleMore(false);
          else this.toggle(false);
        }
      });
      localize(this.root);
      // Page cleanup may remove the overlay; reattach the same host to preserve controls, settings, and translation state.
      this.mountObserver = new MutationObserver(() => {
        if (this.host.parentNode !== document.documentElement)
          document.documentElement.append(this.host);
      });
      this.mountObserver.observe(document.documentElement, { childList: true });
    }
    $(selector) {
      return this.root.querySelector(selector);
    }
    populate(select, source) {
      select.replaceChildren();
      if (source) select.add(new Option(t('languages.auto'), 'auto'));
      for (const language of orderedLanguages()) {
        const option = new Option(language.name, language.code);
        option.dataset.search = language.search;
        select.add(option);
      }
      select.add(new Option(t('languages.custom'), '__custom'));
    }
    setLocale(locale) {
      setLocale(locale);
      this.host.lang = getLocale();
      for (const id of ['source', 'target']) this.populate(this.$(`#${id}`), id === 'source');
      if (this.settings) this.setSettings(this.settings, this.providers);
      localize(this.root);
      for (const select of this.root.querySelectorAll('select')) refreshSelect(select);
    }
    /** Background settings may contain custom language codes; do not fall back to the first select option when one is missing. */
    setSettings(settings, providers) {
      // Service names come from the public background catalog; new model presets need no duplicate floating-panel options.
      if (providers)
        this.$('#provider').replaceChildren(
          ...providers.map((provider) => new Option(t(provider.label), provider.id)),
        );
      if (providers) this.providers = providers;
      this.settings = settings;
      this.$('#provider').value = settings.provider;
      this.mode = settings.displayMode || 'bilingual';
      // Mode icons and descriptions share the resource catalog; the graphic shows current mode and the label describes the next action.
      const displayButton = this.$('#display-toggle');
      displayButton.innerHTML =
        ICONS[this.mode === 'bilingual' ? 'display-bilingual' : 'display-translation'];
      displayButton.dataset.modeIcon = this.mode;
      const modeDescription =
        this.mode === 'bilingual'
          ? t('translation.switchToOnly')
          : t('translation.switchToBilingual');
      displayButton.setAttribute('aria-label', modeDescription);
      displayButton.title = modeDescription;
      this.$('#selection-enabled').checked = settings.selectionTranslation;
      this.$('#hover-enabled').checked = settings.hoverTranslation;
      for (const [attribute, field] of [
        ['selection-trigger', 'selectionTrigger'],
        ['hover-trigger', 'hoverTrigger'],
        ['hover-action', 'hoverAction'],
      ])
        for (const button of this.root.querySelectorAll(`[data-${attribute}]`))
          button.setAttribute(
            'aria-pressed',
            String(button.getAttribute(`data-${attribute}`) === settings[field]),
          );
      this.$('#hover-key').textContent = {
        ctrl: 'Ctrl',
        alt: 'Alt',
        shift: 'Shift',
        hold: t('hover.hold'),
        direct: t('hover.triggerLabel'),
      }[settings.hoverTrigger];
      this.$('#more-style').value = settings.translationStyle || 'none';
      this.$('#more-selection').checked = settings.selectionTranslation;
      this.$('#more-hover').checked = settings.hoverTranslation;
      for (const button of this.root.querySelectorAll('[data-mode]'))
        button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
      this.$('.hint').textContent =
        settings.displayMode === 'translation-only'
          ? t('translation.onlyHelp')
          : t('translation.bilingualHelp');
      this.serviceIcon(settings.provider);
      for (const [id, key] of [
        ['source', 'sourceLanguage'],
        ['target', 'targetLanguage'],
      ]) {
        const select = this.$(`#${id}`),
          input = this.$(`#${id}-custom`);
        const known = [...select.options].some((option) => option.value === settings[key]);
        select.value = known ? settings[key] : '__custom';
        input.hidden = known;
        input.value = known ? '' : settings[key];
      }
      for (const select of this.root.querySelectorAll('select')) refreshSelect(select);
      localize(this.root);
      for (const select of this.root.querySelectorAll('select')) refreshSelect(select);
    }
    /** Update local icons with the service; page UI knows service IDs only, never endpoints or keys. */
    serviceIcon(provider) {
      const icon = this.$('#service-icon');
      icon.className = 'service-icon';
      icon.dataset.provider = provider;
      icon.replaceChildren(providerIcon(provider, document, this.settings?.customApiIcon));
      this.$('.badge').textContent = ['microsoft', 'google'].includes(provider)
        ? t('common.free')
        : 'API';
    }
    async change() {
      const settings = {
        provider: this.$('#provider').value,
        displayMode: this.mode,
        selectionTrigger: this.settings.selectionTrigger,
        hoverTrigger: this.settings.hoverTrigger,
        hoverAction: this.settings.hoverAction,
        translationStyle: this.$('#more-style').value,
        selectionTranslation: this.$('#more-selection').checked,
        hoverTranslation: this.$('#more-hover').checked,
      };
      for (const [id, key] of [
        ['source', 'sourceLanguage'],
        ['target', 'targetLanguage'],
      ]) {
        const select = this.$(`#${id}`),
          input = this.$(`#${id}-custom`);
        input.hidden = select.value !== '__custom';
        settings[key] = select.value === '__custom' ? input.value.trim() : select.value;
        if (!globalThis.LiteSayLanguages.isLanguageCode(settings[key], id === 'source')) {
          this.status('languages.invalidInput', true);
          return;
        }
      }
      try {
        await this.actions.settings(settings);
        this.setSettings({ ...this.settings, ...settings });
        this.serviceIcon(settings.provider);
        this.status('floating.saved');
      } catch (error) {
        this.status(error.message, true);
      }
    }
    /** The more panel reuses public settings APIs; do not add site or service business logic to UI. */
    closeFeatures() {
      this.$('#selection-modal').hidden = true;
      this.$('#hover-modal').hidden = true;
    }
    openFeature(name) {
      this.closeFeatures();
      this.$('.more-overlay').hidden = true;
      this.$(`#${name}-modal`).hidden = false;
      this.$(`#${name}-modal .feature-close`).focus();
    }
    toggleMore(show) {
      this.closeFeatures();
      for (const select of this.root.querySelectorAll('select')) closeSelect(select);
      this.$('.more-overlay').hidden = !show;
      if (show) this.$('.more-close').focus();
      else this.$('#more').focus();
    }
    toggle(force) {
      const panel = this.$('.panel');
      panel.hidden = force === undefined ? !panel.hidden : !force;
      if (panel.hidden)
        for (const select of this.root.querySelectorAll('select')) closeSelect(select);
      if (panel.hidden) this.$('.more-overlay').hidden = true;
      if (panel.hidden) this.closeFeatures();
      // External listeners exist only while the panel is open; explicit close, Escape, and outside clicks share cleanup.
      if (panel.hidden)
        document.removeEventListener('pointerdown', this.onOutsidePointerDown, true);
      else document.addEventListener('pointerdown', this.onOutsidePointerDown, true);
      this.$('#settings').setAttribute('aria-expanded', String(!panel.hidden));
      this.$('.toast').hidden = true;
    }
    status(message, error = false, { toast = true, params = {} } = {}) {
      const status = this.$('.status');
      setMessage(status, message, params);
      status.classList.toggle('error', error);
      if (toast && error && this.$('.panel').hidden) {
        setMessage(this.$('.toast'), message, params);
        this.$('.toast').hidden = false;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
          this.$('.toast').hidden = true;
        }, 6500);
      }
    }
    /** The controller supplies state explicitly, not through progress-message inference; restoration remains available during requests. */
    setTranslationState(active) {
      const button = this.$('#quick');
      button.classList.toggle('done', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? t('floating.restorePage') : t('floating.quick'));
      button.title = active ? t('floating.stop') : t('floating.quick');
      this.$('#translate').textContent = active ? t('floating.restore') : t('floating.translate');
      localize(this.root);
    }
  }
  app.Dock = Dock;
})();
