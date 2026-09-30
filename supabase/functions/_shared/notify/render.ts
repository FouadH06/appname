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

const PHOTO_REASONS: Record<string, Record<'en' | 'ar', string>> = {
  not_relevant: {
    en: "it doesn't seem to show your {service}.",
    ar: 'لا يبدو أنها تُظهر {service}.',
  },
  not_your_result: {
    en: "it looks like a photo that isn't from your visit.",
    ar: 'يبدو أنها ليست صورة من زيارتك.',
  },
  contact_info: {
    en: 'it shows contact details or a QR code.',
    ar: 'تحتوي على معلومات تواصل أو رمز QR.',
  },
  unsupported_file: { en: "the file couldn't be opened.", ar: 'تعذّر فتح الملف.' },
  too_small: { en: 'the image is too small.', ar: 'الصورة صغيرة جدًا.' },
  guidelines: {
    en: "it doesn't follow our photo guidelines.",
    ar: 'لا تتوافق مع إرشادات الصور لدينا.',
  },
};

/** Reason codes (M10 media pipeline / moderators) → a customer-facing sentence. */
export function photoReason(code: string, service: string, locale: Locale): string {
  const r = PHOTO_REASONS[code] ?? PHOTO_REASONS.guidelines!;
  // French messages fall back to English (templates exist in EN + AR)
  return r[locale === 'ar' ? 'ar' : 'en'].replace(
    '{service}',
    service || (locale === 'ar' ? 'الخدمة' : 'service'),
  );
}

type DisputeText = Record<'customer' | 'business', Record<'en' | 'ar', string>>;
const DISPUTE_RESULTS: Record<string, DisputeText> = {
  no_show_upheld: {
    customer: {
      en: 'we reviewed your request and the no-show stays on this booking.',
      ar: 'راجعنا طلبك ويبقى الغياب مسجّلًا على هذا الحجز.',
    },
    business: {
      en: 'the no-show you marked stays on the booking.',
      ar: 'يبقى الغياب الذي سجّلته على الحجز.',
    },
  },
  no_show_overturned: {
    customer: {
      en: 'we reviewed your request and removed the no-show. Thanks for your patience.',
      ar: 'راجعنا طلبك وأزلنا تسجيل الغياب. شكرًا لصبرك.',
    },
    business: {
      en: 'after our review the no-show was removed and the visit counts as completed.',
      ar: 'بعد المراجعة أُزيل تسجيل الغياب وتُحتسب الزيارة مكتملة.',
    },
  },
  voided: {
    customer: {
      en: 'we closed the case without a penalty for either side.',
      ar: 'أغلقنا الحالة دون أي عقوبة على أي طرف.',
    },
    business: {
      en: 'the case was closed without a penalty for either side.',
      ar: 'أُغلقت الحالة دون أي عقوبة على أي طرف.',
    },
  },
  review_kept: {
    customer: {
      en: 'we reviewed the report and your review stays published.',
      ar: 'راجعنا البلاغ ويبقى تقييمك منشورًا.',
    },
    business: {
      en: 'after our review the review stays published.',
      ar: 'بعد المراجعة يبقى التقييم منشورًا.',
    },
  },
  review_text_removed: {
    customer: {
      en: "we removed your review's comment after checking the report; your star rating stays.",
      ar: 'أزلنا تعليق تقييمك بعد مراجعة البلاغ؛ يبقى تقييمك بالنجوم.',
    },
    business: {
      en: "the review's comment was removed; its star rating stays.",
      ar: 'أُزيل تعليق التقييم؛ ويبقى التقييم بالنجوم.',
    },
  },
  review_removed: {
    customer: {
      en: 'we removed your review after checking the report.',
      ar: 'أزلنا تقييمك بعد مراجعة البلاغ.',
    },
    business: {
      en: 'the review was removed after our review.',
      ar: 'أُزيل التقييم بعد المراجعة.',
    },
  },
  awaiting_info: {
    customer: {
      en: 'we need a bit more information from you. Please reply from your booking page.',
      ar: 'نحتاج إلى بعض المعلومات الإضافية منك. يرجى الرد من صفحة حجزك.',
    },
    business: {
      en: 'we need a bit more information from you. Please reply from your dashboard.',
      ar: 'نحتاج إلى بعض المعلومات الإضافية منك. يرجى الرد من لوحة التحكم.',
    },
  },
};

/** Dispute outcome (M11) → a sentence for the customer or the business (never internal notes). */
export function disputeResult(outcome: string, audience: string, locale: Locale): string {
  const r = DISPUTE_RESULTS[outcome] ?? DISPUTE_RESULTS.voided!;
  return r[audience === 'business' ? 'business' : 'customer'][locale === 'ar' ? 'ar' : 'en'];
}

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
    review_link: str(payload.review_link),
    // why a result photo wasn't published (a sentence; never safety details)
    photo_reason: photoReason(str(payload.photo_reason_code), str(payload.service_name), locale),
    // star rating (1–5) of a new review, for the team alert
    rating: typeof payload.rating === 'number' ? String(payload.rating) : str(payload.rating),
    // dispute outcome or info request (M11), per audience
    dispute_result: disputeResult(str(payload.dispute_outcome), str(payload.audience), locale),
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
          : b === 'review' || b === 'review_edit'
            ? str(payload.review_token) // {web}/review/{{1}}
            : b === 'reviews'
              ? str(payload.dashboard_path).replace(/\/bookings$/, '/reviews') // {web}/biz/{{1}}
              : b === 'result'
                ? str(payload.result_id) // {web}/r/{{1}}
                : b === 'photos'
                  ? str(payload.review_token) // {web}/review/{{1}}
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

const pathOf = (link: string) => {
  try {
    return link.startsWith('/') ? link : new URL(link).pathname;
  } catch {
    return '';
  }
};

/**
 * Where a push opens (M13): the same path as the web route, so universal links, the app router and
 * the web all agree. Never stale: booking detail always shows the current state.
 */
export function pushPath(type: string, payload: Record<string, unknown>): string {
  const booking = str(payload.booking_id);
  const review = pathOf(str(payload.review_link));
  if (
    (type === 'review_request' || type === 'review_needs_changes' || type === 'result_rejected') &&
    review
  )
    return review;
  if (type === 'result_published' && str(payload.result_id)) return `/r/${str(payload.result_id)}`;
  return booking ? `/bookings/${booking}` : '/notifications';
}
