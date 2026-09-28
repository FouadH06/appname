// Phone parsing shared by web and mobile (Phase 2 §5 "Phone"). Mirrors the database's
// private.normalize_phone (Part 1 §7) and adds Lebanese number-type validation for the UI.

export type PhoneKind = 'lb_mobile' | 'lb_landline' | 'international';

export interface ParsedPhone {
  /** E.164 with '+', e.g. +96170123456 */
  e164: string;
  kind: PhoneKind;
  /** Readable form, e.g. "+961 70 123 456" */
  display: string;
  /** Can receive an OTP by WhatsApp/SMS (landlines can't) */
  canReceiveOtp: boolean;
}

export type PhoneParseError = 'empty' | 'invalid' | 'lb_invalid';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(raw: string): string {
  return raw.replace(/[٠-٩۰-۹]/g, (d) => String(ARABIC_DIGITS.indexOf(d) % 10));
}

// Lebanese national numbers after +961: mobile 3xxxxxx or 70/71/76/78/79/81 xxxxxx; landline
// 1,4,5,6,7,8,9 + 6 digits (area code without the trunk 0).
const LB_MOBILE = /^(3\d{6}|(70|71|76|78|79|81)\d{6})$/;
const LB_LANDLINE = /^[1456789]\d{6}$/;

/** Same rules as private.normalize_phone: +/00 international, 0 = trunk prefix, bare 7–8 digits = Lebanon. */
export function toE164(raw: string, defaultCountryCode = '961'): string | null {
  let d = normalizeDigits(raw).replace(/[^0-9+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = defaultCountryCode + d.slice(1);
  else if (d.length >= 7 && d.length <= 8) d = defaultCountryCode + d;
  if (!/^[1-9][0-9]{7,14}$/.test(d)) return null;
  return '+' + d;
}

export function parsePhone(
  raw: string,
): { ok: true; phone: ParsedPhone } | { ok: false; error: PhoneParseError } {
  if (!raw || !raw.trim()) return { ok: false, error: 'empty' };
  const e164 = toE164(raw);
  if (!e164) return { ok: false, error: 'invalid' };

  if (e164.startsWith('+961')) {
    const national = e164.slice(4);
    if (LB_MOBILE.test(national)) {
      return {
        ok: true,
        phone: { e164, kind: 'lb_mobile', display: formatLb(national), canReceiveOtp: true },
      };
    }
    if (LB_LANDLINE.test(national)) {
      return {
        ok: true,
        phone: { e164, kind: 'lb_landline', display: formatLb(national), canReceiveOtp: false },
      };
    }
    return { ok: false, error: 'lb_invalid' };
  }
  return {
    ok: true,
    phone: { e164, kind: 'international', display: formatInternational(e164), canReceiveOtp: true },
  };
}

function formatLb(national: string): string {
  // 3 123 456  |  70 123 456  |  1 234 567 (landline)
  const head = national.length === 7 ? national.slice(0, 1) : national.slice(0, 2);
  const rest = national.slice(head.length);
  return `+961 ${head} ${rest.slice(0, 3)} ${rest.slice(3)}`;
}

function formatInternational(e164: string): string {
  const digits = e164.slice(1);
  return '+' + digits.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

/** "+961 70 ••• 456": what the server's private.mask_phone returns, for client-side display. */
export function maskPhone(e164: string): string {
  if (e164.startsWith('+961')) return `+961 ${e164.slice(4, 6)} ••• ${e164.slice(-3)}`;
  return `${e164.slice(0, 4)} ••• ${e164.slice(-3)}`;
}
