(() => {
  const app = (globalThis.LiteSay ||= {});
  if (app.plugins.has('selection')) return;
  /**
   * Selection coordinator: show a dot after selection stabilizes; send text and open the card only on click/keyboard activation.
   * utils/dom/text-targets.js collects text and views/selection displays it; this module manages its own interaction runs only.
   * epoch isolates translations, captureVersion isolates selection/settings reads, and stale responses cannot reopen a closed card.
   */
  class SelectionTranslationController {
    epoch = 0;
    captureVersion = 0;
    selecting = false;
    constructor({ message, readSettings }) {
      Object.assign(this, { message, readSettings });
      this.view = new app.TranslationPopup({
        translate: (focus) => this.translate({ focus }),
        close: () => this.dismiss({ restoreFocus: true }),
        copy: () => this.copyResult(),
        options: () =>
          this.message({ type: 'OPEN_OPTIONS' }).catch((error) => this.view.info(error.message)),
      });
      document.addEventListener(
        'pointerdown',
        (event) => {
          if (!this.enabled) return;
          if (this.view.contains(event)) return;
          this.selecting = true;
          this.dismiss();
        },
        true,
      );
      document.addEventListener(
        'pointerup',
        (event) => {
          this.selecting = false;
          if (!this.enabled) return;
          const key = this.settings?.selectionTrigger;
          if (['ctrl', 'alt', 'shift'].includes(key) && event[`${key}Key`])
            this.shortcutRequested = true;
          if (!this.view.contains(event)) this.scheduleSelection();
        },
        true,
      );
      document.addEventListener('pointercancel', () => {
        this.selecting = false;
      });
      document.addEventListener('selectionchange', () => {
        // Copying card text must not trigger a new selection translation; expanding the page selection invalidates the previous capture.
        if (!this.enabled || this.selecting || this.selectionInsideUi()) return;
        this.scheduleSelection();
      });
      document.addEventListener('keyup', (event) => {
        if (event.shiftKey || event.key === 'Shift') this.scheduleSelection();
      });
      document.addEventListener('keydown', (event) => {
        if (!this.enabled) return;
        if (event.key === 'Escape' && this.view.visible) this.dismiss({ restoreFocus: true });
        const key = { Control: 'ctrl', Alt: 'alt', Shift: 'shift' }[event.key];
        if (!event.repeat && key && key === this.settings?.selectionTrigger) {
          this.shortcutRequested = true;
          this.scheduleSelection();
        }
      });
      document.addEventListener(
        'scroll',
        (event) => {
          if (!this.view.contains(event)) this.dismiss();
        },
        true,
      );
      window.addEventListener('resize', () => this.dismiss());
      window.addEventListener('blur', () => this.dismiss());
    }
    configure(settings) {
      this.settings = settings;
      if (!settings.selectionTranslation) this.dismiss();
    }
    get enabled() {
      return this.settings?.selectionTranslation === true;
    }
    selectionInsideUi() {
      const node = window.getSelection()?.anchorNode;
      return node?.getRootNode() === this.view.root || app.textTargets.insideUi(node);
    }
    /** Do not capture while dragging; show the dot after 350ms of stable selection, before sending text to any service. */
    scheduleSelection() {
      if (!this.enabled) return;
      clearTimeout(this.captureTimer);
      const version = ++this.captureVersion;
      this.captureTimer = setTimeout(() => this.captureSelection(version), 350);
    }
    async captureSelection(version) {
      if (!this.enabled || version !== this.captureVersion || this.selecting) return;
      const snapshot = app.textTargets.selection();
      if (!snapshot) {
        this.dismiss();
        return;
      }
      if (
        snapshot.text === this.text &&
        app.textTargets.sameRange(snapshot.range, this.range) &&
        this.view.visible
      )
        return;
      try {
        const result = await this.readSettings({
          isCurrent: () =>
            this.enabled &&
            version === this.captureVersion &&
            !this.selecting &&
            app.textTargets.sameRange(app.textTargets.selection()?.range, snapshot.range),
        });
        if (!result) return;
        const { settings, providerLabel } = result;
        if (
          version !== this.captureVersion ||
          this.selecting ||
          !app.textTargets.sameRange(app.textTargets.selection()?.range, snapshot.range)
        )
          return;
        const shortcut = this.shortcutRequested;
        this.dismiss();
        this.entry = 'selection';
        this.configure(settings);
        if (!settings.selectionTranslation) return;
        this.text = snapshot.text;
        this.range = snapshot.range;
        this.anchor = snapshot.rect;
        this.view.service(providerLabel);
        if (
          settings.selectionTrigger === 'direct' ||
          (shortcut && ['ctrl', 'alt', 'shift'].includes(settings.selectionTrigger))
        )
          await this.translate();
        else if (['dot', 'icon'].includes(settings.selectionTrigger))
          this.view.showDot(providerLabel, this.anchor, settings.selectionTrigger);
      } catch {
        /* After extension reload, wait for the user to refresh without interrupting normal page selection. */
      }
    }
    /** Show loading state before checking current settings; retries start a new run, and discard stale results after closure. */
    async translate({ focus = false } = {}) {
      if (!this.enabled || !this.text || this.pending) return;
      const epoch = ++this.epoch,
        text = this.text;
      this.pending = true;
      this.translatedText = '';
      this.previousFocus =
        document.activeElement === this.view.host ? this.previousFocus : document.activeElement;
      this.view.loading(text, this.entry, this.anchor, focus);
      try {
        const ready = await this.readSettings({
          ready: true,
          isCurrent: () => this.enabled && epoch === this.epoch,
        });
        if (!ready) return;
        const { settings, providerLabel } = ready;
        if (epoch !== this.epoch) return;
        this.configure(settings);
        if (epoch !== this.epoch) return;
        this.view.service(providerLabel);
        const result = await this.message({
          type: 'TRANSLATE_TEXT',
          text,
          epoch,
          entry: this.entry,
          signature: JSON.stringify(settings),
        });
        if (epoch !== this.epoch) return;
        if (typeof result.text !== 'string' || !result.text.trim())
          throw new Error('errors.emptyResponse');
        this.translatedText = result.text;
        const info =
          result.text.trim() === text.trim()
            ? { source: 'selection.originalReturned' }
            : {
                source: 'selection.translatedTo',
                params: {
                  language: globalThis.LiteSayLanguages.languageName(settings.targetLanguage),
                },
              };
        this.view.complete(result.text, info, settings.targetLanguage);
      } catch (error) {
        if (epoch === this.epoch) this.view.error(error.message);
      } finally {
        if (epoch === this.epoch) {
          this.pending = false;
          this.view.finish(this.anchor);
        }
      }
    }
    /** On copy failure, retain plain text for manual selection without requesting extra clipboard permissions. */
    async copyResult() {
      if (!this.translatedText) return;
      const epoch = this.epoch;
      try {
        await navigator.clipboard.writeText(this.translatedText);
        if (epoch === this.epoch) this.view.copied();
      } catch {
        if (epoch === this.epoch) this.view.info('selection.clipboardError');
      }
    }
    /** Close locally immediately, then notify background cancellation; affect only this card while full-page translation continues. */
    dismiss({ restoreFocus = false } = {}) {
      clearTimeout(this.captureTimer);
      this.captureVersion++;
      if (this.pending)
        this.message({ type: 'CANCEL_SELECTION', epoch: this.epoch }).catch(() => {});
      this.epoch++;
      this.pending = false;
      this.text = '';
      this.shortcutRequested = false;
      this.range = null;
      this.translatedText = '';
      this.view.clear();
      if (restoreFocus && this.previousFocus?.isConnected)
        this.previousFocus.focus({ preventScroll: true });
    }
  }
  app.SelectionTranslationController = SelectionTranslationController;
  app.plugins.register({
    id: 'selection',
    create: (context) => {
      const controller = new SelectionTranslationController(context);
      return {
        configure: (settings) => controller.configure(settings),
        onSettingsChanged: () => controller.dismiss(),
      };
    },
  });
})();
