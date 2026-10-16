(() => {
  const app = (globalThis.LiteSay ||= {});
  const { t } = globalThis.LiteSayI18n;
  /**
   * Translation renderer stores records by source element for one-action cleanup and dynamic node reuse.
   * Preserve original nodes and events; translation-only mode temporarily wraps text nodes and unwraps them on cleanup.
   * Write all network results through textContent; never parse service-returned HTML.
   */
  class TranslationRenderer {
    records = new Map();
    settings = {};
    configure(settings) {
      this.settings = settings;
    }
    create(element, text, language) {
      this.remove(element);
      // Append only a small spinner while waiting, not loading text; reuse that node as a block translation after success.
      const node = document.createElement('span');
      node.dataset.litesayTranslation = 'pending';
      node.className = 'litesay-translation';
      node.lang = language;
      node.dir = 'auto';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-label', t('status.translating'));
      element.append(node);
      const record = { element, node, text, status: 'pending', originals: [] };
      this.records.set(element, record);
      return record;
    }
    /** @returns {boolean} Update and count completion only while the record remains valid and its source is unchanged. */
    complete(record, translation) {
      // Virtual lists may reuse the same DOM node. Stale requests must not overwrite changed source text.
      if (
        !record.element.isConnected ||
        this.records.get(record.element) !== record ||
        app.dom.textOf(record.element) !== record.text
      )
        return false;
      if (translation.replace(/\s+/g, ' ').trim() === record.text.replace(/\s+/g, ' ').trim()) {
        // Services may not recognize short text or may return it unchanged; do not append duplicate content.
        this.skip(record);
        return false;
      }
      this.renderText(record, translation);
      record.node.dataset.litesayTranslation = 'done';
      record.status = 'done';
      record.node.removeAttribute('role');
      record.node.removeAttribute('aria-label');
      // Append extension nodes only; preserve source text, page events, and inline structure.
      record.element.append(record.node);
      this.present(record);
      return true;
    }
    /** Write translations as plain text; reconstruct protected handles, links, and icons with DOM APIs. */
    renderText(record, translation) {
      const images = app.siteRules.protectedImages(record.element);
      const plain = (text) => {
        const pieces = [];
        let buffer = '';
        const flush = () => {
          if (buffer) pieces.push(document.createTextNode(buffer));
          buffer = '';
        };
        for (const { segment } of new Intl.Segmenter(undefined, {
          granularity: 'grapheme',
        }).segment(text)) {
          const original = images.get(segment);
          if (!original) {
            buffer += segment;
            continue;
          }
          flush();
          const image = document.createElement('img');
          image.src = original.currentSrc || original.src;
          image.alt = segment;
          image.draggable = false;
          image.dataset.litesayEmoji = '';
          image.referrerPolicy = original.referrerPolicy || 'no-referrer';
          const style = getComputedStyle(original);
          image.style.setProperty('display', 'inline-block', 'important');
          for (const property of [
            'width',
            'height',
            'vertical-align',
            'margin-left',
            'margin-right',
          ])
            image.style.setProperty(property, style.getPropertyValue(property), 'important');
          pieces.push(image);
        }
        flush();
        return pieces;
      };
      record.node.replaceChildren(
        ...app.siteComponents.inlineFormatting.render(translation, {
          links: app.siteRules.inlineLinks(record.element),
          formats: app.siteRules.inlineFormats(record.element),
          mentions: app.siteRules.protectedLinks(record.element),
          plain,
        }),
      );
    }
    /** With source language auto, group scripts locally without network detection; cover only explicitly listed CJK and common Latin languages. */
    similarLanguages(text) {
      const group = (language) => {
        const code = language?.split('-')[0].toLowerCase();
        if (['zh', 'ja', 'ko'].includes(code)) return 'cjk';
        if (
          [
            'en',
            'fr',
            'de',
            'es',
            'it',
            'pt',
            'nl',
            'sv',
            'da',
            'no',
            'fi',
            'pl',
            'cs',
            'ro',
            'tr',
            'vi',
            'id',
            'ms',
          ].includes(code)
        )
          return 'latin';
        return null;
      };
      const source =
        this.settings.sourceLanguage === 'auto'
          ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)
            ? 'cjk'
            : /\p{Script=Latin}/u.test(text) &&
                !/[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}]/u.test(text)
              ? 'latin'
              : null
          : group(this.settings.sourceLanguage);
      return source !== null && source === group(this.settings.targetLanguage);
    }
    /** Hide source text only after success; failures, identical results, and pending paragraphs remain readable. */
    present(record) {
      record.node.dataset.litesayStyle = this.settings.translationStyle || 'none';
      record.node.dataset.litesayDisplay = this.settings.displayMode || 'bilingual';
      // The none style overrides related-language backgrounds; clear old markers before displaying again.
      delete record.node.dataset.litesaySimilar;
      if (
        record.node.dataset.litesayStyle !== 'none' &&
        this.settings.highlightSimilarLanguages &&
        this.settings.displayMode !== 'translation-only' &&
        this.similarLanguages(record.text)
      )
        record.node.dataset.litesaySimilar = '';
      if (this.settings.displayMode !== 'translation-only') return;
      for (const original of app.dom.originalNodes(record.element)) {
        if (original.nodeType === Node.TEXT_NODE) {
          // Move original Text nodes without cloning; link/bold parent elements and event bindings stay in place.
          const wrapper = document.createElement('span');
          wrapper.dataset.litesayOriginal = 'text';
          original.before(wrapper);
          wrapper.append(original);
          record.originals.push(wrapper);
        } else {
          original.dataset.litesayOriginal = 'break';
          record.originals.push(original);
        }
      }
    }
    /** Preserve children added by the website inside wrappers; do not reinsert content the website has already removed. */
    restoreOriginal(record) {
      for (const original of record.originals) {
        if (original.dataset.litesayOriginal === 'text')
          original.replaceWith(...original.childNodes);
        else original.removeAttribute('data-litesay-original');
      }
      record.originals.length = 0;
    }
    skip(record) {
      if (this.records.get(record.element) !== record) return;
      record.node.remove();
      this.restoreOriginal(record);
      // Keep source snapshots so MutationObserver cannot retry failures automatically; process explicit retries or changed sources.
      record.status = 'skipped';
    }
    remove(element) {
      const record = this.records.get(element);
      if (record) {
        record.node.remove();
        this.restoreOriginal(record);
      }
      this.records.delete(element);
    }
    clear() {
      for (const element of this.records.keys()) this.remove(element);
    }
    prune() {
      for (const [element, record] of this.records)
        if (!element.isConnected || (record.status !== 'skipped' && !record.node.isConnected))
          this.remove(element);
    }
  }
  app.TranslationRenderer = TranslationRenderer;
})();
