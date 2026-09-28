import type { Locale, Template, TemplateButton } from './types.ts';

// Rendering: dates and times are formatted per locale in the business's time zone (Asia/Beirut),
// never the server's. Missing optional values (e.g. no decline reason) leave no gaps.

// Arabic keeps the Levantine month names with Latin digits ("13 تشرين الأول الساعة 4:30 م")
const INTL_LOCALE: Record<Locale, string> = { en: 'en-GB', ar: 'ar-LB-u-nu-latn', fr: 'fr-FR' };

function when(iso: unknown, tz: string, locale: Locale) {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return { date: '', time: '' };
  const d = new Date(iso);
  const loc = INTL_LOCALE[locale];
  const date = new Intl.DateTimeFormat(loc, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  }).format(d);
  const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : loc, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  }).format(d);
  return { date, time };
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Template variables from an outbox payload. */
export function formatVars(
  payload: Record<string, unknown>,
  locale: Locale,
): Record<string, string> {
  const tz = str(payload.timezone) || 'Asia/Beirut';
  const now = when(payload.starts_at, tz, locale);
  const old = when(payload.old_starts_at, tz, locale);
  const reason = str(payload.reason);
  return {
    business_name: str(payload.business_name),
    service_name: str(payload.service_name),
    staff_name: str(payload.staff_name),
    customer_name: str(payload.customer_name) || (locale === 'ar' ? 'زبون' : 'Customer'),
    date: now.date,
    time: now.time,
    old_date: old.date,
    old_time: old.time,
    // a sentence either way: WhatsApp parameters can't be empty
    reason: reason
      ? `${locale === 'ar' ? 'السبب' : 'Reason'}: ${/[.!؟?]$/.test(reason) ? reason : `${reason}.`}`
      : locale === 'ar'
        ? 'نعتذر عن الإزعاج.'
        : "We're sorry for the inconvenience.",
    link: str(payload.link),
    business_url: str(payload.business_url),
    dashboard_link: str(payload.dashboard_link),
    business_phone: str(payload.business_phone),
  };
}

/** Fills {name} placeholders and tidies the spaces an empty value leaves behind. */
export function fill(body: string, vars: Record<string, string>): string {
  return body
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([.,:!?])/g, '$1')
    .replace(/:\s*$/, '')
    .trim();
}

/** WhatsApp body parameters in template order (Meta rejects empty parameters). */
export function whatsappParams(t: Template, vars: Record<string, string>): string[] {
  return t.variables.map((v) => (vars[v] ?? '').trim() || '—');
}

/**
 * Button parameters in template order: Confirm / Cancel quick replies carry `action:booking_id`
 * back to the webhook; URL buttons get their dynamic suffix (booking token, business slug,
 * dashboard path).
 */
export function templateButtons(t: Template, payload: Record<string, unknown>): TemplateButton[] {
  const id = str(payload.booking_id);
  return t.buttons.map((b): TemplateButton => {
    if (b === 'confirm' || b === 'cancel') return { kind: 'quick_reply', payload: `${b}:${id}` };
    const suffix =
      b === 'view'
        ? str(payload.link_token)
        : b === 'book'
          ? str(payload.business_slug)
          : str(payload.dashboard_path);
    return { kind: 'url', text: suffix || '-' };
  });
}

// ─── Replies to WhatsApp button taps (inside the customer's open session) ──
const REPLIES: Record<string, Record<'en' | 'ar', string>> = {
  confirmed: {
    en: "Thanks! You're confirmed for {service_name} at {business_name} on {date} at {time}.",
    ar: 'شكرًا! تم تأكيد حضورك لـ {service_name} في {business_name} يوم {date} الساعة {time}.',
  },
  cannot_confirm: {
    en: "This booking can't be confirmed anymore. Details: {link}",
    ar: 'لم يعد بالإمكان تأكيد هذا الحجز. التفاصيل: {link}',
  },
  cancel_link: {
    en: 'To change or cancel your booking, open your booking page: {link} (the cancellation policy is shown there before you confirm).',
    ar: 'لتعديل الحجز أو إلغائه، افتح صفحة الحجز: {link} (تظهر سياسة الإلغاء هناك قبل التأكيد).',
  },
  not_yours: {
    en: "We couldn't match this booking to your number.",
    ar: 'لم نتمكن من ربط هذا الحجز برقمك.',
  },
};

export function replyText(result: Record<string, unknown> | null): string | null {
  const kind = typeof result?.reply === 'string' ? result.reply : '';
  const r = REPLIES[kind];
  if (!r || !result) return null;
  const locale: Locale = result.locale === 'ar' ? 'ar' : 'en';
  return fill(r[locale === 'ar' ? 'ar' : 'en'], formatVars(result, locale));
}
