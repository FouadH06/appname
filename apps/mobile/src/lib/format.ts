import { messageForCode } from '@app/i18n';
import { ENV } from './supabase';

// Dates and times in the business's time zone (Asia/Beirut), never the device's.
export const TZ = 'Asia/Beirut';
export type PriceType = 'fixed' | 'from' | 'range' | 'on_consultation';

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

/** YYYY-MM-DD in Beirut, n days from today */
export function beirutDate(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
export const dateLabel = (ymd: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${ymd}T12:00:00Z`));

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
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m} min`;
}

export const ago = (iso: string) => {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export const mediaUrl = (path: string | null | undefined) =>
  path ? `${ENV.supabaseUrl}/storage/v1/object/public/business-media/${path}` : null;
export const ugcUrl = (path: string | null | undefined) =>
  path ? `${ENV.supabaseUrl}/storage/v1/object/public/ugc-public/${path}` : null;

/** Same copy as web (i18n catalogue); English-first UI. */
export const describeError = (code: string, vars: Record<string, string | number> = {}) =>
  messageForCode('en', code, vars);

export const LABELS: Record<string, string> = {
  top_rated: 'Top rated',
  available_today: 'Available today',
  top_cleanliness: 'Spotless',
  great_punctuality: 'On time',
  best_value: 'Great value',
  popular_near_you: 'Popular nearby',
  new: 'New on APP_NAME',
};
