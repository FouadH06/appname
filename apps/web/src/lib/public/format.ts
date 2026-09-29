import { beirutParts } from '../biz/schedule';
import type { BusinessPage, PriceType, PublicReview } from './types';

/** Trust labels (plain module so server components can read it, unlike a 'use client' export). */
export const TIER_LABEL: Record<PublicReview['trust_tier'], string> = {
  verified_booking: 'Verified booking',
  verified_visit: 'Verified visit',
};

// Formatting for the public pages. Times are always Beirut time (Phase 2 §5), whatever the
// visitor's device says.

export const TZ = 'Asia/Beirut';

export function mediaUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base}/storage/v1/object/public/business-media/${path}`;
}

/** Published customer-result derivatives (M10): only ever ugc-public paths. */
export function ugcUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base}/storage/v1/object/public/ugc-public/${path}`;
}

const PHOTO_REASONS: Record<string, string> = {
  not_relevant: "It doesn't seem to show your {service}.",
  not_your_result: "It looks like a photo that isn't from your visit.",
  duplicate: 'You already shared this photo.',
  contact_info: 'It shows contact details or a QR code.',
  unsupported_file: "The file couldn't be opened.",
  too_small: 'The image is too small (at least 300 px).',
  upload_incomplete: "The upload didn't finish. Try again.",
};

/** Why a photo wasn't published — the same wording as the WhatsApp message, never safety details. */
export function photoReasonText(code: string | null | undefined, service: string): string {
  return (PHOTO_REASONS[code ?? ''] ?? "It doesn't follow our photo guidelines.").replace(
    '{service}',
    service || 'service',
  );
}

export function money(v: number | null | undefined, currency = 'USD') {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  const s = n % 1 ? n.toFixed(2) : String(n);
  return currency === 'USD' ? `$${s}` : `${s} ${currency}`;
}

export function priceText(p: {
  price_type: PriceType;
  price_min: number | null;
  price_max: number | null;
  currency?: string;
}) {
  switch (p.price_type) {
    case 'from':
      return `from ${money(p.price_min, p.currency)}`;
    case 'range':
      return `${money(p.price_min, p.currency)}–${money(p.price_max, p.currency)}`;
    case 'on_consultation':
      return 'Price on consultation';
    default:
      return money(p.price_min, p.currency);
  }
}

export function durationText(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const timeText = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(
    new Date(iso),
  );

export const dayText = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  }).format(new Date(iso));

export const dateTimeText = (iso: string) => `${dayText(iso)}, ${timeText(iso)}`;

/** "Today", "Tomorrow" or "Thu 3 Oct" for a Beirut date (YYYY-MM-DD). */
export function relativeDay(date: string, today: string) {
  const diff = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

export function clockText(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export const WEEKDAY = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** "Open now · until 8:00 PM" / "Closed · opens Tue 9:00 AM" from weekly hours (Beirut). */
export function openState(
  hours: BusinessPage['hours'],
  nowIso: string,
): { open: boolean; text: string } {
  const now = beirutParts(nowIso);
  const today = hours.filter((h) => h.weekday === now.isoWeekday).sort((a, b) => a.start - b.start);
  const current = today.find((h) => h.start <= now.minutes && now.minutes < h.end);
  if (current)
    return {
      open: true,
      text: `Open now · until ${clockText(current.end >= 1440 ? 1439 : current.end)}`,
    };
  const laterToday = today.find((h) => h.start > now.minutes);
  if (laterToday) return { open: false, text: `Closed · opens ${clockText(laterToday.start)}` };
  for (let i = 1; i <= 7; i++) {
    const wd = ((now.isoWeekday - 1 + i) % 7) + 1;
    const first = hours.filter((h) => h.weekday === wd).sort((a, b) => a.start - b.start)[0];
    if (first)
      return {
        open: false,
        text: `Closed · opens ${i === 1 ? 'tomorrow' : WEEKDAY[wd]!.slice(0, 3)} ${clockText(first.start)}`,
      };
  }
  return { open: false, text: 'Closed' };
}

export const waLink = (phone: string | null | undefined, text?: string) =>
  phone
    ? `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`
    : null;

export const mapsLink = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export const AUDIENCE: Record<string, string> = {
  women: 'Women',
  men: 'Men',
  everyone: 'Everyone',
};
