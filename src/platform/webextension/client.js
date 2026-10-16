(() => {
  if (globalThis.LiteSayPlatform) return;
  const api = globalThis.browser || globalThis.chrome;
  globalThis.LiteSayPlatform = {
    sendMessage: (message) => api.runtime.sendMessage(message),
    onMessage: (listener) => api.runtime.onMessage.addListener(listener),
  };
})();
