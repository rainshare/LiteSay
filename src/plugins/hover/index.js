(() => {
  const app = (globalThis.LiteSay ||= {});
  if (app.plugins.has('hover')) return;
  /**
   * Paragraph translation is independent of selection cards and full-page scans; disabled by default, Ctrl+hover translates/restores a paragraph.
   * The host injects configuration, messaging, and rendering; this module neither writes shared rules nor contains service protocols.
   * Activate once per hover; rearm after key release or leaving the paragraph to avoid repeated toggles.
   */
  class ParagraphHoverController {
    epoch = 0;
    version = 0;
    settings = {};
    constructor({ message, readSettings, renderer, suppress, status }) {
      Object.assign(this, { message, readSettings, renderer, suppress, status });
      document.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'mouse') return;
        if (
          this.holding &&
          Math.hypot(event.clientX - this.holding.x, event.clientY - this.holding.y) > 5
        )
          this.holding = null;
        this.target = event.target;
        this.keys = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
        this.schedule();
      });
      document.addEventListener('keydown', (event) => {
        this.keys = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
        if (!event.repeat) this.schedule();
      });
      document.addEventListener('keyup', (event) => {
        this.keys = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey };
        this.cancelTimer();
        this.activated = null;
      });
      document.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.pointerType !== 'mouse') return;
        this.target = event.target;
        this.holding = { x: event.clientX, y: event.clientY };
        this.schedule();
      });
      document.addEventListener('pointerup', () => {
        this.holding = null;
        this.cancelTimer();
        this.activated = null;
      });
      document.addEventListener('pointerout', (event) => {
        if (!event.relatedTarget) this.resetPointer();
      });
      document.addEventListener('scroll', () => this.resetPointer(), true);
      window.addEventListener('blur', () => this.resetPointer());
    }
    configure(settings) {
      this.settings = settings;
      this.cancelTimer();
      this.activated = null;
      if (!settings.hoverTranslation) this.cancel();
    }
    cancelTimer() {
      clearTimeout(this.timer);
      this.version++;
    }
    resetPointer() {
      this.cancelTimer();
      this.target = null;
      this.activated = null;
      this.holding = null;
    }
    eligible() {
      const trigger = this.settings.hoverTrigger;
      return (
        this.settings.hoverTranslation &&
        (trigger === 'direct' || (trigger === 'hold' ? this.holding : this.keys?.[trigger]))
      );
    }
    schedule() {
      this.cancelTimer();
      if (!this.eligible() || !window.getSelection()?.isCollapsed) return;
      const candidate = app.textTargets.hover(this.target);
      if (!candidate) {
        this.activated = null;
        return;
      }
      if (this.activated?.element === candidate.element && this.activated.text === candidate.text)
        return;
      const version = this.version;
      this.timer = setTimeout(
        () => this.activate(candidate, version),
        this.settings.hoverTrigger === 'hold' ? 650 : 400,
      );
    }
    async activate(candidate, version) {
      let epoch;
      try {
        const result = await this.readSettings({
          ready: true,
          isCurrent: () => version === this.version && window.getSelection()?.isCollapsed,
        });
        if (!result) return;
        const { settings } = result;
        if (version !== this.version || !window.getSelection()?.isCollapsed) return;
        this.settings = settings;
        const fresh = app.textTargets.hover(candidate.element);
        if (!this.eligible() || !candidate.element.isConnected || fresh?.text !== candidate.text)
          return;
        this.activated = candidate;
        this.cancel();
        const record = this.renderer.records.get(candidate.element),
          action = settings.hoverAction;
        if (
          action === 'restore' ||
          (record &&
            record.text === candidate.text &&
            record.status !== 'skipped' &&
            action === 'toggle')
        ) {
          this.renderer.remove(candidate.element);
          this.suppress(candidate.element, candidate.text, true);
          return;
        }
        if (record?.text === candidate.text && record.status === 'done') return;
        this.suppress(candidate.element, candidate.text, false);
        this.renderer.configure(settings);
        const current = this.renderer.create(
          candidate.element,
          candidate.text,
          settings.targetLanguage,
        );
        this.pendingRecord = current;
        epoch = ++this.epoch;
        const response = await this.message({
          type: 'TRANSLATE_PARAGRAPH',
          text: candidate.text,
          epoch,
          signature: JSON.stringify(settings),
        });
        if (epoch !== this.epoch) return;
        this.renderer.complete(current, response.text);
        this.pendingRecord = null;
      } catch (error) {
        if (epoch !== undefined && epoch !== this.epoch) return;
        if (this.pendingRecord) this.renderer.skip(this.pendingRecord);
        this.pendingRecord = null;
        this.status(error.message);
      }
    }
    /** Cancel in-flight paragraph requests independently of successful paragraphs, selection cards, and full-page batches. */
    cancel() {
      if (this.pendingRecord) {
        this.message({ type: 'CANCEL_PARAGRAPH', epoch: this.epoch }).catch(() => {});
        if (this.renderer.records.get(this.pendingRecord.element) === this.pendingRecord)
          this.renderer.remove(this.pendingRecord.element);
        this.pendingRecord = null;
      }
      this.epoch++;
    }
  }
  app.ParagraphHoverController = ParagraphHoverController;
  app.plugins.register({
    id: 'hover',
    create: (context) => {
      const controller = new ParagraphHoverController(context);
      return {
        configure: (settings) => controller.configure(settings),
        onPageRestore: () => {
          controller.cancel();
          controller.resetPointer();
        },
      };
    },
  });
})();
