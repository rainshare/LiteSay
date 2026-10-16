(() => {
  /**
   * Page identification returns { element, text } only, without requests or node insertion.
   * blockFor() determines unique text ownership; textOf() and collect() use the same rules.
   */
  const app = (globalThis.LiteSay ||= {});
  // Preserve code, forms, editors, and regions explicitly marked as non-translatable.
  const EXCLUDED =
    'script,style,noscript,pre,code,kbd,samp,textarea,input,select,button,svg,canvas,iframe,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-litesay-ui],[data-litesay-selection],[data-litesay-translation]';
  const SEMANTIC = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd';
  const renderedSources = (element) => app.siteComponents.renderedText.sources(element);
  const insideSource = (node, sources) => app.siteComponents.renderedText.contains(node, sources);
  function ignored(node) {
    // Images/br may themselves be hidden; inspect elements directly and text nodes through their parents.
    // Checking only parents would include hidden fallback emoji, causing duplicates or choosing the wrong original image.
    const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!parent || parent.closest(`${EXCLUDED},[hidden],[aria-hidden="true"]`)) return true;
    if (parent.closest('nav') && !app.siteRules.allowsNavigation(node)) return true;
    if (app.siteRules.ignored(node)) return true;
    // Translation-only mode hides source wrappers; still snapshot original nodes so dynamic updates are not mistaken for absent content.
    const original = parent.closest('[data-litesay-original]');
    const visibilityTarget = original ? blockFor(node) : parent;
    const style = getComputedStyle(visibilityTarget);
    // Visible paragraphs may contain hidden spans; do not send hidden content to translation services.
    return (
      style.visibility === 'hidden' ||
      (style.display !== 'contents' && !visibilityTarget.getClientRects().length)
    );
  }
  function blockFor(node) {
    const parent = node.parentElement;
    // Site allowlists also define paragraph boundaries; inline titles must not belong to outer author/tag containers.
    const siteBody = app.siteRules.bodyFor(node);
    const semantic = parent.closest(SEMANTIC);
    if (semantic && (!siteBody || siteBody.contains(semantic))) return semantic;
    let element = parent;
    while (element && element !== document.body) {
      if (element === siteBody) return element;
      // main/article are article containers; independent small/span content needs its own translation placement, not the article's end.
      if (['MAIN', 'ARTICLE', 'SECTION'].includes(element.tagName) && element !== parent)
        return parent;
      const display = getComputedStyle(element).display;
      if (
        ['block', 'flow-root', 'list-item'].includes(display) ||
        ['DIV', 'ARTICLE', 'SECTION', 'MAIN'].includes(element.tagName)
      )
        return element;
      element = element.parentElement;
    }
    return parent === document.body ? document.body : parent;
  }
  /** Read source snapshots excluding translation nodes and child paragraphs for deduplication and asynchronous result validation. */
  function textOf(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    const pieces = [];
    const links = app.siteRules.inlineLinks(element);
    const formats = app.siteRules.inlineFormats(element);
    const rendered = renderedSources(element);
    const preserveLines = ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(
      getComputedStyle(element).whiteSpace,
    );
    let node;
    while ((node = walker.nextNode())) {
      if (rendered.has(node)) {
        if (!ignored(node) && blockFor(node) === element) pieces.push(rendered.get(node));
        continue;
      }
      if (insideSource(node, rendered)) continue;
      if (insideSource(node, links) || insideSource(node, formats)) continue;
      if (links.has(node) || formats.has(node)) {
        pieces.push(app.siteRules.inlineText(node, links, formats));
        continue;
      }
      const anchor = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest('a');
      if (links.has(anchor)) continue;
      if (node.nodeType === Node.ELEMENT_NODE) {
        // br explicitly breaks lines; include it when reading text so three lines do not become one sentence.
        if (!ignored(node) && blockFor(node) === element) {
          if (node.tagName === 'BR') pieces.push('\n');
          // X often renders emoji as images; accept alt text only for actual emoji graphemes, not ordinary image descriptions.
          if (
            node.tagName === 'IMG' &&
            /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(node.alt)
          )
            pieces.push(node.alt);
        }
        continue;
      }
      // Read text owned by the current paragraph only, avoiding duplicate translations of containers and child paragraphs.
      if (!ignored(node) && blockFor(node) === element)
        pieces.push(
          preserveLines
            ? node.textContent.replace(/\r\n?/g, '\n')
            : node.textContent.replace(/\s+/g, ' '),
        );
    }
    return pieces
      .join('')
      .split('\n')
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .join('\n')
      .trim();
  }
  function visible(element) {
    if (!element.isConnected || element.closest('[hidden],[aria-hidden="true"]')) return false;
    if (!element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }
  /** Return owned text, line breaks, emoji images, and protected links for translation-only hiding and restoration. */
  function originalNodes(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    const nodes = [];
    const links = app.siteRules.inlineLinks(element);
    const formats = app.siteRules.inlineFormats(element);
    const rendered = renderedSources(element);
    let node;
    while ((node = walker.nextNode())) {
      if (rendered.has(node)) {
        if (!ignored(node) && blockFor(node) === element) nodes.push(node);
        continue;
      }
      if (insideSource(node, rendered)) continue;
      if (insideSource(node, links) || insideSource(node, formats)) continue;
      if (links.has(node) || formats.has(node)) {
        nodes.push(node);
        continue;
      }
      const anchor = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest('a');
      if (links.has(anchor)) continue;
      if (
        (node.nodeType === Node.TEXT_NODE ||
          node.tagName === 'BR' ||
          (node.tagName === 'IMG' &&
            /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(node.alt))) &&
        !ignored(node) &&
        blockFor(node) === element
      )
        nodes.push(node);
    }
    return nodes;
  }
  /** Return visible text blocks in the main document, excluding code/forms/navigation and non-translatable regions. */
  function collect() {
    const elements = new Set();
    const rendered = renderedSources(document.body);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      // Actual display text was read from the shadow tree; fallback dates must not become independent paragraphs.
      if (insideSource(node, rendered)) continue;
      if (!ignored(node) && /\p{L}/u.test(node.textContent)) elements.add(blockFor(node));
    }
    for (const [host, text] of rendered) if (/\p{L}/u.test(text)) elements.add(blockFor(host));
    return [...elements]
      .filter(visible)
      .map((element) => ({ element, text: textOf(element) }))
      .filter((item) => item.text.length >= 4 && /\p{L}/u.test(item.text));
  }
  app.dom = { collect, textOf, originalNodes, visible, ignored, blockFor, excluded: EXCLUDED };
})();
