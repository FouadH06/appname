import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleWhatsAppWebhook } from '../../../supabase/functions/_shared/handlers.ts';
import {
  LogSms,
  LogWhatsApp,
  TwilioTextSender,
  WhatsAppCloudSender,
} from '../../../supabase/functions/_shared/notify/channels.ts';
import {
  notifyConfigFromEnv,
  secretMatches,
} from '../../../supabase/functions/_shared/notify/config.ts';
import { runDispatch } from '../../../supabase/functions/_shared/notify/dispatch.ts';
import {
  templateButtons,
  fill,
  formatVars,
  replyText,
  whatsappParams,
} from '../../../supabase/functions/_shared/notify/render.ts';
import type {
  Claimed,
  NotifyStore,
  SendResult,
  SmsSender,
  Template,
  WhatsAppSender,
} from '../../../supabase/functions/_shared/notify/types.ts';

const payload = {
  booking_id: 'b-1',
  business_name: 'Fade District',
  service_name: 'Haircut',
  staff_name: 'Karim',
  starts_at: '2026-10-12T13:30:00Z', // 16:30 in Beirut (UTC+3)
  timezone: 'Asia/Beirut',
  link: 'https://platform.com/m/tok',
  link_token: 'tok',
  business_slug: 'fade-district',
  business_url: 'https://platform.com/fade-district',
  dashboard_path: 'biz-1/bookings',
};

const tpl = (over: Partial<Template> = {}): Template => ({
  type: 'booking_reminder_24h',
  channel: 'whatsapp',
  locale: 'en',
  provider_template_name: 'booking_reminder_24h_v1',
  body: 'Reminder: {service_name} at {business_name} tomorrow at {time} with {staff_name}.',
  variables: ['service_name', 'business_name', 'time', 'staff_name'],
  buttons: ['confirm', 'cancel', 'view'],
  button_labels: ['Confirm', 'Cancel', 'View booking'],
  status: 'approved',
  ...over,
});

describe('render', () => {
  it('formats times in Beirut, per locale', () => {
    const en = formatVars(payload, 'en');
    expect(en.time).toBe('4:30 PM');
    expect(en.date).toMatch(/Mon.*12.*Oct/);
    const ar = formatVars(payload, 'ar');
    expect(ar.time).not.toBe(en.time);
    expect(ar.date).not.toMatch(/Mon/);
    // Latin digits, Levantine month names
    expect(ar.date).toContain('12 تشرين الأول');
    expect(ar.time).toMatch(/^4:30/);
    expect(`${ar.date} ${ar.time}`).not.toMatch(/[٠-٩]/);
  });

  it('new-review team alert shows the star rating (M9)', () => {
    const vars = formatVars({ ...payload, rating: 2 }, 'en');
    expect(
      fill(
        '⭐ New {rating}-star review for {service_name} with {staff_name}. Reply from your dashboard.',
        vars,
      ),
    ).toBe('⭐ New 2-star review for Haircut with Karim. Reply from your dashboard.');
    expect(formatVars({ ...payload, rating: 5 }, 'ar').rating).toBe('5');
  });

  it('dispute messages say the outcome per audience, never internal notes (M11)', () => {
    const customer = formatVars(
      { ...payload, dispute_outcome: 'no_show_overturned', audience: 'customer' },
      'en',
    );
    expect(
      fill(
        'Update on your {service_name} booking at {business_name} on {date}: {dispute_result} Details are on your booking page.',
        customer,
      ),
    ).toContain('Haircut booking at Fade District on');
    expect(customer.dispute_result).toBe(
      'we reviewed your request and removed the no-show. Thanks for your patience.',
    );
    expect(
      formatVars({ ...payload, dispute_outcome: 'no_show_upheld', audience: 'business' }, 'en')
        .dispute_result,
    ).toBe('the no-show you marked stays on the booking.');
    expect(
      formatVars({ ...payload, dispute_outcome: 'awaiting_info', audience: 'customer' }, 'ar')
        .dispute_result,
    ).toContain('معلومات');
    // unknown outcome → the neutral "closed" sentence, never an empty WhatsApp parameter
    expect(formatVars({ ...payload, dispute_outcome: 'weird' }, 'en').dispute_result).toBe(
      'we closed the case without a penalty for either side.',
    );
  });

  it('leaves no gaps for missing values and gives WhatsApp non-empty parameters', () => {
    const vars = formatVars({ ...payload, reason: '' }, 'en');
    expect(
      fill("Sorry, {business_name} can't take it. {reason} Book again: {business_url}", vars),
    ).toBe(
      "Sorry, Fade District can't take it. We're sorry for the inconvenience. Book again: https://platform.com/fade-district",
    );
    expect(formatVars({ ...payload, reason: 'Closed for a wedding' }, 'en').reason).toBe(
      'Reason: Closed for a wedding.',
    );
    expect(formatVars({ ...payload, reason: 'مغلق' }, 'ar').reason).toBe('السبب: مغلق.');
    const t = tpl({ variables: ['service_name', 'old_date'] });
    expect(whatsappParams(t, vars)).toEqual(['Haircut', '—']);
    expect(templateButtons(tpl(), payload)).toEqual([
      { kind: 'quick_reply', payload: 'confirm:b-1' },
      { kind: 'quick_reply', payload: 'cancel:b-1' },
      { kind: 'url', text: 'tok' },
    ]);
    expect(templateButtons(tpl({ buttons: ['book', 'dashboard'] }), payload)).toEqual([
      { kind: 'url', text: 'fade-district' },
      { kind: 'url', text: 'biz-1/bookings' },
    ]);
  });

  it('replies to button taps in the customer language', () => {
    expect(replyText({ ...payload, reply: 'confirmed', locale: 'en' })).toBe(
      "Thanks! You're confirmed for Haircut at Fade District on " +
        formatVars(payload, 'en').date +
        ' at 4:30 PM.',
    );
    expect(replyText({ ...payload, reply: 'cancel_link', locale: 'ar' })).toContain(
      'https://platform.com/m/tok',
    );
    expect(replyText(null)).toBeNull();
    expect(replyText({ reply: 'unknown' })).toBeNull();
  });
});

function fakeStore(rows: Claimed[]) {
  let claimed = false;
  const store = {
    attempts: [] as { channel: string; provider: string; ok: boolean; error: string | null }[],
    finished: [] as { id: string; outcome: string; error: string | null }[],
    claim: vi.fn(async () => {
      if (claimed) return [];
      claimed = true;
      return rows;
    }),
    recordAttempt: vi.fn(
      async (
        _id: string,
        channel: string,
        provider: string,
        _m: string | null,
        ok: boolean,
        error: string | null,
      ) => {
        store.attempts.push({ channel, provider, ok, error });
      },
    ),
    finish: vi.fn(async (id: string, outcome: string, error: string | null) => {
      store.finished.push({ id, outcome, error });
    }),
  };
  return store;
}

const row = (over: Partial<Claimed> = {}): Claimed => ({
  id: 'n-1',
  type: 'booking_reminder_24h',
  locale: 'en',
  phone: '+96170123456',
  attempts: 1,
  critical: true,
  payload,
  channels: ['whatsapp', 'sms'],
  templates: {
    whatsapp: tpl(),
    sms: tpl({ channel: 'sms', provider_template_name: null, status: 'approved' }),
  },
  ...over,
});

const wa = (result: SendResult): WhatsAppSender & { sendTemplate: ReturnType<typeof vi.fn> } => ({
  provider: 'whatsapp',
  sendTemplate: vi.fn(async () => result),
  sendText: vi.fn(async () => result),
});
const sms = (result: SendResult): SmsSender & { sendText: ReturnType<typeof vi.fn> } => ({
  provider: 'twilio',
  sendText: vi.fn(async () => result),
});

describe('runDispatch', () => {
  it('sends by WhatsApp with the template parameters and Confirm / Cancel payloads', async () => {
    const store = fakeStore([row()]);
    const w = wa({ ok: true, messageId: 'wamid.1' });
    const s = sms({ ok: true, messageId: 'SM1' });
    const r = await runDispatch({
      store: store as unknown as NotifyStore,
      whatsapp: w,
      sms: s,
      mode: 'live',
    });
    expect(r).toEqual({ claimed: 1, sent: 1, retry: 0, failed: 0 });
    expect(w.sendTemplate).toHaveBeenCalledWith(
      '+96170123456',
      'booking_reminder_24h_v1',
      'en',
      ['Haircut', 'Fade District', '4:30 PM', 'Karim'],
      [
        { kind: 'quick_reply', payload: 'confirm:b-1' },
        { kind: 'quick_reply', payload: 'cancel:b-1' },
        { kind: 'url', text: 'tok' },
      ],
    );
    expect(s.sendText).not.toHaveBeenCalled();
    expect(store.finished).toEqual([{ id: 'n-1', outcome: 'sent', error: null }]);
  });

  it('falls back to SMS for a critical message when WhatsApp fails', async () => {
    const store = fakeStore([row()]);
    const s = sms({ ok: true, messageId: 'SM1' });
    await runDispatch({
      store: store as unknown as NotifyStore,
      whatsapp: wa({ ok: false, error: 'whatsapp 400 131026', retryable: false }),
      sms: s,
      mode: 'live',
    });
    expect(store.attempts.map((a) => [a.channel, a.ok])).toEqual([
      ['whatsapp', false],
      ['sms', true],
    ]);
    expect(s.sendText).toHaveBeenCalledWith(
      '+96170123456',
      'Reminder: Haircut at Fade District tomorrow at 4:30 PM with Karim.',
    );
    expect(store.finished[0]!.outcome).toBe('sent');
  });

  it('uses SMS while the WhatsApp template is not approved (live), and sends it anyway in log mode', async () => {
    const pending = row({
      templates: {
        whatsapp: tpl({ status: 'pending_approval' }),
        sms: tpl({ channel: 'sms', status: 'approved' }),
      },
    });
    const live = fakeStore([pending]);
    const w = wa({ ok: true, messageId: 'x' });
    await runDispatch({
      store: live as unknown as NotifyStore,
      whatsapp: w,
      sms: sms({ ok: true, messageId: 'SM2' }),
      mode: 'live',
    });
    expect(w.sendTemplate).not.toHaveBeenCalled();
    expect(live.attempts.map((a) => a.channel)).toEqual(['sms']);
    const log = fakeStore([pending]);
    await runDispatch({
      store: log as unknown as NotifyStore,
      whatsapp: new LogWhatsApp(() => {}),
      sms: new LogSms(() => {}),
      mode: 'log',
    });
    expect(log.attempts.map((a) => [a.channel, a.provider])).toEqual([['whatsapp', 'log']]);
  });

  it('retries temporary provider errors and fails permanent ones', async () => {
    const temp = fakeStore([row()]);
    await runDispatch({
      store: temp as unknown as NotifyStore,
      whatsapp: wa({ ok: false, error: 'whatsapp 503', retryable: true }),
      sms: sms({ ok: false, error: 'twilio 500', retryable: true }),
      mode: 'live',
    });
    expect(temp.finished[0]).toEqual({ id: 'n-1', outcome: 'retry', error: 'twilio 500' });
    const perm = fakeStore([row({ critical: false, channels: ['whatsapp'] })]);
    await runDispatch({
      store: perm as unknown as NotifyStore,
      whatsapp: wa({ ok: false, error: 'whatsapp 400', retryable: false }),
      mode: 'live',
    });
    expect(perm.finished[0]!.outcome).toBe('failed');
    const none = fakeStore([row({ channels: [] })]);
    await runDispatch({ store: none as unknown as NotifyStore, mode: 'live' });
    expect(none.finished[0]).toEqual({ id: 'n-1', outcome: 'failed', error: 'no enabled channel' });
  });

  it('a second run sends nothing twice (rows are claimed once)', async () => {
    const store = fakeStore([row()]);
    const w = wa({ ok: true, messageId: 'wamid.9' });
    const deps = { store: store as unknown as NotifyStore, whatsapp: w, mode: 'live' as const };
    await runDispatch(deps);
    const second = await runDispatch(deps);
    expect(second.claimed).toBe(0);
    expect(w.sendTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('providers', () => {
  it('WhatsApp template request carries body parameters, quick replies and URL suffixes', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ messages: [{ id: 'wamid.7' }] }), { status: 200 }),
      ),
    );
    const r = await new WhatsAppCloudSender(
      { accessToken: 't', phoneNumberId: '123', graphVersion: 'v21.0' },
      fetchFn,
    ).sendTemplate(
      '+96170123456',
      'booking_reminder_24h_v1',
      'ar',
      ['Haircut'],
      [
        { kind: 'quick_reply', payload: 'confirm:b-1' },
        { kind: 'url', text: 'tok' },
      ],
    );
    expect(r).toEqual({ ok: true, messageId: 'wamid.7' });
    const body = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body)) as {
      to: string;
      template: { language: { code: string }; components: unknown[] };
    };
    expect(body.to).toBe('96170123456');
    expect(body.template.language.code).toBe('ar');
    expect(body.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Haircut' }] },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'confirm:b-1' }],
      },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'tok' }] },
    ]);
  });

  it('Twilio text and error mapping', async () => {
    const ok = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ sid: 'SM9' }), { status: 201 })),
    );
    expect(
      await new TwilioTextSender({ accountSid: 'AC1', authToken: 'x', from: '+1555' }, ok).sendText(
        '+96170123456',
        'Hi',
      ),
    ).toEqual({ ok: true, messageId: 'SM9' });
    const bad = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 21211, message: 'Invalid To' }), { status: 400 }),
      ),
    );
    const r = await new TwilioTextSender(
      { accountSid: 'AC1', authToken: 'x', from: '+1555' },
      bad,
    ).sendText('+1', 'Hi');
    expect(r).toMatchObject({ ok: false, retryable: false });
  });

  it('config: log mode locally, live senders only with credentials; shared-secret check', () => {
    expect(notifyConfigFromEnv((k) => ({ OTP_PROVIDER_MODE: 'log' })[k]).mode).toBe('log');
    const live = notifyConfigFromEnv(
      (k) => ({ WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' })[k],
    );
    expect(live.mode).toBe('live');
    expect(live.whatsapp?.provider).toBe('whatsapp');
    expect(live.sms).toBeUndefined();
    expect(secretMatches('abc', 'abc')).toBe(true);
    expect(secretMatches('abd', 'abc')).toBe(false);
    expect(secretMatches(null, 'abc')).toBe(false);
  });
});

describe('WhatsApp webhook buttons', () => {
  const appSecret = 'meta-secret';
  const signed = (body: string, secret = appSecret) =>
    new Request('http://local/whatsapp-webhook', {
      method: 'POST',
      body,
      headers: {
        'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
      },
    });
  const button = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: 'wamid.in1',
                  from: '96170123456',
                  type: 'button',
                  button: { payload: 'confirm:b-1', text: 'Confirm' },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  it('passes a Confirm tap to the database and replies in the session', async () => {
    const onButton = vi.fn(async () => 'Thanks!');
    const reply = vi.fn(async () => {});
    const res = await handleWhatsAppWebhook(signed(button), {
      appSecret,
      verifyToken: 'v',
      update: vi.fn(),
      onButton,
      reply,
    });
    expect(res.status).toBe(200);
    expect(onButton).toHaveBeenCalledWith('wamid.in1', '96170123456', 'confirm:b-1');
    expect(reply).toHaveBeenCalledWith('96170123456', 'Thanks!');
  });

  it('ignores unsigned requests', async () => {
    const onButton = vi.fn(async () => 'x');
    const res = await handleWhatsAppWebhook(signed(button, 'wrong'), {
      appSecret,
      verifyToken: 'v',
      update: vi.fn(),
      onButton,
    });
    expect(res.status).toBe(403);
    expect(onButton).not.toHaveBeenCalled();
  });
});
