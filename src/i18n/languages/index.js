import { LANGUAGE_CATALOG, LANGUAGE_PRIORITY } from './catalog.js';
import { DEFAULT_UI_LOCALE } from '../messages/catalog.js';
import { t, getLocale } from '../engine/index.js';

/** Checked-in names avoid incomplete Intl.DisplayNames data across browsers. */
const nameOf = (entry, locale) => entry[locale] || entry[DEFAULT_UI_LOCALE];
export const LANGUAGES = LANGUAGE_CATALOG.map((entry) => ({
  code: entry.code,
  name: nameOf(entry, DEFAULT_UI_LOCALE),
}));
export function orderedLanguages(locale = getLocale()) {
  const priority = LANGUAGE_PRIORITY;
  const rank = (code) => (priority.includes(code) ? priority.indexOf(code) : 999);
  return LANGUAGE_CATALOG.map((entry) => ({
    code: entry.code,
    name: nameOf(entry, locale),
    search: Object.values(entry).join(' '),
  })).sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name, locale));
}
export function languageName(code, locale = getLocale()) {
  if (code === 'auto') return t('languages.auto', {}, locale);
  const entry = LANGUAGE_CATALOG.find((entry) => entry.code.toLowerCase() === code?.toLowerCase());
  if (entry) return nameOf(entry, locale);
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}
export function isLanguageCode(code, allowAuto = false) {
  return (
    typeof code === 'string' &&
    ((allowAuto && code === 'auto') ||
      (code !== 'auto' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code)))
  );
}
