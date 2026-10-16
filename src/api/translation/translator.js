import { SERVICE_ADAPTERS, splitText } from '../providers/index.js';
import { BatchAlignmentError, packParagraphs, splitBatchText } from '../providers/shared/batch.js';
import { validateSettings } from '../../store/settings/index.js';
import { abortError, checkAbort, waitWithSignal } from '../../utils/async/cancellation.js';
import { createRateLimiter } from './rate-limit.js';
import { protectedTextParts } from '../providers/shared/text.js';
import { isAlreadyTargetLanguage } from '../../i18n/detection/target-language.js';
import { CACHE_TTL_MS } from '../../store/cache/index.js';
import { retryableError, translationFailure, errorFromFailure } from './errors.js';

/**
 * UI-independent translation service: translate() and translateMany() share adapters, queues, and caches.
 * Batch only services that support it; LLMs without a batch contract use individual requests.
 * signal cancels the current page's request run, without affecting other pages or their caches.
 */
export function createTranslator({
  fetchImpl = fetch,
  adapters = SERVICE_ADAPTERS,
  concurrency = 2,
  cacheLimit = 400,
  cacheStore,
  onUsage,
  cacheTtlMs = cacheStore?.ttlMs || CACHE_TTL_MS,
  now = Date.now,
  timeoutMs = 12000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const registry = { ...adapters };
  const cache = new Map(),
    pending = new Map(),
    queue = [];
  const sessions = new Map(),
    sessionPromises = new Map();
  const signalIds = new WeakMap();
  const limiter = createRateLimiter();
  let nextSignalId = 0,
    active = 0;
  const hash = async (value) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  async function prepare(settings, providerConfig) {
    validateSettings(settings, registry);
    settings = { ...settings };
    const config = structuredClone(providerConfig);
    registry[settings.provider].validateConfig?.(config);
    return { settings, config, configKey: await hash(JSON.stringify(config)) };
  }
  const textKey = (text, context) => {
    const parts = [
      context.settings.provider,
      context.configKey,
      context.settings.sourceLanguage,
      context.settings.targetLanguage,
      context.settings.preserveMentions === true,
      text,
    ];
    // Older multiline results may omit Chinese lines; isolate those caches while retaining successful single-line results across versions.
    if (/[\r\n]/.test(text)) parts.push('complete-lines-v2');
    return hash(JSON.stringify(parts));
  };
  function remember(key, text, createdAt = now()) {
    cache.delete(key);
    cache.set(key, { text, createdAt });
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
  }
  async function putCache(key, text) {
    remember(key, text);
    // Cache write failures must not fail successful translations; in-memory background results remain reusable.
    await cacheStore?.put(key, text).catch(() => {});
  }
  async function cached(key) {
    let entry = cache.get(key);
    if (entry && (now() - entry.createdAt >= cacheTtlMs || entry.createdAt > now())) {
      cache.delete(key);
      entry = undefined;
    }
    if (!entry && cacheStore) {
      entry = cacheStore.getEntry
        ? await cacheStore.getEntry(key).catch(() => undefined)
        : await cacheStore
            .get(key)
            .then((text) => (text === undefined ? undefined : { text, createdAt: now() }))
            .catch(() => undefined);
    }
    if (entry) remember(key, entry.text, entry.createdAt);
    return entry?.text;
  }
  function validateText(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('There is no text to translate.');
    if (text.length > 40000)
      throw new Error(
        'This paragraph is too long (over 40000 characters). Translate it in smaller parts.',
      );
  }
  /** Cache temporary sessions only in background memory; cancelling one page must not abort a session shared by other pages. */
  async function getSession(context, force = false) {
    const { settings, config, configKey } = context;
    const adapter = registry[settings.provider];
    if (!adapter.sessionUrl) return undefined;
    const key = `${settings.provider}:${configKey}`;
    if (force) sessions.delete(key);
    if (sessions.get(key)?.expiresAt > Date.now()) return sessions.get(key);
    if (!sessionPromises.has(key))
      sessionPromises.set(
        key,
        (async () => {
          try {
            const url =
              typeof adapter.sessionUrl === 'function'
                ? adapter.sessionUrl(config)
                : adapter.sessionUrl;
            const response = await fetchImpl(url, {
              signal: AbortSignal.timeout(timeoutMs),
              credentials: 'omit',
              cache: 'no-store',
            });
            if (!response.ok)
              throw retryableError(
                'The free service session is unavailable. Switch services.',
                15000,
              );
            const session = adapter.parseSession(await response.text());
            sessions.set(key, session);
            return session;
          } catch (error) {
            if (error instanceof TypeError || error.name === 'TimeoutError')
              throw retryableError('Cannot connect. Check your network or switch services.', 15000);
            throw error;
          } finally {
            sessionPromises.delete(key);
          }
        })(),
      );
    return sessionPromises.get(key);
  }
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      job.cleanup();
      if (job.signal?.aborted) {
        job.reject(abortError());
        continue;
      }
      active++;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          drain();
        });
    }
  }
  /** Remove queued tasks immediately on cancellation; request() aborts active requests through AbortController. */
  function schedule(task, signal) {
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const job = {
        task,
        signal,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        job.cleanup();
        reject(abortError());
      };
      signal?.addEventListener('abort', abort, { once: true });
      queue.push(job);
      drain();
    });
  }
  /** Accept a paragraph or paragraph array; service adapters always construct requests and parse responses. */
  async function request(input, context, signal) {
    const { settings, config } = context;
    const adapter = registry[settings.provider];
    const batch = Array.isArray(input);
    const serviceKey = `${settings.provider}:${context.configKey}`;
    const statusError = (status, retryAfter) => {
      const hints = {
        400: 'the service does not support these parameters or languages',
        401: 'authentication failed or the endpoint is unavailable',
        403: 'the service blocked the request or access is insufficient',
        404: 'the endpoint or model does not exist',
        429: 'requests are too frequent',
      };
      const error = new Error(
        `Translation failed (${status}): ${hints[status] || 'the service is temporarily unavailable'}.`,
      );
      error.retryable = status === 408 || status === 429 || status >= 500;
      error.retryAfterMs = error.retryable
        ? limiter.retryAfter(retryAfter, status === 429 ? 30000 : 15000)
        : 0;
      if ([401, 403, 429, 502, 503, 504].includes(status))
        limiter.hold(
          serviceKey,
          limiter.retryAfter(retryAfter, status === 429 ? 30000 : 15000),
          error.message,
          error.retryable,
        );
      return error;
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      checkAbort(signal);
      limiter.check(serviceKey);
      let session;
      try {
        session = await waitWithSignal(getSession(context), signal);
      } catch (error) {
        if (error.name !== 'AbortError') limiter.hold(serviceKey, 15000, error.message);
        throw error;
      }
      // Reserve a send time after loading the session to prevent simultaneous bursts when shared session loading completes.
      const delay = limiter.reserve(serviceKey, adapter.minRequestIntervalMs);
      if (delay > 0) await waitWithSignal(sleep(delay), signal);
      checkAbort(signal);
      limiter.check(serviceKey);
      const { url, init } = batch
        ? adapter.buildBatchRequest(input, settings, session, config)
        : adapter.buildRequest(input, settings, session, config);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const duration =
        typeof adapter.requestTimeoutMs === 'function'
          ? adapter.requestTimeoutMs(config)
          : adapter.requestTimeoutMs;
      const timer = setTimeout(abort, duration || timeoutMs);
      try {
        checkAbort(signal);
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        if (response.status === 429) throw statusError(429, response.headers.get('Retry-After'));
        if ([502, 503, 504].includes(response.status) && attempt < 2) {
          clearTimeout(timer);
          const retryDelay = limiter.retryAfter(
            response.headers.get('Retry-After'),
            700 * 2 ** attempt,
          );
          // Record long service cooldowns so pages skip silently; never truncate Retry-After and retry early.
          if (retryDelay > 3000)
            throw statusError(response.status, response.headers.get('Retry-After'));
          await waitWithSignal(sleep(retryDelay), signal);
          continue;
        }
        if (adapter.shouldRefreshSession?.(response.status) && attempt === 0) {
          await waitWithSignal(getSession(context, true), signal);
          continue;
        }
        if (!response.ok) throw statusError(response.status, response.headers.get('Retry-After'));
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw retryableError('Unexpected API response. Retry later or switch services.');
        }
        // Count reported usage even if parsing fails or the page is cancelled; cache hits do not pass through here.
        if (adapter.parseUsage && onUsage) {
          try {
            await onUsage({
              provider: settings.provider,
              model:
                typeof payload.model === 'string' && payload.model.trim()
                  ? payload.model.trim()
                  : config.model,
              usage: await adapter.parseUsage(payload, config, init.body),
            });
          } catch {
            // Usage write failures do not affect received translations.
          }
        }
        checkAbort(signal);
        if (adapter.shouldRefreshSession?.(response.status, payload) && attempt === 0) {
          await waitWithSignal(getSession(context, true), signal);
          continue;
        }
        const payloadStatus = adapter.responseStatus?.(payload);
        if (payloadStatus >= 400)
          throw statusError(payloadStatus, response.headers.get('Retry-After'));
        if (!batch) return adapter.parseResponse(payload, config);
        const translations = adapter.parseBatchResponse(payload, input, config);
        if (
          !Array.isArray(translations) ||
          translations.length !== input.length ||
          translations.some((text) => typeof text !== 'string' || !text.trim())
        )
          throw new BatchAlignmentError();
        return translations;
      } catch (error) {
        checkAbort(signal);
        if (controller.signal.aborted) {
          limiter.hold(serviceKey, 10000, 'The translation service timed out.');
          throw retryableError('Translation timed out. Retry later or switch services.', 10000);
        }
        if (error instanceof TypeError) {
          limiter.hold(serviceKey, 10000, 'Cannot connect to the translation service.');
          throw retryableError(
            'Cannot connect to the translation API. Check its URL, your network, and service status.',
            10000,
          );
        }
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
  }
  const api = {
    /** Connection tests must contact the API, bypass translation caches, and avoid sharing active text tasks. */
    async testConnection(text, settings, providerConfig = {}, { signal } = {}) {
      validateText(text);
      const context = await prepare(settings, providerConfig);
      return schedule(() => request(text, context, signal), signal);
    },
    /** Keep the single-paragraph interface compatible; providerConfig is private background data and options.signal cancels a run. */
    async translate(text, settings, providerConfig = {}, { signal } = {}) {
      const [result] = await api.translateMany([text], settings, providerConfig, { signal });
      if (result.error) throw errorFromFailure(result);
      return result.skipped ? text : result.text;
    },
    /**
     * Return an equally sized array of {text}, {skipped:true}, or {error} entries in input order.
     * Exclude cache hits and duplicate sources first; batch split long paragraphs too, with at most two sub-batches on alignment failure.
     * Network/rate-limit errors must not fan out into retries; AbortError ends the entire run.
     */
    async translateMany(texts, settings, providerConfig = {}, { signal } = {}) {
      if (!Array.isArray(texts) || !texts.length || texts.length > 24)
        throw new Error('A batch must contain 1 to 24 paragraphs.');
      const context = await prepare(settings, providerConfig);
      if (
        texts.some(
          (text) =>
            typeof text === 'string' &&
            protectedTextParts(text, context.settings).some((part) => part.literal),
        )
      ) {
        const units = [],
          plans = [];
        // Check the full paragraph cache first and cache reassembled fragments too; emoji/handles must not cause repeat requests on revisits.
        for (const text of texts) {
          try {
            validateText(text);
          } catch (error) {
            plans.push({ error: error.message });
            continue;
          }
          if (isAlreadyTargetLanguage(text, context.settings.targetLanguage)) {
            plans.push({ skipped: true });
            continue;
          }
          const key = await textKey(text, context),
            value = await cached(key);
          if (value !== undefined) {
            plans.push({ text: value });
            continue;
          }
          const parts = protectedTextParts(text, context.settings).map((part) => {
            if (part.literal || !/\p{L}/u.test(part.text)) return { literal: part.text };
            const leading = part.text.match(/^\s*/)[0],
              trailing = part.text.match(/\s*$/)[0];
            const index = units.length;
            units.push(part.text.trim());
            return { index, leading, trailing };
          });
          plans.push({ key, parts });
        }
        const groups = [];
        for (let offset = 0; offset < units.length; offset += 24)
          groups.push(units.slice(offset, offset + 24));
        const results = (
          await Promise.all(
            groups.map((group) =>
              api.translateMany(group, context.settings, context.config, { signal }),
            ),
          )
        ).flat();
        checkAbort(signal);
        return Promise.all(
          plans.map(async (plan) => {
            if (!plan.parts) return plan;
            const error = plan.parts.find(
              (part) => part.index !== undefined && results[part.index]?.error,
            );
            if (error) return results[error.index];
            const text = plan.parts
              .map(
                (part) =>
                  part.literal ??
                  `${part.leading}${results[part.index].skipped ? units[part.index] : results[part.index].text}${part.trailing}`,
              )
              .join('');
            await putCache(plan.key, text);
            return { text };
          }),
        );
      }
      if (texts.some((text) => typeof text === 'string' && /[\r\n]/.test(text))) {
        // Preserve each source block's line structure; lines are separate batch units so services cannot merge line breaks.
        // Still batch lines within service limits rather than sending them serially. Keep empty lines in place without requests.
        const units = [],
          plans = [];
        for (const text of texts) {
          try {
            validateText(text);
          } catch (error) {
            plans.push({ error: error.message });
            continue;
          }
          // Decide whether to display a translation for the whole block. Skip all-Chinese blocks, but fully reconstruct mixed blocks without dropping Chinese lines.
          if (isAlreadyTargetLanguage(text, context.settings.targetLanguage)) {
            plans.push({ skipped: true });
            continue;
          }
          const key = await textKey(text, context),
            value = await cached(key);
          if (value !== undefined) {
            plans.push({ text: value });
            continue;
          }
          const lines = text
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => {
              if (!/\p{L}/u.test(line)) return { literal: line };
              const index = units.length;
              units.push(line);
              return { index };
            });
          plans.push({ key, lines });
        }
        const groups = [];
        for (let offset = 0; offset < units.length; offset += 24)
          groups.push(units.slice(offset, offset + 24));
        const translated = (
          await Promise.all(
            groups.map((group) =>
              api.translateMany(group, context.settings, context.config, { signal }),
            ),
          )
        ).flat();
        checkAbort(signal);
        return Promise.all(
          plans.map(async (plan) => {
            if (!plan.lines) return plan;
            const error = plan.lines.find(
              (line) => line.index !== undefined && translated[line.index].error,
            );
            if (error) return translated[error.index];
            if (
              plan.lines.every(
                (line) => line.literal !== undefined || translated[line.index].skipped,
              )
            )
              return { skipped: true };
            const text = plan.lines
              .map(
                (line) =>
                  line.literal ??
                  (translated[line.index].skipped
                    ? units[line.index]
                    : translated[line.index].text),
              )
              .join('\n');
            await putCache(plan.key, text);
            return { text };
          }),
        );
      }
      const results = new Array(texts.length),
        unique = new Map();
      await Promise.all(
        texts.map(async (text, index) => {
          try {
            validateText(text);
            if (isAlreadyTargetLanguage(text, context.settings.targetLanguage)) {
              results[index] = { skipped: true };
              return;
            }
          } catch (error) {
            results[index] = { error: error.message };
            return;
          }
          const key = await textKey(text, context),
            value = await cached(key);
          if (value !== undefined) {
            results[index] = { text: value };
            return;
          }
          if (!unique.has(key)) unique.set(key, { key, text, indices: [] });
          unique.get(key).indices.push(index);
        }),
      );
      checkAbort(signal);
      const adapter = registry[context.settings.provider];
      const limits =
        adapter.buildBatchRequest && adapter.parseBatchResponse ? adapter.batchLimits : undefined;
      const write = (item, value) => {
        for (const index of item.indices) results[index] = value;
      };
      if (signal && !signalIds.has(signal)) signalIds.set(signal, ++nextSignalId);
      const items = [],
        units = new Map(),
        waiters = [];
      for (const item of unique.values()) {
        const pendingKey = `${item.key}:${signal ? signalIds.get(signal) : 'shared'}`;
        let promise = pending.get(pendingKey);
        if (!promise) {
          const chunks = limits
            ? splitBatchText(item.text, limits)
            : splitText(item.text, adapter.chunkSize);
          const deferred = {};
          const shared = new Promise((resolve, reject) => {
            deferred.resolve = resolve;
            deferred.reject = reject;
          });
          deferred.promise = shared;
          promise = deferred.promise;
          pending.set(pendingKey, promise);
          item.parts = chunks.map((text) => {
            if (!units.has(text)) units.set(text, { text });
            return units.get(text);
          });
          items.push({ ...item, deferred, pendingKey });
        }
        waiters.push(
          promise.then(
            (text) => write(item, { text }),
            (error) => {
              if (error.name === 'AbortError') throw error;
              write(item, translationFailure(error));
            },
          ),
        );
      }
      const send = async (group, retryAlignment = true) => {
        const batched = limits && (group.length > 1 || group[0].text.length > adapter.chunkSize);
        try {
          const translated = await schedule(
            () =>
              request(batched ? group.map((unit) => unit.text) : group[0].text, context, signal),
            signal,
          );
          checkAbort(signal);
          group.forEach((unit, index) => {
            unit.result = { text: batched ? translated[index] : translated };
          });
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          // Never resend paragraph by paragraph: split into at most two batches with at least two items each; report small-batch failures directly.
          if (error instanceof BatchAlignmentError && retryAlignment && group.length >= 4) {
            const middle = Math.ceil(group.length / 2);
            await Promise.all([
              send(group.slice(0, middle), false),
              send(group.slice(middle), false),
            ]);
          } else
            group.forEach((unit) => {
              unit.result = translationFailure(error);
            });
        }
      };
      try {
        await Promise.all(packParagraphs([...units.values()], limits).map((group) => send(group)));
        checkAbort(signal);
        await Promise.all(
          items.map(async (item) => {
            try {
              const failed = item.parts.find((unit) => unit.result.error);
              if (failed) throw errorFromFailure(failed.result);
              const translation = item.parts.map((unit) => unit.result.text).join('\n');
              checkAbort(signal);
              await putCache(item.key, translation);
              item.deferred.resolve(translation);
            } catch (error) {
              item.deferred.reject(error);
            } finally {
              pending.delete(item.pendingKey);
            }
          }),
        );
      } catch (error) {
        items.forEach((item) => {
          item.deferred.reject(error);
          pending.delete(item.pendingKey);
        });
      }
      await Promise.all(waiters);
      checkAbort(signal);
      return results;
    },
    clearCache() {
      cache.clear();
      return cacheStore?.clear();
    },
    /** Prefetch only the public web session, without source text; actual user requests reuse the same Promise. */
    async warm(settings) {
      const context = await prepare(settings, {});
      if (registry[settings.provider].sessionUrl) await getSession(context);
    },
  };
  return api;
}
