import { UI_LOCALES, DEFAULT_UI_LOCALE } from '../messages/catalog.js';
export const isUiLocale = (value) => UI_LOCALES.some((locale) => locale.code === value);
export const normalizeUiLocale = (value) => (isUiLocale(value) ? value : DEFAULT_UI_LOCALE);
