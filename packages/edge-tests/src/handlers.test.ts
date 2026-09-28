import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  handleSendSmsHook,
  handleTwilioStatus,
  handleWhatsAppWebhook,
  type StatusUpdate,
} from '../../../supabase/functions/_shared/handlers.ts';

const key = randomBytes(32).toString('base64');
const hookSecrets = `v1,whsec_${key}`;

function hookRequest(body: string, opts: { badSig?: boolean } = {}) {
  const id = 'msg_' + Math.random().toString(36).slice(2);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(opts.badSig ? 'AAAA' : key, 'base64'))
    .update(`${id}.${ts}.${body}`)
    .digest('base64');
  return new Request('http://local/auth-send-sms', {
    method: 'POST',
    body,
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
  });
}

const payload = JSON.stringify({
  user: { id: 'u1', phone: '96170123456', user_metadata: { locale: 'ar' } },
  sms: { otp: '123456' },
});

describe('Send SMS hook handler', () => {
  it('delivers a signed request and answers {}', async () => {
    const deliver = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        channel: 'whatsapp' as const,
        provider: 'whatsapp',
        fellBack: false,
      }),
    );
    const res = await handleSendSmsHook(hookRequest(payload), { hookSecrets, deliver });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(deliver).toHaveBeenCalledWith({ phone: '96170123456', otp: '123456', locale: 'ar' });
  });

  it('rejects unsigned or tampered requests without sending anything', async () => {
    const deliver = vi.fn();
    const res = await handleSendSmsHook(hookRequest(payload, { badSig: true }), {
      hookSecrets,
      deliver,
    });
    expect(res.status).toBe(401);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('returns the hook error shape for refusals (e.g. too many codes)', async () => {
    const deliver = vi.fn(() =>
      Promise.resolve({ ok: false as const, httpStatus: 429, code: 'OTP_TOO_MANY' }),
    );
    const res = await handleSendSmsHook(hookRequest(payload), { hookSecrets, deliver });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { http_code: 429, message: 'OTP_TOO_MANY' } });
  });

  it('rejects malformed payloads and hides internal errors', async () => {
    const deliver = vi.fn(() => Promise.reject(new Error('db down: secret stuff')));
    const bad = await handleSendSmsHook(hookRequest('{"user":{}}'), { hookSecrets, deliver });
    expect(bad.status).toBe(400);
    const boom = await handleSendSmsHook(hookRequest(payload), { hookSecrets, deliver });
    expect(boom.status).toBe(500);
    expect(await boom.text()).not.toContain('secret stuff');
  });
});

describe('Twilio status callback', () => {
  const authToken = 'tw-token';
  const publicUrl = 'https://ref.supabase.co/functions/v1/twilio-status';
  const sign = (params: Record<string, string>) =>
    createHmac('sha1', authToken)
      .update(
        publicUrl +
          Object.keys(params)
            .sort()
            .map((k) => k + params[k])
            .join(''),
      )
      .digest('base64');

  it('records delivered receipts from signed callbacks', async () => {
    const params = { MessageSid: 'SM1', MessageStatus: 'delivered', To: '+96170123456' };
    const update = vi.fn<StatusUpdate>(() => Promise.resolve());
    const res = await handleTwilioStatus(
      new Request('http://internal/twilio-status', {
        method: 'POST',
        body: new URLSearchParams(params).toString(),
        headers: { 'x-twilio-signature': sign(params) },
      }),
      { authToken, publicUrl, update },
    );
    expect(res.status).toBe(204);
    expect(update).toHaveBeenCalledWith('twilio', 'SM1', 'delivered', null, null);
  });

  it('refuses forged callbacks and ignores intermediate statuses', async () => {
    const update = vi.fn<StatusUpdate>(() => Promise.resolve());
    const forged = await handleTwilioStatus(
      new Request('http://internal/twilio-status', {
        method: 'POST',
        body: 'MessageSid=SM1&MessageStatus=delivered',
        headers: { 'x-twilio-signature': 'nope' },
      }),
      { authToken, publicUrl, update },
    );
    expect(forged.status).toBe(403);
    const params = { MessageSid: 'SM1', MessageStatus: 'queued' };
    await handleTwilioStatus(
      new Request('http://internal/twilio-status', {
        method: 'POST',
        body: new URLSearchParams(params).toString(),
        headers: { 'x-twilio-signature': sign(params) },
      }),
      { authToken, publicUrl, update },
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('WhatsApp webhook', () => {
  const deps = (update: StatusUpdate) => ({ appSecret: 'meta-secret', verifyToken: 'vt', update });

  it('answers Meta subscription handshakes only with the right verify token', async () => {
    const ok = await handleWhatsAppWebhook(
      new Request('http://x/wa?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42'),
      deps(vi.fn()),
    );
    expect(await ok.text()).toBe('42');
    const no = await handleWhatsAppWebhook(
      new Request('http://x/wa?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42'),
      deps(vi.fn()),
    );
    expect(no.status).toBe(403);
  });

  it('records message statuses from signed deliveries', async () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.1', status: 'delivered', timestamp: '1800000000' },
                  {
                    id: 'wamid.2',
                    status: 'failed',
                    errors: [{ code: 131026, title: 'Undeliverable' }],
                  },
                  { id: 'wamid.3', status: 'deleted' },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature = 'sha256=' + createHmac('sha256', 'meta-secret').update(body).digest('hex');
    const update = vi.fn<StatusUpdate>(() => Promise.resolve());
    const res = await handleWhatsAppWebhook(
      new Request('http://x/wa', {
        method: 'POST',
        body,
        headers: { 'x-hub-signature-256': signature },
      }),
      deps(update),
    );
    expect(res.status).toBe(200);
    expect(update.mock.calls).toEqual([
      ['whatsapp', 'wamid.1', 'delivered', null, new Date(1_800_000_000_000).toISOString()],
      ['whatsapp', 'wamid.2', 'failed', '131026 Undeliverable', null],
    ]);
  });

  it('refuses unsigned deliveries', async () => {
    const res = await handleWhatsAppWebhook(
      new Request('http://x/wa', { method: 'POST', body: '{}' }),
      deps(vi.fn()),
    );
    expect(res.status).toBe(403);
  });
});
