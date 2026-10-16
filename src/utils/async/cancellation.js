/** Make shared session waits and backoff cancellable without aborting session downloads used by other pages. */
export function abortError() {
  return new DOMException('Translation cancelled.', 'AbortError');
}
export function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}
export function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
