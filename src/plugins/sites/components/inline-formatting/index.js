(() => {
  const app = (globalThis.LiteSay ||= {});
  const components = (app.siteComponents ||= {});
  const tags = new Set(['strong', 'b', 'em', 'i', 'del', 's', 'mark', 'code', 'kbd']);
  const protectedTags = new Set(['code', 'kbd']);
  function encodeChildren(element, links, formats, translateLinks) {
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && (links.has(node) || formats.has(node)))
        text += encode(node, links, formats, translateLinks);
      else if (!app.dom.ignored(node)) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        else if (node.nodeType === Node.ELEMENT_NODE)
          text +=
            node.tagName === 'BR' ? '\n' : encodeChildren(node, links, formats, translateLinks);
      }
    }
    return text;
  }
  function encode(element, links, formats, translateLinks) {
    if (links.has(element)) {
      const token = links.get(element);
      const label = element.textContent.trim();
      if (
        !translateLinks ||
        !label ||
        /^(?:https?:\/\/|www\.)\S+$/i.test(label) ||
        label === new URL(element.href).hostname
      )
        return token;
      return (
        token +
        encodeChildren(element, links, formats, translateLinks) +
        token.replace('\uE000', '\uE002').replace('\uE001', '\uE003')
      );
    }
    const token = formats.get(element);
    if (protectedTags.has(element.localName) || !tags.has(element.localName)) return token;
    return (
      token +
      encodeChildren(element, links, formats, translateLinks) +
      token.replace('\uE004', '\uE006').replace('\uE005', '\uE007')
    );
  }
  components.inlineFormatting = {
    collect(element, selector, preserveSelector) {
      const formats = new Map();
      const widgets = new Set(components.inlineWidgets.collect(element, preserveSelector));
      const candidates = [...(selector ? element.querySelectorAll(selector) : []), ...widgets];
      for (const node of candidates) {
        if (
          formats.has(node) ||
          (!tags.has(node.localName) && !widgets.has(node)) ||
          node.closest('pre,[data-litesay-translation]') ||
          app.dom.blockFor(node) !== element ||
          (protectedTags.has(node.localName) &&
            (app.dom.ignored(node.parentElement) ||
              node.matches('[hidden],[aria-hidden="true"]') ||
              (!node.getClientRects().length && !node.closest('[data-litesay-original]')) ||
              getComputedStyle(node).visibility === 'hidden')) ||
          (tags.has(node.localName) && !protectedTags.has(node.localName) && app.dom.ignored(node))
        )
          continue;
        let fingerprint = 2166136261;
        const source = widgets.has(node)
          ? components.hyperlinks.signature(node)
          : node.localName + node.textContent;
        for (const point of source)
          fingerprint = Math.imul(fingerprint ^ point.codePointAt(0), 16777619) >>> 0;
        formats.set(node, `\uE004${formats.size}:${fingerprint}\uE005`);
      }
      return formats;
    },
    encode,
    /** Reconstruct safe DOM from locally registered markers; never parse service output as HTML. */
    render(text, { links, formats, mentions, plain }) {
      const byToken = new Map([...formats].map(([node, token]) => [token, node]));
      const linkTokens = new Map([...links].map(([node, token]) => [token, node]));
      const render = (value) => {
        const pieces = [];
        let offset = 0;
        for (const match of value.matchAll(
          /\uE000(\d+:\d+)\uE001(?:([\s\S]*?)\uE002\1\uE003)?|\uE004(\d+:\d+)\uE005(?:([\s\S]*?)\uE006\3\uE007)?|(?<![\w@])@[A-Za-z0-9_]{1,15}(?![A-Za-z0-9_])/gu,
        )) {
          const link = linkTokens.get(`\uE000${match[1]}\uE001`);
          const format = byToken.get(`\uE004${match[3]}\uE005`);
          const mention = mentions.get(match[0].toLowerCase());
          if (!link && !format && !mention) continue;
          pieces.push(...plain(value.slice(offset, match.index)));
          if (link) {
            let label;
            if (match[2] !== undefined) {
              label = document.createDocumentFragment();
              label.append(...render(match[2]));
            }
            pieces.push(components.hyperlinks.create(link, label));
          } else if (format) {
            const node = tags.has(format.localName)
              ? document.createElement(format.localName)
              : components.inlineWidgets.create(format);
            if (tags.has(format.localName)) {
              const style = getComputedStyle(format);
              for (const property of [
                'font-family',
                'font-size',
                'font-weight',
                'font-style',
                'color',
                'background-color',
                'text-decoration',
                'vertical-align',
              ])
                node.style.setProperty(property, style.getPropertyValue(property));
              if (protectedTags.has(format.localName)) node.textContent = format.textContent;
              else node.append(...render(match[4] || ''));
            }
            pieces.push(node);
          } else {
            const node = components.hyperlinks.create(mention, match[0]);
            node.style.color = '#1d9bf0';
            pieces.push(node);
          }
          offset = match.index + match[0].length;
        }
        pieces.push(...plain(value.slice(offset)));
        return pieces;
      };
      return render(text);
    },
  };
})();
