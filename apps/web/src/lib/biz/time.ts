// Minutes since midnight <-> "HH:MM", weekday names (ISO 1 = Monday … 7 = Sunday).

export const WEEKDAYS = [
  { iso: 1, short: 'Mon', long: 'Monday' },
  { iso: 2, short: 'Tue', long: 'Tuesday' },
  { iso: 3, short: 'Wed', long: 'Wednesday' },
  { iso: 4, short: 'Thu', long: 'Thursday' },
  { iso: 5, short: 'Fri', long: 'Friday' },
  { iso: 6, short: 'Sat', long: 'Saturday' },
  { iso: 7, short: 'Sun', long: 'Sunday' },
] as const;

export interface Interval {
  start: number;
  end: number;
}
export type WeekHours = Record<number, Interval[]>;

export const toHHMM = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function fromHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** 12-hour label used across the UI (Phase 2: "4:30 PM"). */
export function label12(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`;
}

export const emptyWeek = (): WeekHours => ({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] });

/** Common default for salons: Mon–Sat 9:00–19:00, Sunday closed. */
export const defaultWeek = (): WeekHours => ({
  1: [{ start: 540, end: 1140 }],
  2: [{ start: 540, end: 1140 }],
  3: [{ start: 540, end: 1140 }],
  4: [{ start: 540, end: 1140 }],
  5: [{ start: 540, end: 1140 }],
  6: [{ start: 540, end: 1140 }],
  7: [],
});

/** Validation shared by location and staff hours: end after start, no overlaps within a day. */
export function weekErrors(week: WeekHours): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const d of WEEKDAYS) {
    const list = [...(week[d.iso] ?? [])].sort((a, b) => a.start - b.start);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i]!;
      if (cur.end <= cur.start) errors[d.iso] = 'End must be after start';
      const next = list[i + 1];
      if (next && next.start < cur.end) errors[d.iso] = 'Shifts overlap';
    }
  }
  return errors;
}

export function rowsToWeek(
  rows: { iso_weekday: number; start_minute: number; end_minute: number }[],
): WeekHours {
  const w = emptyWeek();
  for (const r of rows) w[r.iso_weekday]!.push({ start: r.start_minute, end: r.end_minute });
  for (const d of WEEKDAYS) w[d.iso]!.sort((a, b) => a.start - b.start);
  return w;
}

export function weekToRows(week: WeekHours) {
  return WEEKDAYS.flatMap((d) =>
    (week[d.iso] ?? []).map((i) => ({
      iso_weekday: d.iso,
      start_minute: i.start,
      end_minute: i.end,
    })),
  );
}
