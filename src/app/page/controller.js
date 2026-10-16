(() => {
  const app = globalThis.LiteSay;
  if (app.controller) return; // The toolbar may inject scripts again; create only one controller.
  /**
   * Full-page coordinator: read settings, collect paragraphs, request the background, then render.
   * Each run owns an epoch; restoration or restart invalidates previous asynchronous responses.
   * Other modules handle UI, DOM rules, and protocols; selection translation has independent request runs.
   */
  class PageController {
    epoch = 0;
    running = false;
    starting = false;
    queue = [];
    inflight = 0;
    completed = 0;
    failed = 0;
    settingsVersion = 0;
    pageTranslationEnabled = false;
    retries = new Map();
    // Separate successful document caches from DOM records: X rebuilds nodes while scrolling, and restoration removes display nodes only.
    translationCache = new Map();
    cacheCharacters = 0;
    suppressedParagraphs = new WeakMap();
    constructor() {
      this.renderer = new app.TranslationRenderer();
      this.dock = new app.Dock({
        // start() already displays UI errors; consume Promise rejections to avoid unhandled browser errors.
        translate: () => this.enable().catch(() => {}),
        toggle: () => this.toggle().catch(() => {}),
        settings: (settings) => this.updateSettings(settings),
        options: () => this.message({ type: 'OPEN_OPTIONS' }),
        locale: async (uiLocale) => {
          const saved = await this.message({ type: 'SET_UI_LOCALE', uiLocale });
          this.dock.setLocale(saved.uiLocale);
        },
      });
      this.features = app.plugins.instantiate({
        message: (payload) => this.message(payload),
        readSettings: (options) => this.readSettings(options),
        renderer: this.renderer,
        suppress: (element, text, skip) =>
          skip
            ? this.suppressedParagraphs.set(element, text)
            : this.suppressedParagraphs.delete(element),
        status: (message) => this.dock.status(message, true, { toast: false }),
      });
      this.ready = this.reloadSettings().catch((error) => this.dock.status(error.message, true));
      this.ready.then(() => this.resume()).catch(() => {});
      document.addEventListener('keydown', (event) => {
        const target = event.composedPath()[0];
        if (
          !event.repeat &&
          event.altKey &&
          !event.ctrlKey &&
          event.code === 'KeyA' &&
          !(
            target instanceof Element &&
            (target.closest('input,textarea,select,[contenteditable]') ||
              app.textTargets.insideUi(target))
          )
        ) {
          event.preventDefault();
          this.toggle().catch(() => {});
        }
      });
      this.observer = new MutationObserver((mutations) => {
        const changed = mutations.some((mutation) => {
          const element =
            mutation.target.nodeType === Node.ELEMENT_NODE
              ? mutation.target
              : mutation.target.parentElement;
          if (
            element?.closest(
              '[data-litesay-ui],[data-litesay-selection],[data-litesay-translation]',
            )
          )
            return false;
          if (mutation.type === 'attributes')
            return !mutation.attributeName.startsWith('data-litesay-');
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          return (
            mutation.type === 'characterData' ||
            nodes.some(
              (node) =>
                !(
                  node.nodeType === Node.ELEMENT_NODE &&
                  node.matches(
                    '[data-litesay-translation],[data-litesay-ui],[data-litesay-selection]',
                  )
                ),
            )
          );
        });
        if (changed) {
          if (!this.running) {
            this.renderer.prune();
            for (const [element, record] of this.renderer.records)
              if (app.dom.textOf(element) !== record.text) this.renderer.remove(element);
            return;
          }
          // Share one pending scan across continuous page changes so frequent attribute updates do not indefinitely postpone new content.
          if (!this.scanTimer)
            this.scanTimer = setTimeout(() => {
              this.scanTimer = null;
              this.scan();
            }, 400);
        }
      });
      this.observeContent();
      globalThis.LiteSayPlatform.onMessage((message, _sender, respond) => {
        if (message.type === 'UI_LOCALE_CHANGED') {
          this.message({ type: 'GET_UI_LOCALE' }).then(
            ({ uiLocale }) => {
              this.dock.setLocale(uiLocale);
              respond({ ok: true });
            },
            () => respond({ ok: false }),
          );
          return true;
        }
        if (['PUBLIC_SETTINGS_CHANGED', 'PAGE_TRANSLATION_CHANGED'].includes(message.type)) {
          if (message.type === 'PUBLIC_SETTINGS_CHANGED') {
            this.restore();
            this.features.settingsChanged();
          }
          this.reloadSettings()
            .then(() => this.resume())
            .then(
              () => respond({ ok: true }),
              () => respond({ ok: false }),
            );
          return true;
        }
        if (message.type === 'CACHE_CLEARED') {
          this.restore();
          this.features.settingsChanged();
          this.translationCache.clear();
          this.cacheCharacters = 0;
          respond({ ok: true });
          return false;
        }
        if (message.type !== 'PAGE_ACTION') return false;
        if (message.action === 'restore') {
          this.disable().then(
            () => respond({ ok: true }),
            (error) => respond({ error: error.message }),
          );
          return true;
        }
        (message.action === 'toggle' ? this.toggle() : this.enable()).then(
          () => respond({ ok: true }),
          (error) => respond({ error: error.message }),
        );
        return true;
      });
    }
    observeContent() {
      this.observer.disconnect();
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: app.siteRules.observedAttributes(),
      });
      for (const host of app.siteRules.renderedTextElements(document.body))
        if (host.shadowRoot)
          this.observer.observe(host.shadowRoot, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: app.siteRules.observedAttributes(),
          });
    }
    /** Wrap browser messages in Promises and provide an actionable refresh prompt when the extension reloads. */
    async message(payload) {
      let response;
      try {
        response = await globalThis.LiteSayPlatform.sendMessage(payload);
      } catch {
        throw new Error('errors.extensionUpdated');
      }
      if (!response?.ok)
        throw Object.assign(new Error(response?.error || 'errors.serviceUnresponsive'), {
          retryable: response?.retryable === true,
          retryAfterMs: response?.retryAfterMs || 0,
        });
      return response;
    }
    /** The host applies shared site rules; reads have no side effects after the plugin run or host configuration changes. */
    async requestSettings(payload, isCurrent = () => true) {
      const version = this.settingsVersion;
      let result;
      try {
        result = await this.message(payload);
      } catch (error) {
        if (version !== this.settingsVersion || !isCurrent()) return null;
        throw error;
      }
      if (version !== this.settingsVersion || !isCurrent()) return null;
      app.siteRules.configure(result.siteRules);
      this.observeContent();
      return result;
    }
    readSettings({ ready = false, isCurrent } = {}) {
      return this.requestSettings(
        { type: ready ? 'CHECK_READY' : 'GET_PUBLIC_SETTINGS' },
        isCurrent,
      );
    }
    async reloadSettings() {
      this.settingsVersion++;
      const result = await this.readSettings();
      if (!result) return;
      this.settings = result.settings;
      this.pageTranslationEnabled = result.pageTranslationEnabled === true;
      this.dock.setLocale(result.uiLocale);
      this.dock.setSettings(this.settings, result.providers);
      this.features.configure(this.settings);
      this.renderer.configure(this.settings);
    }
    /** New documents and settings updates preserve the user's switch; internal restoration cancels only the run, not the preference. */
    async resume() {
      if (this.pageTranslationEnabled) {
        if (!this.running && !this.starting) await this.start();
      } else if (this.running || this.starting) this.restore();
    }
    async persistEnabled(enabled) {
      this.pageTranslationEnabled = enabled;
      try {
        await this.message({ type: 'SET_PAGE_TRANSLATION_ENABLED', enabled });
      } catch (error) {
        this.dock.status(error.message, true);
        throw error;
      }
    }
    async enable() {
      await this.start();
      if (this.running) await this.persistEnabled(true);
    }
    async disable() {
      this.restore();
      await this.persistEnabled(false);
    }
    async updateSettings(settings) {
      this.settingsVersion++;
      this.restore();
      this.features.settingsChanged();
      const result = await this.requestSettings({ type: 'UPDATE_PUBLIC_SETTINGS', settings });
      if (!result) return;
      this.settings = result.settings;
      this.features.configure(this.settings);
      this.renderer.configure(this.settings);
      await this.resume();
    }
    async start() {
      if (this.starting) return;
      let token = this.epoch;
      this.starting = true;
      this.dock.setTranslationState(true);
      try {
        await this.ready;
        if (token !== this.epoch) return;
        const result = await this.readSettings({
          ready: true,
          isCurrent: () => token === this.epoch,
        });
        if (!result) return;
        const { settings, siteRules, providers } = result;
        // Restoration may occur during configuration checks; a late check result must not restart translation.
        if (token !== this.epoch) return;
        if (this.running && JSON.stringify(settings) === this.signature && !this.failed) {
          this.dock.status(
            this.inflight || this.queue.length ? 'status.translatingPage' : 'status.complete',
            false,
            { params: { count: this.completed } },
          );
          return;
        }
        this.restore();
        token = this.epoch;
        this.settings = settings;
        this.dock.setSettings(settings, providers);
        this.features.configure(settings);
        this.renderer.configure(settings);
        this.signature = JSON.stringify(settings);
        // Display and filter rules do not change translations; a public revision isolates private service configuration changes.
        this.translationKey = JSON.stringify([
          settings.provider,
          settings.sourceLanguage,
          settings.targetLanguage,
          settings.configRevision,
          siteRules.preserveMentions === true,
        ]);
        this.running = true;
        this.dock.setTranslationState(true);
        this.scan();
      } catch (error) {
        if (token !== this.epoch) return;
        if (!this.running) this.dock.setTranslationState(false);
        this.dock.status(error.message, true);
        throw error;
      } finally {
        if (token === this.epoch) this.starting = false;
      }
    }
    /** Shortcut buttons and the toolbar share the toggle entry point; the page-translation menu action can still retry failed paragraphs. */
    async toggle() {
      if (this.running || this.starting) await this.disable();
      else await this.enable();
    }
    /** Queue only new or changed paragraphs; do not duplicate existing successful or pending records. */
    scan() {
      if (!this.running) return;
      this.observeContent();
      this.renderer.prune();
      // After rule or visibility changes, old branches must not retain translation or pending nodes even if still in the DOM.
      for (const [element, record] of this.renderer.records)
        if (app.dom.textOf(element) !== record.text) this.renderer.remove(element);
      for (const { element, text } of app.dom.collect()) {
        if (this.suppressedParagraphs.get(element) === text) continue;
        if (
          globalThis.LiteSayLanguagePolicy.isAlreadyTargetLanguage(
            text,
            this.settings.targetLanguage,
          )
        ) {
          // Dynamic lists may reuse elements; remove earlier translation/pending nodes when the source changes to Chinese.
          this.renderer.remove(element);
          continue;
        }
        if (this.renderer.records.get(element)?.text === text) continue;
        const record = this.renderer.create(element, text, this.settings.targetLanguage);
        const cached = this.cachedTranslation(text);
        if (cached !== undefined) {
          if (this.renderer.complete(record, cached)) this.completed++;
          continue;
        }
        this.queue.push({ record, epoch: this.epoch, signature: this.signature });
      }
      this.scheduleRetries();
      this.pump();
      this.progress();
    }
    /** Cache by source text and actual translation settings within the document; render cache hits in this frame without flashing a spinner. */
    cachedTranslation(text) {
      const key = `${this.translationKey}:${text}`;
      const cached = this.translationCache.get(key);
      // Page-local cache lasts one hour; long-lived pages must still check the age of the background's seven-day persistent cache.
      if (cached && Date.now() - cached.createdAt >= 60 * 60 * 1000) {
        this.cacheCharacters -= key.length + cached.text.length;
        this.translationCache.delete(key);
        return undefined;
      }
      if (cached !== undefined) {
        this.translationCache.delete(key);
        this.translationCache.set(key, cached);
      }
      return cached?.text;
    }
    rememberTranslation(text, translation) {
      const key = `${this.translationKey}:${text}`;
      const previous = this.translationCache.get(key);
      if (previous !== undefined) this.cacheCharacters -= key.length + previous.text.length;
      this.translationCache.delete(key);
      this.translationCache.set(key, { text: translation, createdAt: Date.now() });
      this.cacheCharacters += key.length + translation.length;
      // Evict long-page entries by capacity, not a short timeout; the persistent background cache may still reuse evicted entries.
      while (this.translationCache.size > 1000 || this.cacheCharacters > 2000000) {
        const oldest = this.translationCache.keys().next().value;
        this.cacheCharacters -= oldest.length + this.translationCache.get(oldest).text.length;
        this.translationCache.delete(oldest);
      }
    }
    /**
     * Prioritize the viewport, then content above and below. Limit messages to 24 paragraphs and pages to two in-flight batches.
     * The background further splits batches by service text limits; render each record as it finishes without waiting for other batches.
     */
    pump() {
      const distance = (job) => {
        const rect = job.record.element.getBoundingClientRect();
        return rect.bottom < 0 ? -rect.bottom : Math.max(0, rect.top - innerHeight);
      };
      // Read layout once per scheduling pass; avoid repeated geometry calculations inside the sort comparator.
      const priorities = new Map(this.queue.map((job) => [job, distance(job)]));
      this.queue.sort((a, b) => priorities.get(a) - priorities.get(b));
      while (this.running && this.inflight < 2 && this.queue.length) {
        const jobs = [];
        while (jobs.length < 24 && this.queue.length) {
          const job = this.queue.shift();
          if (
            !job.record.element.isConnected ||
            job.epoch !== this.epoch ||
            this.renderer.records.get(job.record.element) !== job.record ||
            app.dom.textOf(job.record.element) !== job.record.text
          )
            continue;
          jobs.push(job);
        }
        if (!jobs.length) continue;
        const epoch = this.epoch;
        this.inflight++;
        this.message({
          type: 'TRANSLATE_BATCH',
          texts: jobs.map((job) => job.record.text),
          epoch,
          signature: jobs[0].signature,
        })
          .then((result) => {
            if (epoch !== this.epoch) return;
            jobs.forEach((job, index) => {
              const translated = result.results[index];
              if (translated?.skipped) this.renderer.skip(job.record);
              else if (typeof translated?.text === 'string') {
                this.rememberTranslation(job.record.text, translated.text);
                if (this.renderer.complete(job.record, translated.text)) this.completed++;
              } else
                this.fail(job, translated || { error: 'errors.serviceFailure', retryable: true });
            });
          })
          .catch((error) => {
            if (epoch === this.epoch) jobs.forEach((job) => this.fail(job, error));
          })
          .finally(() => {
            // The background cancels requests; also prevent stale responses from changing new-run counters or inserting translations.
            if (epoch !== this.epoch) return;
            this.inflight--;
            this.pump();
            this.progress();
          });
      }
    }
    fail(job, failure) {
      if (
        this.renderer.records.get(job.record.element) !== job.record ||
        app.dom.textOf(job.record.element) !== job.record.text
      )
        return;
      this.failed++;
      this.renderer.skip(job.record);
      this.lastError = failure.error || failure.message;
      const attempt = job.attempt || 0;
      if (failure.retryable === true && attempt < 3) {
        this.retries.set(job.record.element, {
          ...job,
          attempt: attempt + 1,
          dueAt:
            Date.now() + Math.max([10000, 30000, 90000][attempt], failure.retryAfterMs || 0) + 100,
        });
        this.scheduleRetries();
      }
    }
    /** Retry only unsuccessful paragraphs; a shared timer and batch queue prevent per-paragraph bursts. */
    scheduleRetries() {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      for (const [element, job] of this.retries)
        if (
          !element.isConnected ||
          job.epoch !== this.epoch ||
          this.renderer.records.get(element) !== job.record ||
          app.dom.textOf(element) !== job.record.text
        ) {
          this.retries.delete(element);
          this.failed = Math.max(0, this.failed - 1);
        }
      if (!this.running || !this.retries.size) return;
      const dueAt = Math.min(...[...this.retries.values()].map((job) => job.dueAt));
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = null;
          for (const [element, job] of this.retries) {
            if (job.dueAt > Date.now()) continue;
            this.retries.delete(element);
            this.failed = Math.max(0, this.failed - 1);
            if (
              !element.isConnected ||
              job.epoch !== this.epoch ||
              this.renderer.records.get(element) !== job.record ||
              app.dom.textOf(element) !== job.record.text
            )
              continue;
            job.record = this.renderer.create(
              element,
              job.record.text,
              this.settings.targetLanguage,
            );
            this.queue.push(job);
          }
          this.scheduleRetries();
          this.pump();
          this.progress();
        },
        Math.min(2147483647, Math.max(0, dueAt - Date.now())),
      );
    }
    progress() {
      if (!this.running) return;
      if (this.inflight || this.queue.length)
        this.dock.status('status.progress', false, { params: { count: this.completed } });
      else if (this.retries.size)
        this.dock.status('status.retrying', false, {
          toast: false,
          params: { count: this.completed, retrying: this.retries.size },
        });
      else if (this.failed)
        this.dock.status('status.partial', true, {
          toast: false,
          params: { count: this.completed, skipped: this.failed, error: this.lastError },
        });
      else if (!this.completed) this.dock.status('status.empty');
      else this.dock.status('status.complete', false, { params: { count: this.completed } });
    }
    /** Stop future scans and remove owned nodes; never rewrite, hide, or recreate the page's original content. */
    restore() {
      // Restore the page immediately; notify background cancellation asynchronously so extension reloads cannot leave translations behind.
      this.message({ type: 'CANCEL_TRANSLATION', epoch: this.epoch }).catch(() => {});
      this.epoch++;
      this.running = false;
      this.starting = false;
      this.queue.length = 0;
      this.inflight = 0;
      this.completed = 0;
      this.failed = 0;
      clearTimeout(this.scanTimer);
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.retries.clear();
      this.scanTimer = null;
      this.features.pageRestore();
      this.suppressedParagraphs = new WeakMap();
      this.renderer.clear();
      this.dock.setTranslationState(false);
      this.dock.status('status.restored');
    }
  }
  app.controller = new PageController();
})();
