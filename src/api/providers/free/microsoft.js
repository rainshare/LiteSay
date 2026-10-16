import { BatchAlignmentError } from '../shared/batch.js';

/** Microsoft Edge free web translation uses native string arrays, without scraping Bing or storing temporary credentials. */
export function microsoftLanguage(code) {
  if (code === 'auto') return '';
  if (['zh', 'zh-CN'].includes(code)) return 'zh-Hans';
  if (['zh-TW', 'zh-HK'].includes(code)) return 'zh-Hant';
  if (code === 'tl') return 'fil';
  if (code === 'pt-BR') return 'pt';
  if (['en-US', 'en-GB'].includes(code)) return 'en';
  return code;
}

export function buildMicrosoftBatchRequest(texts, settings) {
  const url = new URL('https://edge.microsoft.com/translate/translatetext');
  const from = microsoftLanguage(settings.sourceLanguage);
  if (from) url.searchParams.set('from', from);
  url.searchParams.set('to', microsoftLanguage(settings.targetLanguage));
  url.searchParams.set('isEnterpriseClient', 'false');
  return {
    url: url.href,
    init: {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(texts),
    },
  };
}

export const buildMicrosoftRequest = (text, settings) =>
  buildMicrosoftBatchRequest([text], settings);
export function parseMicrosoftBatchResponse(payload, texts) {
  if (!Array.isArray(payload) || payload.length !== texts.length) throw new BatchAlignmentError();
  const result = payload.map((item) => item?.translations?.[0]?.text);
  if (result.some((text) => typeof text !== 'string' || !text.trim()))
    throw new BatchAlignmentError();
  return result.map((text) => text.trim());
}
export const parseMicrosoftResponse = (payload) => parseMicrosoftBatchResponse(payload, [''])[0];

export const microsoftAdapter = {
  minRequestIntervalMs: 150,
  chunkSize: 1800,
  language: microsoftLanguage,
  buildRequest: buildMicrosoftRequest,
  parseResponse: parseMicrosoftResponse,
  batchLimits: { maxItems: 24, maxCharacters: 5000, separatorCharacters: 0 },
  buildBatchRequest: buildMicrosoftBatchRequest,
  parseBatchResponse: parseMicrosoftBatchResponse,
  responseStatus: (payload) =>
    payload?.statusCode || Math.floor((payload?.error?.code || 0) / 1000),
};
