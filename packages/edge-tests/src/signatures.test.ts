import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  timingSafeEqual,
  verifyMetaSignature,
  verifyStandardWebhook,
  verifyTwilioSignature,
} from '../../../supabase/functions/_shared/signatures.ts';

// Independent reference implementations (node:crypto) to cross-check the WebCrypto code.
const keyB64 = randomBytes(24).toString('base64');
const secret = `v1,whsec_${keyB64}`;
const sign = (id: string, ts: string, body: string, k = keyB64) =>
  'v1,' +
  createHmac('sha256', Buffer.from(k, 'base64')).update(`${id}.${ts}.${body}`).digest('base64');

describe('Standard Webhooks (Auth hook)', () => {
  const body = '{"user":{"phone":"96170123456"},"sms":{"otp":"123456"}}';
  const now = 1_800_000_000;
  const ts = String(now);

  it('accepts a correctly signed request', async () => {
    const ok = await verifyStandardWebhook({
      secrets: secret,
      id: 'msg_1',
      timestamp: ts,
      signature: sign('msg_1', ts, body),
      body,
      nowSeconds: now,
    });
    expect(ok).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, missing headers and stale timestamps', async () => {
    const base = { secrets: secret, id: 'msg_1', timestamp: ts, body, nowSeconds: now };
    expect(
      await verifyStandardWebhook({ ...base, signature: sign('msg_1', ts, body + ' '), body }),
    ).toBe(false);
    expect(
      await verifyStandardWebhook({
        ...base,
        signature: sign('msg_1', ts, body, randomBytes(24).toString('base64')),
      }),
    ).toBe(false);
    expect(await verifyStandardWebhook({ ...base, signature: null })).toBe(false);
    expect(
      await verifyStandardWebhook({
        ...base,
        signature: sign('msg_1', ts, body),
        nowSeconds: now + 301,
      }),
    ).toBe(false);
  });

  it('supports secret rotation (several secrets) and several signatures', async () => {
    const other = randomBytes(24).toString('base64');
    const ok = await verifyStandardWebhook({
      secrets: `v1,whsec_${other}|${secret}`,
      id: 'm',
      timestamp: ts,
      signature: `v1,bm90LWl0 ${sign('m', ts, body)}`,
      body,
      nowSeconds: now,
    });
    expect(ok).toBe(true);
  });
});

describe('Twilio request validation', () => {
  it('matches the HMAC-SHA1 of url + sorted params', async () => {
    const authToken = 'twilio-token';
    const url = 'https://example.supabase.co/functions/v1/twilio-status';
    const params = { MessageSid: 'SM123', MessageStatus: 'delivered', AccountSid: 'AC1' };
    const data =
      url +
      Object.keys(params)
        .sort()
        .map((k) => k + params[k as keyof typeof params])
        .join('');
    const signature = createHmac('sha1', authToken).update(data).digest('base64');
    expect(await verifyTwilioSignature({ authToken, url, params, signature })).toBe(true);
    expect(await verifyTwilioSignature({ authToken, url: url + '?x=1', params, signature })).toBe(
      false,
    );
    expect(await verifyTwilioSignature({ authToken, url, params, signature: null })).toBe(false);
  });
});

describe('Meta webhook signature', () => {
  it('checks sha256=hex(HMAC(appSecret, body))', async () => {
    const body = '{"entry":[]}';
    const signature = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
    expect(await verifyMetaSignature({ appSecret: 'app-secret', body, signature })).toBe(true);
    expect(await verifyMetaSignature({ appSecret: 'other', body, signature })).toBe(false);
    expect(await verifyMetaSignature({ appSecret: 'app-secret', body, signature: 'abc' })).toBe(
      false,
    );
  });
});

describe('timingSafeEqual', () => {
  it('compares full strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
