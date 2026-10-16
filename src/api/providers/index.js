/**
 * Service adapter registry. Page controllers and UI need not know service URLs or response structures.
 * Register new services with this interface to reuse concurrency, caching, timeouts, and retries.
 */
import { googleAdapter } from './free/google.js';
import { microsoftAdapter } from './free/microsoft.js';
import { createLlmAdapters } from './llm/index.js';
export { splitText } from './shared/text.js';

/**
 * Required: chunkSize, language(code), buildRequest(text, settings, session, providerConfig), parseResponse(payload).
 * For session-based services: sessionUrl, parseSession(html), shouldRefreshSession(status, payload).
 * Private configuration may provide validateConfig(config); LLMs may specify requestTimeoutMs.
 * Protocol modules must be pure functions; the background manages network access and caching.
 */
export const SERVICE_ADAPTERS = {
  microsoft: microsoftAdapter,
  google: googleAdapter,
  ...createLlmAdapters(),
};
function adapterFor(provider) {
  if (!Object.hasOwn(SERVICE_ADAPTERS, provider))
    throw new Error('Unsupported translation service.');
  return SERVICE_ADAPTERS[provider];
}
// Keep a common protocol entry point for unit tests and future service diagnostics.
export function serviceLanguage(code, provider) {
  return adapterFor(provider).language(code);
}
export function buildRequest(text, settings, session) {
  return adapterFor(settings.provider).buildRequest(text, settings, session);
}
export function parseResponse(payload, provider) {
  return adapterFor(provider).parseResponse(payload);
}
