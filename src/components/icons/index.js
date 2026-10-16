import { PROVIDER_ICON_RESOURCES, UI_ICON_RESOURCES } from '../../config/icons/catalog.js';

/**
 * The renderer accepts catalog IDs only; shapes, colors, and aliases come from config/icons/ and separate SVG files.
 * Brand licenses are in assets/providers/LICENSE.txt. Insert only generated static SVG, never parse user input.
 */
function iconElement(svgText, color, doc) {
  const icon = doc.createElement('span');
  icon.className = 'litesay-provider-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = svgText;
  icon.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex-shrink:0;';
  icon.style.color = color;
  icon.firstElementChild.style.cssText = 'width:100%;height:100%;';
  return icon;
}
export function providerIcon(provider, doc = document, customApiIcon = 'openai') {
  const id = provider === 'custom' ? customApiIcon : provider;
  const resource = PROVIDER_ICON_RESOURCES[id] || PROVIDER_ICON_RESOURCES.fallback;
  return iconElement(resource.svg, resource.color, doc);
}
export function uiIcon(name, doc = document) {
  return iconElement(UI_ICON_RESOURCES[name] || UI_ICON_RESOURCES.info, 'currentColor', doc);
}
