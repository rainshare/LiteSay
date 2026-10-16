/** Promise-based WebExtension API boundary. Chrome/Edge use chrome; Firefox/Safari use browser. */
export function getBrowserApi(scope = globalThis) {
  const api = scope.browser || scope.chrome;
  if (!api?.runtime) throw new Error('No extension API is available in this environment.');
  return api;
}

export const extensionStorage = () => getBrowserApi().storage.local;
export const sendExtensionMessage = (message) => getBrowserApi().runtime.sendMessage(message);
export function subscribeStorageChanges(listener) {
  const event = getBrowserApi().storage.onChanged;
  event.addListener(listener);
  return () => event.removeListener(listener);
}

/** Restrict storage when the browser offers access levels. Session storage stays private by default. */
export async function protectStorage(api = getBrowserApi()) {
  await Promise.all(
    ['local', 'session'].map((name) =>
      api.storage[name]?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }),
    ),
  );
}
