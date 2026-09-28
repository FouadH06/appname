import type { WeekHours } from './time';

// All appointment times are Asia/Beirut (Phase 2 §5 "Time"); a traveler's device timezone never
// shifts them. These helpers convert between Beirut wall time and UTC instants.

export const TZ = 'Asia/Beirut';

function offsetMinutes(atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(atUtcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
  return Math.round((asUtc - Math.floor(atUtcMs / 60000) * 60000) / 60000);
}

/** Beirut wall time ("2026-10-12", minutes since midnight) → UTC ISO string. DST-safe. */
export function beirutToUtc(date: string, minutes: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = naive - offsetMinutes(naive) * 60000;
  guess = naive - offsetMinutes(guess) * 60000; // second pass settles DST edges
  return new Date(guess).toISOString();
}

export interface BeirutParts {
  date: string;
  isoWeekday: number;
  minutes: number;
}

export function beirutParts(iso: string): BeirutParts {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(iso));
  const v = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(v('weekday')) + 1;
  return {
    date: `${v('year')}-${v('month')}-${v('day')}`,
    isoWeekday: wd,
    minutes: Number(v('hour')) * 60 + Number(v('minute')),
  };
}

/** Beirut dates from `start` (YYYY-MM-DD) for n days. */
export function beirutDays(start: string, n: number): { date: string; isoWeekday: number }[] {
  const out: { date: string; isoWeekday: number }[] = [];
  const base = new Date(`${start}T12:00:00Z`).getTime();
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    out.push({ date, isoWeekday: ((d.getUTCDay() + 6) % 7) + 1 });
  }
  return out;
}

export interface StaffBooking {
  booking_id: string;
  ref: string;
  status: string;
  starts_at: string;
  ends_at: string;
}

/** Future bookings that would fall outside the new weekly hours (days with a date override are skipped). */
export function outsideWeek(
  bookings: StaffBooking[],
  week: WeekHours,
  overrideDates: Set<string>,
): StaffBooking[] {
  return bookings.filter((b) => {
    const s = beirutParts(b.starts_at);
    const e = beirutParts(b.ends_at);
    if (overrideDates.has(s.date)) return false;
    const endMin = e.date === s.date ? e.minutes : 1440;
    return !(week[s.isoWeekday] ?? []).some((iv) => iv.start <= s.minutes && endMin <= iv.end);
  });
}

/** Future bookings overlapping a time-off period. */
export function overlapping(
  bookings: StaffBooking[],
  fromIso: string,
  toIso: string,
): StaffBooking[] {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return bookings.filter((b) => Date.parse(b.starts_at) < to && Date.parse(b.ends_at) > from);
}

export const fmtBeirut = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso));
