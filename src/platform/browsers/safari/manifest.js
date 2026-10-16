export function configureManifest(manifest) {
  delete manifest.minimum_chrome_version;
  // Apple packaging/signing is performed outside the shared WebExtension source tree.
  return manifest;
}
