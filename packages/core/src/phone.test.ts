import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeDigits, parsePhone, toE164 } from './phone';

describe('toE164 (same rules as private.normalize_phone)', () => {
  it.each([
    ['03 123 456', '+9613123456'],
    ['3123456', '+9613123456'],
    ['70123456', '+96170123456'],
    ['+961 70 123 456', '+96170123456'],
    ['0096170123456', '+96170123456'],
    ['(71) 12-34-56', '+96171123456'],
    ['٠٣١٢٣٤٥٦', '+9613123456'],
    ['+33 6 12 34 56 78', '+33612345678'],
  ])('%s → %s', (raw, expected) => {
    expect(toE164(raw)).toBe(expected);
  });

  it.each(['', 'hello', '123', '+0123456789'])('rejects %s', (raw) => {
    expect(toE164(raw)).toBeNull();
  });
});

describe('parsePhone', () => {
  it('recognizes Lebanese mobiles and formats them', () => {
    const r = parsePhone('03123456');
    expect(r).toEqual({
      ok: true,
      phone: {
        e164: '+9613123456',
        kind: 'lb_mobile',
        display: '+961 3 123 456',
        canReceiveOtp: true,
      },
    });
    const r2 = parsePhone('81 234 567');
    expect(r2.ok && r2.phone.display).toBe('+961 81 234 567');
  });

  it('accepts landlines but marks them unable to receive a code', () => {
    const r = parsePhone('01 234 567');
    expect(r.ok && r.phone.kind).toBe('lb_landline');
    expect(r.ok && r.phone.canReceiveOtp).toBe(false);
  });

  it('rejects numbers that are not valid Lebanese numbers', () => {
    expect(parsePhone('+961 72 123 456')).toEqual({ ok: false, error: 'lb_invalid' });
    expect(parsePhone('+961 3 12')).toEqual({ ok: false, error: 'invalid' });
    expect(parsePhone('  ')).toEqual({ ok: false, error: 'empty' });
  });

  it('allows international numbers (diaspora)', () => {
    const r = parsePhone('+1 415 555 2671');
    expect(r.ok && r.phone.kind).toBe('international');
    expect(r.ok && r.phone.canReceiveOtp).toBe(true);
  });
});

describe('helpers', () => {
  it('normalizes Arabic-Indic and Persian digits', () => {
    expect(normalizeDigits('٧٠١٢٣ ۴۵۶')).toBe('70123 456');
  });

  it('masks like the server', () => {
    expect(maskPhone('+96170123456')).toBe('+961 70 ••• 456');
    expect(maskPhone('+33612345678')).toBe('+336 ••• 678');
  });
});
