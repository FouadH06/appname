import { describe, expect, it, vi } from 'vitest';
import {
  LogChannel,
  TwilioSmsChannel,
  WhatsAppChannel,
  smsBody,
} from '../../../supabase/functions/_shared/otp/channels.ts';
import {
  localeFromUser,
  otpConfigFromEnv,
} from '../../../supabase/functions/_shared/otp/config.ts';
import { deliverOtp } from '../../../supabase/functions/_shared/otp/router.ts';
import type {
  ChannelKind,
  OtpChannel,
  OtpStore,
  RouteDecision,
  SendResult,
} from '../../../supabase/functions/_shared/otp/types.ts';

const msg = { phone: '+96170123456', otp: '482913', locale: 'en' as const };

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('WhatsAppChannel', () => {
  const cfg = {
    accessToken: 'wa-token',
    phoneNumberId: '1098',
    template: 'otp_code',
    languages: { en: 'en', ar: 'ar' },
    graphVersion: 'v21.0',
  };

  it('sends the authentication template with the code in body and copy-code button', async () => {
    const f = fakeFetch(200, { messages: [{ id: 'wamid.ABC' }] });
    const res = await new WhatsAppChannel(cfg, f).send({ ...msg, locale: 'ar' });
    expect(res).toEqual({ ok: true, messageId: 'wamid.ABC' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v21.0/1098/messages');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer wa-token');
    const sent = JSON.parse(init!.body as string);
    expect(sent.to).toBe('96170123456');
    expect(sent.template.name).toBe('otp_code');
    expect(sent.template.language.code).toBe('ar');
    expect(sent.template.components[0].parameters[0].text).toBe('482913');
    expect(sent.template.components[1]).toMatchObject({ type: 'button', sub_type: 'url' });
    expect(sent.template.components[1].parameters[0].text).toBe('482913');
  });

  it('reports API errors; 5xx/429 are retryable, 4xx are not', async () => {
    const bad = await new WhatsAppChannel(
      cfg,
      fakeFetch(400, { error: { code: 131026, message: 'undeliverable' } }),
    ).send(msg);
    expect(bad).toMatchObject({ ok: false, retryable: false });
    expect(bad.ok === false && bad.error).toContain('131026');
    const busy = await new WhatsAppChannel(cfg, fakeFetch(503, {})).send(msg);
    expect(busy).toMatchObject({ ok: false, retryable: true });
  });

  it('treats network errors as retryable failures', async () => {
    const f = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('network down')));
    expect(await new WhatsAppChannel(cfg, f).send(msg)).toMatchObject({
      ok: false,
      retryable: true,
    });
  });
});

describe('TwilioSmsChannel', () => {
  const cfg = {
    accountSid: 'AC123',
    authToken: 'tok',
    messagingServiceSid: 'MG1',
    statusCallbackUrl: 'https://x.supabase.co/functions/v1/twilio-status',
    webOtpDomain: 'app.example',
    brand: 'APP_NAME',
  };

  it('posts a form with messaging service, status callback and Web OTP line', async () => {
    const f = fakeFetch(201, { sid: 'SM999' });
    expect(await new TwilioSmsChannel(cfg, f).send(msg)).toEqual({ ok: true, messageId: 'SM999' });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      'Basic ' + btoa('AC123:tok'),
    );
    const form = new URLSearchParams(init!.body as string);
    expect(form.get('To')).toBe('+96170123456');
    expect(form.get('MessagingServiceSid')).toBe('MG1');
    expect(form.get('From')).toBeNull();
    expect(form.get('StatusCallback')).toBe(cfg.statusCallbackUrl);
    expect(form.get('Body')).toMatch(/482913[\s\S]*@app\.example #482913$/);
  });

  it('uses a sender number when no messaging service is set', async () => {
    const f = fakeFetch(201, { sid: 'SM1' });
    await new TwilioSmsChannel(
      { ...cfg, messagingServiceSid: undefined, from: '+15550001111' },
      f,
    ).send(msg);
    expect(new URLSearchParams(f.mock.calls[0]![1]!.body as string).get('From')).toBe(
      '+15550001111',
    );
  });

  it('localizes the SMS text', () => {
    expect(smsBody({ ...msg, locale: 'ar' }, 'APP_NAME')).toContain('482913');
    expect(smsBody({ ...msg, locale: 'ar' }, 'APP_NAME')).toMatch(/[؀-ۿ]/);
    expect(smsBody({ ...msg, locale: 'fr' }, 'APP_NAME')).toContain('Votre code');
  });
});

// ─── router ────────────────────────────────────────────────────────────────
function store(decisions: RouteDecision[]) {
  const marks: unknown[][] = [];
  const routes: (ChannelKind | null)[] = [];
  const s: OtpStore = {
    route: (_p, _x, force) => {
      routes.push(force);
      return Promise.resolve(decisions.shift()!);
    },
    mark: (...args) => {
      marks.push(args);
      return Promise.resolve();
    },
  };
  return { s, marks, routes };
}

const channel = (kind: ChannelKind, result: SendResult, provider: string = kind): OtpChannel => ({
  kind,
  provider,
  send: vi.fn(() => Promise.resolve(result)),
});

const allow = (channel: ChannelKind, id: string, smsAvailable = true): RouteDecision => ({
  allowed: true,
  channel,
  delivery_id: id,
  phone: '+96170123456',
  sms_available: smsAvailable,
});

describe('deliverOtp routing', () => {
  it('sends by WhatsApp when the database chooses it', async () => {
    const { s, marks } = store([allow('whatsapp', 'd1')]);
    const wa = channel('whatsapp', { ok: true, messageId: 'wamid.1' });
    const out = await deliverOtp(msg, {
      store: s,
      channels: { whatsapp: wa },
      smsPrefixes: ['+961'],
    });
    expect(out).toEqual({ ok: true, channel: 'whatsapp', provider: 'whatsapp', fellBack: false });
    expect(marks).toEqual([['d1', 'sent', 'whatsapp', 'wamid.1', null]]);
  });

  it('falls back to SMS in the same request when WhatsApp fails', async () => {
    const { s, marks, routes } = store([allow('whatsapp', 'd1'), allow('sms', 'd2')]);
    const out = await deliverOtp(msg, {
      store: s,
      channels: {
        whatsapp: channel('whatsapp', { ok: false, error: 'down', retryable: true }),
        sms: channel('sms', { ok: true, messageId: 'SM1' }, 'twilio'),
      },
      smsPrefixes: ['+961'],
    });
    expect(out).toEqual({ ok: true, channel: 'sms', provider: 'twilio', fellBack: true });
    expect(routes).toEqual([null, 'sms']);
    expect(marks).toEqual([
      ['d1', 'failed', 'whatsapp', null, 'down'],
      ['d2', 'sent', 'twilio', 'SM1', null],
    ]);
  });

  it('goes straight to SMS while WhatsApp is not configured', async () => {
    const { s, marks } = store([allow('whatsapp', 'd1'), allow('sms', 'd2')]);
    const out = await deliverOtp(msg, {
      store: s,
      channels: { sms: channel('sms', { ok: true, messageId: 'SM1' }, 'twilio') },
      smsPrefixes: ['+961'],
    });
    expect(out).toMatchObject({ ok: true, channel: 'sms' });
    expect(marks[0]).toEqual(['d1', 'failed', 'whatsapp', null, 'channel_not_configured']);
  });

  it('uses SMS when the database routes the retry to SMS ("Send by SMS instead")', async () => {
    const { s } = store([allow('sms', 'd9')]);
    const sms = channel('sms', { ok: true, messageId: 'SM2' }, 'twilio');
    const out = await deliverOtp(msg, { store: s, channels: { sms }, smsPrefixes: ['+961'] });
    expect(out).toMatchObject({ ok: true, channel: 'sms', fellBack: false });
  });

  it('does not fall back for numbers without SMS (foreign), and reports failure', async () => {
    const { s, routes } = store([allow('whatsapp', 'd1', false)]);
    const out = await deliverOtp(msg, {
      store: s,
      channels: { whatsapp: channel('whatsapp', { ok: false, error: 'x', retryable: false }) },
      smsPrefixes: ['+961'],
    });
    expect(out).toEqual({ ok: false, httpStatus: 502, code: 'OTP_DELIVERY_FAILED' });
    expect(routes).toEqual([null]);
  });

  it('maps database refusals to HTTP codes', async () => {
    const { s } = store([{ allowed: false, reason: 'OTP_TOO_MANY' }]);
    expect(await deliverOtp(msg, { store: s, channels: {}, smsPrefixes: [] })).toEqual({
      ok: false,
      httpStatus: 429,
      code: 'OTP_TOO_MANY',
    });
  });
});

describe('otpConfigFromEnv', () => {
  const envOf = (vars: Record<string, string>) => (k: string) => vars[k];

  it('log mode prints codes on both channels', async () => {
    const cfg = otpConfigFromEnv(envOf({ OTP_PROVIDER_MODE: 'log' }));
    expect(cfg.mode).toBe('log');
    expect(cfg.channels.whatsapp).toBeInstanceOf(LogChannel);
    const lines: string[] = [];
    await new LogChannel('sms', (l) => lines.push(l)).send(msg);
    expect(lines[0]).toContain('482913');
  });

  it('live mode builds only the configured providers; SMS prefixes default to +961', () => {
    const cfg = otpConfigFromEnv(
      envOf({ TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+1555' }),
    );
    expect(cfg.mode).toBe('live');
    expect(cfg.channels.whatsapp).toBeUndefined();
    expect(cfg.channels.sms).toBeInstanceOf(TwilioSmsChannel);
    expect(cfg.smsPrefixes).toEqual(['+961']);
  });

  it('parses SMS prefixes and ignores junk; builds WhatsApp when fully configured', () => {
    const cfg = otpConfigFromEnv(
      envOf({
        SMS_ALLOWED_PREFIXES: '+961, +33,abc,',
        WHATSAPP_ACCESS_TOKEN: 'a',
        WHATSAPP_PHONE_NUMBER_ID: 'b',
        WHATSAPP_OTP_TEMPLATE: 'c',
      }),
    );
    expect(cfg.smsPrefixes).toEqual(['+961', '+33']);
    expect(cfg.channels.whatsapp).toBeInstanceOf(WhatsAppChannel);
  });

  it('reads the message locale from user metadata', () => {
    expect(localeFromUser({ user_metadata: { locale: 'ar' } })).toBe('ar');
    expect(localeFromUser({ user_metadata: { locale: 'xx' } })).toBe('en');
    expect(localeFromUser(null)).toBe('en');
  });
});
