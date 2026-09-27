import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ar from '../messages/ar.json';
import { getDirection, isLocale, messages } from './index';

function keysOf(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keysOf(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('i18n', () => {
  it('maps Arabic to RTL and others to LTR', () => {
    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
    expect(getDirection('fr')).toBe('ltr');
  });

  it('validates locales', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });

  it('keeps Arabic catalog keys in sync with English', () => {
    expect(keysOf(ar).sort()).toEqual(keysOf(en).sort());
  });

  it('falls back to English for French', () => {
    expect(messages.fr).toBe(messages.en);
  });
});
