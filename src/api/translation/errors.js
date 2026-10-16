/** Retry policy is independent of display messages; pages must not classify failures by parsing error text. */
export function retryableError(message, retryAfterMs = 0) {
  return Object.assign(new Error(message), { retryable: true, retryAfterMs });
}

export function translationFailure(error) {
  const result = { error: error.message || 'The translation service returned an error.' };
  if (error.retryable === true || error.name === 'BatchAlignmentError') {
    result.retryable = true;
    result.retryAfterMs = Math.max(0, Number(error.retryAfterMs) || 0);
  }
  return result;
}

export function errorFromFailure(failure) {
  return Object.assign(new Error(failure.error), {
    retryable: failure.retryable === true,
    retryAfterMs: failure.retryAfterMs || 0,
  });
}
