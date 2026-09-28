import { describe, expect, it } from 'vitest';
import { defaultWeek, fromHHMM, label12, rowsToWeek, toHHMM, weekErrors, weekToRows } from './time';

describe('time helpers', () => {
  it('converts minutes and HH:MM', () => {
    expect(toHHMM(570)).toBe('09:30');
    expect(fromHHMM('9:30')).toBe(570);
    expect(fromHHMM('24:00')).toBe(1440);
    expect(fromHHMM('25:00')).toBeNull();
    expect(label12(990)).toBe('4:30 PM');
    expect(label12(0)).toBe('12:00 AM');
  });

  it('round-trips rows and validates overlaps / inverted intervals', () => {
    const rows = weekToRows(defaultWeek());
    expect(rows).toHaveLength(6);
    expect(rowsToWeek(rows)).toEqual(defaultWeek());
    expect(weekErrors({ ...defaultWeek(), 1: [{ start: 600, end: 540 }] })[1]).toBe(
      'End must be after start',
    );
    expect(
      weekErrors({
        ...defaultWeek(),
        2: [
          { start: 540, end: 800 },
          { start: 780, end: 900 },
        ],
      })[2],
    ).toBe('Shifts overlap');
    expect(weekErrors(defaultWeek())).toEqual({});
  });
});
