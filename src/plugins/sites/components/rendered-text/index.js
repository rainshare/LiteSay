(() => {
  const app = (globalThis.LiteSay ||= {});
  const components = (app.siteComponents ||= {});
  const excluded = 'script,style,noscript,svg,[hidden],[aria-hidden="true"]';
  components.renderedText = {
    /** Read open shadow trees only for explicitly registered components; do not mix displayed text with fallback text. */
    sources(element) {
      const sources = new Map();
      for (const host of app.siteRules.renderedTextElements(element)) {
        if (!host.shadowRoot || app.dom.ignored(host)) continue;
        const walker = document.createTreeWalker(host.shadowRoot, NodeFilter.SHOW_TEXT);
        const pieces = [];
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent || parent.closest(excluded)) continue;
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          pieces.push(node.textContent);
        }
        sources.set(host, pieces.join('').replace(/\s+/g, ' ').trim());
      }
      return sources;
    },
    contains(node, sources) {
      return [...sources.keys()].some((host) => host !== node && host.contains(node));
    },
  };
})();
