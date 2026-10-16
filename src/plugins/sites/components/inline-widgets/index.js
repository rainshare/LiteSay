(() => {
  const app = (globalThis.LiteSay ||= {});
  const components = (app.siteComponents ||= {});
  const visualProperties = [
    'display',
    'align-items',
    'gap',
    'color',
    'background-color',
    'border-radius',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-left',
    'margin-right',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'vertical-align',
    'white-space',
  ];
  const linkFor = (element) =>
    [element, ...element.querySelectorAll('a[href]')].find(
      (node) => node.tagName === 'A' && ['http:', 'https:'].includes(node.protocol),
    );
  /** Preserve icons, text, and styles in compound citation links; do not copy page scripts, event attributes, or tracking parameters. */
  components.inlineWidgets = {
    collect(element, selector) {
      if (!selector) return [];
      return [...element.querySelectorAll(selector)].filter((node) => {
        const visibilityTarget = node.closest('[data-litesay-original]')
          ? app.dom.blockFor(node)
          : node;
        const style = getComputedStyle(visibilityTarget);
        return (
          ['SPAN', 'DIV', 'A'].includes(node.tagName) &&
          linkFor(node) &&
          !app.siteRules.ignored(node) &&
          app.dom.blockFor(node) === element &&
          !node.closest('pre,[hidden],[data-litesay-translation]') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          visibilityTarget.getClientRects().length
        );
      });
    },
    create(original) {
      const content = document.createDocumentFragment();
      const copy = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
        if (
          node.nodeType !== Node.ELEMENT_NODE ||
          node.matches('script,style,noscript,input,select,textarea,iframe,canvas,[hidden]')
        )
          return null;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        if (node.matches('img,svg')) return components.hyperlinks.copyIcon(node);
        if (node.matches('[aria-hidden="true"]')) return null;
        if (node.tagName === 'A' && !node.textContent.trim() && !node.querySelector('img,svg'))
          return null;
        const cloned = document.createElement(
          node.tagName === 'DIV'
            ? 'span'
            : ['STRONG', 'B', 'EM', 'I', 'MARK'].includes(node.tagName)
              ? node.localName
              : 'span',
        );
        for (const property of visualProperties)
          cloned.style.setProperty(property, style.getPropertyValue(property));
        for (const child of node.childNodes) {
          const copied = copy(child);
          if (copied) cloned.append(copied);
        }
        return cloned;
      };
      for (const child of original.childNodes) {
        const copied = copy(child);
        if (copied) content.append(copied);
      }
      const anchor = components.hyperlinks.create(linkFor(original), content);
      const style = getComputedStyle(original);
      for (const property of visualProperties)
        anchor.style.setProperty(property, style.getPropertyValue(property));
      anchor.dataset.litesayInlineWidget = '';
      return anchor;
    },
  };
})();
