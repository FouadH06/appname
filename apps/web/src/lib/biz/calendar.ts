import type { BookingCard } from './bookings';
import { beirutParts, beirutToUtc } from './schedule';

// Calendar model + pure layout helpers (Phase 2 B3). Everything is positioned by real elapsed
// minutes from the start of the Beirut day, so DST days render with 23 or 25 hours.

export interface CalTimeOff {
  id: string;
  start: string;
  end: string;
  kind: 'vacation' | 'sick' | 'personal' | 'training' | 'other';
  reason: string | null;
}

export interface CalStaff {
  id: string;
  display_name: string;
  role_title: string | null;
  status: 'active' | 'archived';
  publicly_bookable: boolean;
  working: [string, string][];
  time_off: CalTimeOff[];
}

export interface Calendar {
  timezone: string;
  role: 'owner' | 'manager' | 'reception' | 'staff';
  my_staff_id: string | null;
  staff: CalStaff[];
  items: BookingCard[];
}

export type CalView = 'columns' | 'single' | 'week' | 'agenda';

export const VIEW_LABEL: Record<CalView, string> = {
  columns: 'Day · Columns',
  single: 'Day · Single',
  week: 'Week',
  agenda: 'Agenda',
};

export const TIME_OFF_LABEL: Record<CalTimeOff['kind'], string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Blocked',
  training: 'Training',
  other: 'Blocked',
};

/** YYYY-MM-DD ± n days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -wd);
}

export interface DayFrame {
  date: string;
  startIso: string;
  endIso: string;
  /** Real length of the day in minutes (1380 / 1440 / 1500 on DST days) */
  length: number;
}

export function dayFrame(date: string): DayFrame {
  const startIso = beirutToUtc(date, 0);
  const endIso = beirutToUtc(addDays(date, 1), 0);
  return { date, startIso, endIso, length: (Date.parse(endIso) - Date.parse(startIso)) / 60000 };
}

/** Elapsed minutes from the start of the day, clamped to the day. */
export function offsetIn(frame: DayFrame, iso: string): number {
  const m = (Date.parse(iso) - Date.parse(frame.startIso)) / 60000;
  return Math.max(0, Math.min(frame.length, m));
}

export function isoAt(frame: DayFrame, offset: number): string {
  return new Date(Date.parse(frame.startIso) + offset * 60000).toISOString();
}

export const overlapsDay = (frame: DayFrame, startIso: string, endIso: string) =>
  Date.parse(startIso) < Date.parse(frame.endIso) &&
  Date.parse(endIso) > Date.parse(frame.startIso);

/**
 * Hour rows for a day between two offsets, labelled with the Beirut wall-clock time. On the
 * spring-forward day 00:00 is followed by 02:00; on the fall-back day 00:00 appears twice.
 */
export function hourMarks(
  frame: DayFrame,
  from: number,
  to: number,
): { offset: number; label: string }[] {
  const out: { offset: number; label: string }[] = [];
  for (let m = Math.ceil(from / 60) * 60; m < to; m += 60) {
    const p = beirutParts(isoAt(frame, m));
    out.push({ offset: m, label: clock(p.minutes) });
  }
  return out;
}

export function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}` : `${h12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "4:30 PM" in Beirut time. */
export function timeLabel(iso: string): string {
  const m = beirutParts(iso).minutes;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Visible range of the grid: working time and bookings of the day, padded, at least 9–19. */
export function visibleRange(frame: DayFrame, cal: Calendar): { from: number; to: number } {
  let from = 9 * 60;
  let to = 19 * 60;
  const take = (s: string, e: string) => {
    if (!overlapsDay(frame, s, e)) return;
    from = Math.min(from, offsetIn(frame, s));
    to = Math.max(to, offsetIn(frame, e));
  };
  for (const s of cal.staff) for (const [a, b] of s.working) take(a, b);
  for (const i of cal.items) take(i.starts_at, i.ends_at);
  return {
    from: Math.max(0, Math.floor(from / 60) * 60 - 60),
    to: Math.min(frame.length, Math.ceil(to / 60) * 60 + 60),
  };
}

export interface Placed<T> {
  item: T;
  lane: number;
  lanes: number;
}

/**
 * Side-by-side lanes for overlapping blocks in one column (a cancelled booking under a new
 * one, a walk-in squeezed next to a no-show). Greedy interval partitioning per overlap cluster.
 */
export function placeLanes<T extends { starts_at: string; ends_at: string }>(
  items: T[],
): Placed<T>[] {
  const sorted = [...items].sort(
    (a, b) =>
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      Date.parse(b.ends_at) - Date.parse(a.ends_at),
  );
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const s = Date.parse(item.starts_at);
    const e = Date.parse(item.ends_at);
    if (s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    cluster.push({ item, lane, lanes: 0 });
    clusterEnd = Math.max(clusterEnd === -Infinity ? e : clusterEnd, e);
  }
  flush();
  return out;
}

/** Non-working stretches of [from, to] for one staff member on one day (hatched in the grid). */
export function offShift(frame: DayFrame, working: [string, string][], from: number, to: number) {
  const on = working
    .filter(([a, b]) => overlapsDay(frame, a, b))
    .map(([a, b]) => [offsetIn(frame, a), offsetIn(frame, b)] as const)
    .sort((x, y) => x[0] - y[0]);
  const gaps: [number, number][] = [];
  let cur = from;
  for (const [a, b] of on) {
    if (a > cur) gaps.push([cur, Math.min(a, to)]);
    cur = Math.max(cur, b);
  }
  if (cur < to) gaps.push([cur, to]);
  return gaps.filter(([a, b]) => b > a);
}

/** "10:00–19:00 · break 14:00–15:00" for a column header. */
export function hoursSummary(frame: DayFrame, working: [string, string][]): string {
  const on = working
    .filter(([a, b]) => overlapsDay(frame, a, b))
    .sort((x, y) => Date.parse(x[0]) - Date.parse(y[0]));
  if (!on.length) return 'Off today';
  const t = (iso: string) => clock(beirutParts(iso).minutes);
  const main = `${t(on[0]![0])}–${t(on[on.length - 1]![1])}`;
  const breaks = on.slice(1).map((iv, i) => `${t(on[i]![1])}–${t(iv[0])}`);
  return breaks.length ? `${main} · break ${breaks.join(', ')}` : main;
}

/** Booked share of a staff member's working minutes that day (0–100). */
export function bookedPercent(
  frame: DayFrame,
  staff: CalStaff,
  items: BookingCard[],
): number | null {
  const working = staff.working
    .filter(([a, b]) => overlapsDay(frame, a, b))
    .reduce((n, [a, b]) => n + offsetIn(frame, b) - offsetIn(frame, a), 0);
  if (!working) return null;
  const booked = items
    .filter(
      (i) => i.staff_id === staff.id && blocksTime(i) && overlapsDay(frame, i.starts_at, i.ends_at),
    )
    .reduce((n, i) => n + offsetIn(frame, i.ends_at) - offsetIn(frame, i.starts_at), 0);
  return Math.min(100, Math.round((booked / working) * 100));
}

export const blocksTime = (i: Pick<BookingCard, 'status'>) =>
  i.status === 'held' ||
  i.status === 'pending' ||
  i.status === 'confirmed' ||
  i.status === 'completed';

/**
 * Free-typed time → minutes since midnight: "16:30", "4.30", "430", "1630", "4:30pm", "4 pm".
 * A bare hour 1–7 without am/pm means the afternoon (salons don't open at 4 AM).
 */
export function parseTime(raw: string): number | null {
  const v = raw.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/.exec(v);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith('p') && h !== 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
  } else if (h >= 1 && h <= 7 && !m[1]!.startsWith('0')) h += 12;
  if (h > 23) return null;
  return h * 60 + min;
}

/** Now rounded down to 5 minutes, as Beirut date + minutes (walk-in start). */
export function walkInStart(nowMs = Date.now()): { date: string; minutes: number } {
  const p = beirutParts(new Date(nowMs).toISOString());
  return { date: p.date, minutes: p.minutes - (p.minutes % 5) };
}

export const reliabilityHint = (r: string | null | undefined) =>
  r === 'some_missed_appointments'
    ? 'Some missed appointments'
    : r === 'reliable'
      ? 'Reliable'
      : null;
