import { DEFAULT_LOCALE, format, messageForCode, messages, phoneOtpLabels } from '@app/i18n';

// English UI at launch (Phase 2); the Arabic catalog is kept in sync for when it's enabled.
export const locale = DEFAULT_LOCALE;
export const t = messages[locale];
export const otpLabels = phoneOtpLabels(locale);
export const describeError = (code: string, vars: Record<string, string | number> = {}) =>
  messageForCode(locale, code, vars);
export { format };
