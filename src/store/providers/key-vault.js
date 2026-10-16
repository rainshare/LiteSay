/**
 * API key vault, imported only by the Service Worker.
 * Store the AES-GCM 256-bit key as a non-extractable CryptoKey in extension-origin IndexedDB.
 * chrome.storage.local holds only random IVs and ciphertext; each encryption uses a fresh 96-bit IV.
 * additionalData binds the service ID so swapping ciphertext between services cannot decrypt it.
 * This prevents accidental plaintext exports; device administrators or attackers controlling extension execution may still invoke decryption.
 */
const encode = new TextEncoder();
const decode = new TextDecoder();
export function createKeyVault({ getKey = persistentKey, cryptoImpl = crypto } = {}) {
  return {
    async encrypt(value, provider) {
      const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
      const ciphertext = await cryptoImpl.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encode.encode(`litesay:key:v1:${provider}`) },
        await getKey(),
        encode.encode(value),
      );
      return { version: 1, iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
    },
    async decrypt(record, provider) {
      if (!record) return '';
      if (
        record.version !== 1 ||
        !Array.isArray(record.iv) ||
        record.iv.length !== 12 ||
        !Array.isArray(record.data)
      )
        throw new Error('The saved key data is invalid. Enter the API key again.');
      try {
        const plaintext = await cryptoImpl.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: new Uint8Array(record.iv),
            additionalData: encode.encode(`litesay:key:v1:${provider}`),
          },
          await getKey(),
          new Uint8Array(record.data),
        );
        return decode.decode(plaintext);
      } catch {
        throw new Error('Cannot decrypt the saved key. Enter the API key again.');
      }
    },
  };
}

let keyPromise;
/** A Promise coalesces concurrent initialization; IndexedDB can structured-clone non-extractable keys. */
async function persistentKey() {
  if (!keyPromise)
    keyPromise = openKey().catch((error) => {
      keyPromise = undefined;
      throw error;
    });
  return keyPromise;
}
async function openKey() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('litesay-key-vault', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cannot open the key vault.'));
  });
  try {
    const stored = await new Promise((resolve, reject) => {
      const request = db.transaction('keys').objectStore('keys').get('aes-gcm-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Cannot read the encrypted key.'));
    });
    if (stored) return stored;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('keys', 'readwrite');
      transaction.objectStore('keys').put(key, 'aes-gcm-v1');
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () =>
        reject(new Error('Cannot save the encrypted key.'));
    });
    return key;
  } finally {
    db.close();
  }
}
