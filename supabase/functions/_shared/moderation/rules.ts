import { latinDigits } from './normalize.ts';
import type { RulesResult, Span } from './types.ts';

// Deterministic checks before any model: contact details (redacted, never published), links,
// spam phrases, repeated characters. Positions refer to the original text.

const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s]+|\bt\.me\/[^\s]+|\b[a-z0-9-]{2,}\.(?:com|net|org|lb|me|io|co|app|info|biz|link|ly|shop|store)\b(?:\/[^\s]*)?/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const HANDLE_RE = /(?<![\w@])@[a-z0-9_.]{3,30}\b/gi;
// digit runs with separators; checked below after stripping them
const DIGITS_RE = /\+?\d[\d\s.\-()]{5,18}\d/g;

/** Lebanese mobile/landline (with or without +961 / 00961 / leading 0) or any international number. */
export function isPhoneNumber(raw: string): boolean {
  // lira amounts are written 1.500.000 — not a phone
  if (/^\d{1,3}(?:\.\d{3})+$/.test(raw.trim())) return false;
  const d = raw.replace(/[^\d+]/g, '');
  const intl = /^(?:\+|00)?961/.test(d);
  const local = d.replace(/^(?:\+|00)?961/, '');
  // mobiles: 03 / 3 + 6 digits, 70 71 76 78 79 81 + 6 digits; landlines need the 0 or +961 (01 234567)
  if (/^(?:0?3\d{6}|0?7[01689]\d{6}|0?81\d{6})$/.test(local)) return true;
  if (/^0[1-9]\d{6}$/.test(local) || (intl && /^[1-9]\d{6}$/.test(local))) return true;
  return /^(?:\+|00)\d{9,15}$/.test(d);
}

const SPAM_PHRASES = [
  'dm me',
  'dm us',
  'whatsapp me',
  'contact me on',
  'call me on',
  'follow us',
  'follow my',
  'check my page',
  'promo code',
  'discount code',
  'use code',
  't.me/',
  'bit.ly',
  'راسلني',
  'تواصل معي على',
  'تابعونا',
  'كود خصم',
  'code promo',
  'suivez-nous',
  'visitez',
  'cliquez ici',
  'investment',
  'تواصل معي',
];

export function applyRules(text: string): RulesResult {
  const t = latinDigits(text); // same length as text
  const spans: Span[] = [];
  const add = (re: RegExp, kind: Span['kind'], ok: (m: string) => boolean = () => true) => {
    for (const m of t.matchAll(re)) {
      if (m.index === undefined || !ok(m[0])) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, kind });
    }
  };
  add(EMAIL_RE, 'email');
  add(URL_RE, 'url', (m) => !/@/.test(m));
  add(HANDLE_RE, 'handle');
  add(DIGITS_RE, 'phone', isPhoneNumber);

  const flags: string[] = [];
  if (spans.some((s) => s.kind === 'url')) flags.push('link');
  const lower = t.toLowerCase();
  if (SPAM_PHRASES.some((p) => lower.includes(p))) flags.push('spam_phrase');
  if (/(.)\1{7,}/u.test(t)) flags.push('repeat_chars');
  return { piiSpans: mergeSpans(spans), flags };
}

export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Positions of exact substrings (e.g. PII values the classifier found) in the text. */
export function spansOf(text: string, values: string[], kind: Span['kind'] = 'handle'): Span[] {
  const out: Span[] = [];
  for (const v of values) {
    const needle = v.trim();
    if (needle.length < 3) continue;
    let i = text.indexOf(needle);
    while (i !== -1) {
      out.push({ start: i, end: i + needle.length, kind });
      i = text.indexOf(needle, i + needle.length);
    }
  }
  return out;
}

export const REDACTED = '[removed]';

export function redact(text: string, spans: Span[]): string {
  let out = '';
  let at = 0;
  for (const s of mergeSpans(spans)) {
    out += text.slice(at, s.start) + REDACTED;
    at = s.end;
  }
  return out + text.slice(at);
}
