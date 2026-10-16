import { configureManifest as chromium } from '../browsers/chromium/manifest.js';
import { configureManifest as firefox } from '../browsers/firefox/manifest.js';
import { configureManifest as safari } from '../browsers/safari/manifest.js';

/** Browser targets only customize packaging. Application code stays shared. */
export function browserManifest(base, target, options) {
  const configure = { chrome: chromium, edge: chromium, firefox, safari }[target];
  if (!configure) throw new Error('Unknown browser target: ' + target);
  return configure(structuredClone(base), options);
}
