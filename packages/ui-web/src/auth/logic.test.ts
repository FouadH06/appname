import { describe, expect, it } from 'vitest';
import { flowReducer, initialFlow, sanitizeOtp, secondsLeft } from './logic';

describe('sanitizeOtp', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['Your code: 482913', '482913'],
    ['١٢٣٤٥٦', '123456'],
    ['۱۲۳۴۵۶', '123456'],
    ['12345678', '123456'],
  ])('%s → %s', (input, out) => {
    expect(sanitizeOtp(input)).toBe(out);
  });
});

describe('flowReducer', () => {
  it('phone → code (WhatsApp) → resend by SMS → done', () => {
    let s = flowReducer(initialFlow, { type: 'send', phone: '+96170123456' });
    expect(s).toMatchObject({ busy: true, phone: '+96170123456', step: 'phone' });
    s = flowReducer(s, { type: 'sent' });
    expect(s).toMatchObject({ step: 'code', channel: 'whatsapp', sends: 1, busy: false });
    s = flowReducer(flowReducer(s, { type: 'resend' }), { type: 'resent', channel: 'sms' });
    expect(s).toMatchObject({ channel: 'sms', sends: 2 });
    s = flowReducer(flowReducer(s, { type: 'verify' }), { type: 'verified' });
    expect(s.step).toBe('done');
  });

  it('keeps the step on failure and resets on change number', () => {
    const s = flowReducer(
      { ...initialFlow, step: 'code', busy: true },
      { type: 'failed', error: 'x' },
    );
    expect(s).toMatchObject({ step: 'code', busy: false, error: 'x' });
    expect(flowReducer(s, { type: 'change_number' })).toEqual(initialFlow);
  });
});

describe('secondsLeft', () => {
  it('counts down 30 s and never goes negative', () => {
    expect(secondsLeft(0, 0)).toBe(30);
    expect(secondsLeft(0, 29_100)).toBe(1);
    expect(secondsLeft(0, 45_000)).toBe(0);
  });
});
