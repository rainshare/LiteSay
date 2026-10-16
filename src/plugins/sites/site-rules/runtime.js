(() => {
  const app = (globalThis.LiteSay ||= {});
  let config = { id: null };
  const CONTENT_ATTRIBUTES = [
    'id',
    'class',
    'style',
    'hidden',
    'aria-hidden',
    'translate',
    'contenteditable',
    'open',
    'alt',
    'src',
  ];
  function optionalRegion(node) {
    const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return (config.optionalRegions || []).find((region) => parent?.closest(region.bodySelector));
  }
  /**
   * Site adaptation supplies region checks and protected link/emoji indexes, without requests or translation insertion.
   * Injected rule data completely defines content, buttons, authors, and auxiliary regions.
   * No site names, selectors, or private classes here; DOM changes belong in adapters.
   */
  function bodyFor(node) {
    if (!config.id || !config.bodySelector) return null;
    const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const region = optionalRegion(node);
    if (region) return parent?.closest(region.bodySelector) || null;
    return parent?.closest(config.bodySelector) || null;
  }
  function ignored(node) {
    if (!config.id || !config.bodySelector) return false;
    const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!parent) return true;
    const region = optionalRegion(node);
    if (region) return Boolean(region.excludedSelector && parent.closest(region.excludedSelector));
    if (config.excludedSelector && parent.closest(config.excludedSelector)) return true;
    const body = bodyFor(node);
    if (!body) return true;
    // Exclude action buttons inside content, but allow the entire body to be wrapped in a clickable quote card.
    // JSON declares the two exclusion scopes separately; future sites need no special collector branches.
    const control =
      config.contentExcludedSelector && parent.closest(config.contentExcludedSelector);
    return Boolean(control && control !== body && body.contains(control));
  }
  app.siteRules = {
    ignored,
    bodyFor,
    /** Observe only attributes used by visibility or rule selectors so high-frequency playback updates do not trigger full-page scans. */
    observedAttributes() {
      const attributes = new Set(CONTENT_ATTRIBUTES);
      const selectors = [
        config.bodySelector,
        config.excludedSelector,
        config.contentExcludedSelector,
        config.inlineLinkSelector,
        config.renderedTextSelector,
        config.inlineFormatSelector,
        config.inlinePreserveSelector,
        ...(config.optionalRegions || []).flatMap((region) => [
          region.bodySelector,
          region.excludedSelector,
        ]),
      ].filter(Boolean);
      for (const selector of selectors) {
        // Escaped and namespaced attributes cannot directly enter attributeFilter; retain full observation for custom rules.
        if (selector.includes('\\') || /\[\s*(?:[\w-]+|\*)?\|(?!=)/.test(selector))
          return undefined;
        for (const match of selector.matchAll(/\[\s*([^\s~|^$*!=\]]+)/g)) {
          if (!/^[a-zA-Z_][\w-]*$/.test(match[1])) return undefined;
          attributes.add(match[1]);
          attributes.add(match[1].toLowerCase());
        }
      }
      return [...attributes];
    },
    allowsNavigation: (node) => Boolean(optionalRegion(node)),
    /** Allow only explicitly registered components; the DOM layer reads their displayed text. */
    renderedTextElements(element) {
      return config.renderedTextSelector
        ? [...element.querySelectorAll(config.renderedTextSelector)]
        : [];
    },
    /** Links enter snapshots as local markers; URLs, original images, and events stay on the current page. */
    inlineLinks(element) {
      return app.siteComponents.hyperlinks.collect(element, config.inlineLinkSelector || '');
    },
    inlineFormats(element) {
      return app.siteComponents.inlineFormatting.collect(
        element,
        config.inlineFormatSelector || '',
        config.inlinePreserveSelector || '',
      );
    },
    inlineText(node, links, formats) {
      return app.siteComponents.inlineFormatting.encode(
        node,
        links,
        formats,
        config.translateInlineLinks,
      );
    },
    /** Handle links accept HTTP(S) URLs within rule domains only; do not copy page event attributes. */
    protectedLinks(element) {
      const links = new Map();
      if (!config.preserveMentions) return links;
      for (const anchor of element.querySelectorAll('a[href]')) {
        const text = anchor.textContent.trim();
        if (!/^@[A-Za-z0-9_]{1,15}$/.test(text)) continue;
        const url = new URL(anchor.href);
        if (
          ['http:', 'https:'].includes(url.protocol) &&
          config.linkDomains?.some(
            (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
          )
        )
          links.set(text.toLowerCase(), anchor);
      }
      return links;
    },
    /** Original page emoji images are display-only; unadapted or disabled sites still use default Unicode text. */
    protectedImages(element) {
      const images = new Map();
      if (!config.preserveEmojiImages) return images;
      for (const image of element.querySelectorAll('img[alt]')) {
        if (image.closest('[data-litesay-translation]') || ignored(image)) continue;
        // Pages may retain hidden fallback emoji; select the currently visible original image.
        if (!image.getClientRects().length || getComputedStyle(image).visibility === 'hidden')
          continue;
        if (
          !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(image.alt) ||
          !/^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Component}\u20e3]+$/u.test(
            image.alt,
          )
        )
          continue;
        const source = image.currentSrc || image.src;
        if (
          !/^https?:\/\//i.test(source) &&
          !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(source)
        )
          continue;
        if (!images.has(image.alt)) images.set(image.alt, image);
      }
      return images;
    },
    // The background returns settings based on sender.url; new sites need no content controller or service adapter changes.
    configure(value) {
      config = { id: null };
      delete document.documentElement.dataset.litesaySite;
      if (
        typeof value?.id !== 'string' ||
        typeof value?.bodySelector !== 'string' ||
        !value.bodySelector.trim()
      )
        return;
      // Settings validate syntax, but guard against old storage, manually edited config, and browser CSS differences too.
      // Validate all nonempty selectors before enabling protection; on failure use general content detection
      // so repeated closest calls do not throw for every text node and prevent the whole page from translating.
      try {
        for (const field of [
          'bodySelector',
          'excludedSelector',
          'contentExcludedSelector',
          'inlineLinkSelector',
          'renderedTextSelector',
          'inlineFormatSelector',
          'inlinePreserveSelector',
        ])
          if (value[field]) document.querySelector(value[field]);
        for (const region of value.optionalRegions || []) {
          if (typeof region.bodySelector !== 'string' || !region.bodySelector.trim()) return;
          document.querySelector(region.bodySelector);
          if (region.excludedSelector) document.querySelector(region.excludedSelector);
        }
        config = value;
        document.documentElement.dataset.litesaySite = config.id;
      } catch {
        // Restore default content detection.
      }
    },
  };
})();
