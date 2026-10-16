(() => {
  const app = (globalThis.LiteSay ||= {});
  const components = (app.siteComponents ||= {});
  const svgTags = new Set([
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
  ]);
  const svgAttributes = new Set([
    'viewBox',
    'width',
    'height',
    'd',
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'fill-rule',
    'clip-rule',
    'opacity',
    'transform',
    'x',
    'y',
    'rx',
    'ry',
    'cx',
    'cy',
    'r',
    'x1',
    'x2',
    'y1',
    'y2',
    'points',
  ]);
  function copyIcon(original) {
    let icon;
    if (original.tagName === 'IMG') {
      const source = original.currentSrc || original.src;
      if (
        !/^https?:\/\//i.test(source) &&
        !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(source)
      )
        return null;
      icon = document.createElement('img');
      icon.src = source;
      icon.alt = original.alt;
      icon.draggable = false;
      icon.referrerPolicy = original.referrerPolicy || 'no-referrer';
    } else {
      if (!svgTags.has(original.localName)) return null;
      icon = document.createElementNS('http://www.w3.org/2000/svg', original.localName);
      for (const attribute of original.attributes)
        if (svgAttributes.has(attribute.name) && !/url\s*\(/i.test(attribute.value))
          icon.setAttribute(attribute.name, attribute.value);
      for (const child of original.children) {
        const copied = copyIcon(child);
        if (copied) icon.append(copied);
      }
      icon.setAttribute('aria-hidden', 'true');
    }
    if (original.matches('img,svg')) {
      const style = getComputedStyle(original);
      for (const property of ['width', 'height', 'vertical-align', 'margin-left', 'margin-right'])
        icon.style.setProperty(property, style.getPropertyValue(property));
      icon.style.display = 'inline-block';
    }
    return icon;
  }
  components.hyperlinks = {
    copyIcon,
    signature(element) {
      return [
        element.href || '',
        element.localName,
        element.textContent,
        element.getAttribute('class') || '',
        element.getAttribute('style') || '',
        ...[...element.querySelectorAll('a[href]')].map((anchor) => anchor.href),
        ...[...element.querySelectorAll('img')].map((image) => image.currentSrc || image.src),
        ...[...element.querySelectorAll('svg')].map((icon) => icon.outerHTML),
      ].join('\n');
    },
    collect(element, selector) {
      const links = new Map();
      if (!selector) return links;
      for (const anchor of element.querySelectorAll(selector)) {
        if (
          anchor.tagName !== 'A' ||
          !['http:', 'https:'].includes(anchor.protocol) ||
          app.dom.ignored(anchor) ||
          app.dom.blockFor(anchor) !== element
        )
          continue;
        let fingerprint = 2166136261;
        const source = this.signature(anchor);
        for (const point of source)
          fingerprint = Math.imul(fingerprint ^ point.codePointAt(0), 16777619) >>> 0;
        links.set(anchor, `\uE000${links.size}:${fingerprint}\uE001`);
      }
      return links;
    },
    /** Keep URLs, events, and icons local; insert remote labels as text nodes only. */
    create(original, label) {
      const anchor = document.createElement('a');
      anchor.href = original.href;
      anchor.dataset.litesayInlineLink = '';
      const style = getComputedStyle(original);
      anchor.style.color = style.color;
      anchor.style.textDecoration = style.textDecoration;
      for (const property of [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'vertical-align',
      ])
        anchor.style.setProperty(property, style.getPropertyValue(property));
      let insertedLabel = false;
      const append = (node, target = anchor) => {
        if (![Node.TEXT_NODE, Node.ELEMENT_NODE].includes(node.nodeType)) return;
        if (node.nodeType === Node.TEXT_NODE) {
          if (label === undefined) target.append(document.createTextNode(node.textContent));
          else if (!insertedLabel && node.textContent.trim()) {
            anchor.append(typeof label === 'string' ? document.createTextNode(label) : label);
            insertedLabel = true;
          }
        } else if (node.matches('img,svg')) {
          if (!node.closest('[hidden],[aria-hidden="true"]') || node.localName === 'svg') {
            const icon = copyIcon(node);
            if (icon) target.append(icon);
          }
        } else if (!node.matches('script,style,noscript,[hidden],[aria-hidden="true"]')) {
          let container = target;
          if (label === undefined && node.matches('strong,b,em,i,del,s,mark,code,kbd,span')) {
            container = document.createElement(node.localName);
            const appearance = getComputedStyle(node);
            for (const property of [
              'font-weight',
              'font-style',
              'font-family',
              'font-size',
              'color',
              'background-color',
              'text-decoration',
            ])
              container.style.setProperty(property, appearance.getPropertyValue(property));
            target.append(container);
          }
          for (const child of node.childNodes) append(child, container);
        }
      };
      for (const child of original.childNodes) append(child);
      if (label !== undefined && !insertedLabel)
        anchor.append(typeof label === 'string' ? document.createTextNode(label) : label);
      if (original.target === '_blank') {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
      anchor.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        original.click();
      });
      return anchor;
    },
  };
})();
