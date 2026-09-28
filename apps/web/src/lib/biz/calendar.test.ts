import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayFrame,
  hourMarks,
  offShift,
  offsetIn,
  parseTime,
  placeLanes,
  weekStart,
} from './calendar';
import { beirutToUtc } from './schedule';

describe('calendar layout', () => {
  it('day length follows Beirut DST (spring forward 23 h, fall back 25 h)', () => {
    expect(dayFrame('2026-10-12').length).toBe(1440);
    expect(dayFrame('2026-03-29').length).toBe(1380);
    expect(dayFrame('2026-10-24').length).toBe(1500);
  });

  it('positions by elapsed minutes and labels the skipped / repeated hour', () => {
    const spring = dayFrame('2026-03-29');
    // Lebanon skips 00:00–01:00: the day starts at 1 AM, so 10:00 is 9 elapsed hours in
    expect(offsetIn(spring, beirutToUtc('2026-03-29', 600))).toBe(540);
    expect(hourMarks(spring, 0, 180).map((h) => h.label)).toEqual(['1 AM', '2 AM', '3 AM']);
    const fall = dayFrame('2026-10-24');
    expect(hourMarks(fall, 1380, 1500).map((h) => h.label)).toEqual(['11 PM', '11 PM']);
  });

  it('week starts on Monday; day arithmetic crosses months', () => {
    expect(weekStart('2026-10-15')).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('puts overlapping blocks side by side, others full width', () => {
    const b = (s: number, e: number) => ({
      starts_at: beirutToUtc('2026-10-12', s),
      ends_at: beirutToUtc('2026-10-12', e),
    });
    const placed = placeLanes([b(600, 660), b(630, 690), b(720, 750)]);
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
  });

  it('hatches non-working time around shifts and breaks', () => {
    const f = dayFrame('2026-10-12');
    const w: [string, string][] = [
      [beirutToUtc('2026-10-12', 600), beirutToUtc('2026-10-12', 840)],
      [beirutToUtc('2026-10-12', 900), beirutToUtc('2026-10-12', 1140)],
    ];
    expect(offShift(f, w, 480, 1200)).toEqual([
      [480, 600],
      [840, 900],
      [1140, 1200],
    ]);
  });

  it('reads free-typed times the way reception types them', () => {
    expect(parseTime('16:30')).toBe(990);
    expect(parseTime('4.30')).toBe(990);
    expect(parseTime('430')).toBe(990);
    expect(parseTime('4:30 pm')).toBe(990);
    expect(parseTime('10')).toBe(600);
    expect(parseTime('09:15')).toBe(555);
    expect(parseTime('12am')).toBe(0);
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});
