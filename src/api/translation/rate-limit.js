/**
 * Share request pacing and cooldowns by service and private configuration, across pages and languages.
 * Cooldowns block only new network requests; successful cached results remain usable, with no automatic provider fallback.
 * On 429, honor Retry-After in seconds or HTTP-date form instead of immediately retrying in a loop.
 */
export function createRateLimiter({ now = Date.now } = {}) {
  const states = new Map();
  function state(key) {
    if (!states.has(key))
      states.set(key, { nextAt: 0, blockedUntil: 0, reason: '', retryable: true });
    return states.get(key);
  }
  const check = (key) => {
    const value = state(key);
    if (value.blockedUntil > now())
      throw Object.assign(
        new Error(
          `${value.reason} Retry in ${Math.ceil((value.blockedUntil - now()) / 1000)} seconds or switch services.`,
        ),
        { retryable: value.retryable, retryAfterMs: value.blockedUntil - now() },
      );
  };
  return {
    check,
    reserve(key, interval = 0) {
      check(key);
      const value = state(key),
        start = Math.max(now(), value.nextAt);
      value.nextAt = start + interval;
      return start - now();
    },
    hold(key, milliseconds, reason, retryable = true) {
      const value = state(key);
      value.blockedUntil = Math.max(value.blockedUntil, now() + milliseconds);
      value.reason = reason;
      value.retryable = retryable;
    },
    retryAfter(header, fallback = 30000) {
      const seconds = header === null || header === '' ? NaN : Number(header);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
      const date = Date.parse(header);
      return Number.isFinite(date) && date > now() ? date - now() : fallback;
    },
  };
}
