export function configureManifest(manifest, { geckoId = 'litesay@translate.local' } = {}) {
  manifest.background = { scripts: [manifest.background.service_worker], type: 'module' };
  delete manifest.minimum_chrome_version;
  manifest.browser_specific_settings = { gecko: { id: geckoId, strict_min_version: '128.0' } };
  return manifest;
}
