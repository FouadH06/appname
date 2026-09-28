import { describe, expect, it } from 'vitest';
import {
  beirutDays,
  beirutParts,
  beirutToUtc,
  outsideWeek,
  overlapping,
  type StaffBooking,
} from './schedule';

const b = (id: string, start: string, end: string): StaffBooking => ({
  booking_id: id,
  ref: id,
  status: 'confirmed',
  starts_at: start,
  ends_at: end,
});

describe('Beirut time', () => {
  it('converts wall time to UTC in winter (+2) and summer (+3)', () => {
    expect(beirutToUtc('2027-01-15', 9 * 60)).toBe('2027-01-15T07:00:00.000Z');
    expect(beirutToUtc('2027-07-15', 9 * 60)).toBe('2027-07-15T06:00:00.000Z');
  });

  it('reads Beirut parts from an instant', () => {
    expect(beirutParts('2027-07-15T06:30:00Z')).toEqual({
      date: '2027-07-15',
      isoWeekday: 4,
      minutes: 570,
    });
  });

  it('lists days with ISO weekdays', () => {
    expect(beirutDays('2027-07-12', 2)).toEqual([
      { date: '2027-07-12', isoWeekday: 1 },
      { date: '2027-07-13', isoWeekday: 2 },
    ]);
  });
});

describe('booking conflicts', () => {
  // Thursday 15 July 2027, 09:30–10:00 Beirut
  const thursday = b('A', '2027-07-15T06:30:00Z', '2027-07-15T07:00:00Z');

  it('flags bookings outside new weekly hours, except on override days', () => {
    const week = { 1: [], 2: [], 3: [], 4: [{ start: 600, end: 1080 }], 5: [], 6: [], 7: [] };
    expect(outsideWeek([thursday], week, new Set()).map((x) => x.ref)).toEqual(['A']);
    expect(outsideWeek([thursday], week, new Set(['2027-07-15']))).toEqual([]);
    expect(outsideWeek([thursday], { ...week, 4: [{ start: 540, end: 1080 }] }, new Set())).toEqual(
      [],
    );
  });

  it('finds bookings overlapping time off', () => {
    expect(overlapping([thursday], '2027-07-15T07:00:00Z', '2027-07-16T00:00:00Z')).toEqual([]);
    expect(overlapping([thursday], '2027-07-15T06:45:00Z', '2027-07-16T00:00:00Z')).toHaveLength(1);
  });
});
