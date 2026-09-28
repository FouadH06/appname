import type { Fetch } from '../otp/types.ts';
import { LogSms, LogWhatsApp, TwilioTextSender, WhatsAppCloudSender } from './channels.ts';
import type { SmsSender, WhatsAppSender } from './types.ts';

export type Env = (name: string) => string | undefined;

export interface NotifyConfig {
  mode: 'live' | 'log';
  whatsapp?: WhatsAppSender;
  sms?: SmsSender;
}

/**
 * Senders from Edge Function secrets (same WhatsApp / Twilio accounts as OTP).
 * NOTIFY_PROVIDER_MODE=log (or OTP_PROVIDER_MODE=log) prints messages instead — local/CI only.
 * Missing credentials simply leave a channel out; the dispatcher then falls back or fails cleanly.
 */
export function notifyConfigFromEnv(env: Env, fetchFn: Fetch = fetch): NotifyConfig {
  const mode = (env('NOTIFY_PROVIDER_MODE') ?? env('OTP_PROVIDER_MODE')) === 'log' ? 'log' : 'live';
  if (mode === 'log') return { mode, whatsapp: new LogWhatsApp(), sms: new LogSms() };

  const cfg: NotifyConfig = { mode };
  const token = env('WHATSAPP_ACCESS_TOKEN');
  const number = env('WHATSAPP_PHONE_NUMBER_ID');
  if (token && number) {
    cfg.whatsapp = new WhatsAppCloudSender(
      {
        accessToken: token,
        phoneNumberId: number,
        graphVersion: env('WHATSAPP_GRAPH_VERSION') ?? 'v21.0',
      },
      fetchFn,
    );
  }
  const sid = env('TWILIO_ACCOUNT_SID');
  const auth = env('TWILIO_AUTH_TOKEN');
  const service = env('TWILIO_MESSAGING_SERVICE_SID');
  const from = env('TWILIO_FROM');
  if (sid && auth && (service || from)) {
    cfg.sms = new TwilioTextSender(
      {
        accountSid: sid,
        authToken: auth,
        messagingServiceSid: service,
        from,
        statusCallbackUrl: env('TWILIO_STATUS_CALLBACK_URL'),
      },
      fetchFn,
    );
  }
  return cfg;
}

/** Constant-time comparison for the pg_cron → dispatcher shared secret. */
export function secretMatches(given: string | null, expected: string): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
