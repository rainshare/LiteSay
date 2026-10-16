/**
 * Adapter for Google's free web translation endpoint.
 * Defines the protocol only: no Chrome storage, network requests, or page DOM access.
 * This internal web endpoint may change its supported languages, response format, or rate limits.
 */
import { BatchAlignmentError } from '../shared/batch.js';

export function googleLanguage(code) {
  // The free web endpoint uses base language codes, except Chinese retains zh-CN / zh-TW.
  if (['en-US', 'en-GB', 'pt-BR', 'pt-PT'].includes(code)) return code.split('-')[0];
  return code;
}

/** Send text through repeated q form fields; line breaks within a paragraph do not align batches. */
export function buildGoogleBatchRequest(texts, settings) {
  const url = new URL('https://translate.googleapis.com/translate_a/t');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', googleLanguage(settings.sourceLanguage));
  url.searchParams.set('tl', googleLanguage(settings.targetLanguage));
  const body = new URLSearchParams();
  for (const text of texts) body.append('q', text);
  return {
    url: url.href,
    init: {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  };
}

export function parseGoogleBatchResponse(payload, texts) {
  const result = Array.isArray(payload)
    ? payload.map((item) => (typeof item === 'string' ? item : item?.[0]))
    : [];
  if (
    result.length !== texts.length ||
    result.some((text) => typeof text !== 'string' || !text.trim())
  )
    throw new BatchAlignmentError();
  return result.map((text) => text.trim());
}
export const buildGoogleRequest = (text, settings) => buildGoogleBatchRequest([text], settings);
export const parseGoogleResponse = (payload) => parseGoogleBatchResponse(payload, [''])[0];

export const googleAdapter = {
  minRequestIntervalMs: 250,
  chunkSize: 1200,
  language: googleLanguage,
  buildRequest: buildGoogleRequest,
  parseResponse: parseGoogleResponse,
  batchLimits: { maxItems: 24, maxCharacters: 5000, separatorCharacters: 0 },
  // Repeated q fields form a native array protocol; translated line breaks do not delimit paragraphs.
  buildBatchRequest: buildGoogleBatchRequest,
  parseBatchResponse: parseGoogleBatchResponse,
};
