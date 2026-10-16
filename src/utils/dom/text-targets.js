(() => {
  const app = (globalThis.LiteSay ||= {});
  const EXCLUDED =
    'input,textarea,select,button,pre,code,kbd,samp,script,style,noscript,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[hidden],[aria-hidden="true"],[data-litesay-ui],[data-litesay-selection],[data-litesay-translation]';
  const elementOf = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement);
  /** Collection returns source snapshots and positioning only; no UI, background calls, or translation requests. */
  app.textTargets = {
    selection() {
      const active = document.activeElement;
      if (active?.matches('input,textarea,select') || active?.isContentEditable) return null;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
      const range = selection.getRangeAt(0);
      const excluded = (node) =>
        node.getRootNode() !== document ||
        !elementOf(node) ||
        app.siteRules.ignored(elementOf(node)) ||
        Boolean(elementOf(node).closest(EXCLUDED));
      if (excluded(range.startContainer) || excluded(range.endContainer)) return null;
      const text = selection.toString().trim();
      if (!text || text.length > 40000 || !/\p{L}/u.test(text)) return null;
      const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!range.intersectsNode(node)) continue;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.textContent.length;
        // Inspect actual selection intersections only, excluding editors and explicitly non-translatable text between nodes.
        if (end > start && excluded(node)) return null;
      }
      const rect = [...range.getClientRects()]
        .filter((rect) => rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight)
        .at(-1);
      return rect ? { text, rect, range: range.cloneRange() } : null;
    },
    hover(element) {
      // Restoration triggered on translated text still targets its original paragraph and source snapshot.
      element = element?.closest?.('[data-litesay-translation]')?.parentElement || element;
      if (
        !(element instanceof Element) ||
        element.getRootNode() !== document ||
        element.closest(EXCLUDED)
      )
        return null;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!/\p{L}/u.test(node.textContent) || app.dom.ignored(node)) continue;
        const block = app.dom.blockFor(node),
          text = app.dom.textOf(block);
        // Hover uses content paragraphs and skips Simplified/Traditional Chinese; forms, code, and site exclusions never enter this path.
        if (
          !app.dom.visible(block) ||
          !text ||
          text.length > 40000 ||
          globalThis.LiteSayLanguagePolicy.isAlreadyTargetLanguage(text, 'zh-CN')
        )
          return null;
        return { text, element: block };
      }
      return null;
    },
    sameRange(first, second) {
      return (
        first &&
        second &&
        first.startContainer === second.startContainer &&
        first.startOffset === second.startOffset &&
        first.endContainer === second.endContainer &&
        first.endOffset === second.endOffset
      );
    },
    insideUi(node) {
      return Boolean(elementOf(node)?.closest('[data-litesay-ui],[data-litesay-selection]'));
    },
  };
})();
