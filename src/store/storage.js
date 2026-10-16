import { extensionStorage } from '../platform/webextension/api.js';

export const storageKey = (name) => 'litesay:' + name;
/** Current product's storage namespace; it never reads or migrates earlier keys. */
export function extensionStore() {
  const storage = extensionStorage();
  return {
    QUOTA_BYTES: storage.QUOTA_BYTES,
    get: async (name) => ({ [name]: (await storage.get(storageKey(name)))[storageKey(name)] }),
    set: (values) =>
      storage.set(
        Object.fromEntries(
          Object.entries(values).map(([name, value]) => [storageKey(name), value]),
        ),
      ),
    remove: (name) => storage.remove(storageKey(name)),
  };
}
