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

/** Fills `{name}` placeholders: format('Resend in {seconds}s', { seconds: 12 }). */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Copy for a stable server/auth code, falling back to the generic message. */
export function messageForCode(
  locale: Locale,
  code: string,
  vars: Record<string, string | number> = {},
): string {
  const codes = messages[locale].codes as Record<string, string>;
  return format(codes[code] ?? codes.UNKNOWN ?? messages[locale].errors.generic, vars);
}

/** Labels for the shared phone → code flow (@app/ui-web PhoneOtpFlow). */
export function phoneOtpLabels(locale: Locale) {
  const a = messages[locale].auth;
  return {
    phoneLabel: a.phone.label,
    phonePlaceholder: a.phone.placeholder,
    phoneHelp: a.phone.help,
    phoneEmpty: a.phone.empty,
    phoneInvalid: a.phone.invalid,
    phoneLbInvalid: a.phone.lbInvalid,
    phoneLandline: a.phone.landline,
    sendCode: a.sendCode,
    otpLabel: a.otp.label,
    sentWhatsapp: a.otp.sentWhatsapp,
    sentSms: a.otp.sentSms,
    resendIn: a.otp.resendIn,
    resend: a.otp.resend,
    useSms: a.otp.useSms,
    changeNumber: a.otp.changeNumber,
    verify: a.otp.verify,
  };
}
