import ar from '../messages/ar.json';
import en from '../messages/en.json';

/** Locales the platform supports. French UI is Later (Phase 2), but the value exists now. */
export const LOCALES = ['en', 'ar', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

/** UI locales enabled at launch (Phase 2 Part 1 §3: English UI; Arabic UI is Soon). */
export const ENABLED_UI_LOCALES: readonly Locale[] = ['en'];

export const DEFAULT_LOCALE: Locale = 'en';

const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);

export type Direction = 'ltr' | 'rtl';

export function getDirection(locale: Locale): Direction {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export type Messages = typeof en;

/** Message catalogs. `fr` falls back to English until the French UI ships. */
export const messages: Record<Locale, Messages> = {
  en,
  ar: ar satisfies Messages,
  fr: en,
};
