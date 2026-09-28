import { LogChannel, TwilioSmsChannel, WhatsAppChannel } from './channels.ts';
import type { ChannelKind, Fetch, OtpChannel } from './types.ts';

export type Env = (name: string) => string | undefined;

export interface OtpConfig {
  channels: Partial<Record<ChannelKind, OtpChannel>>;
  smsPrefixes: string[];
  mode: 'live' | 'log';
}

/**
 * Builds the channels from Edge Function secrets.
 * - OTP_PROVIDER_MODE=log (local/CI only): both channels print the code to the function log.
 * - live: WhatsApp when WHATSAPP_* is set; Twilio SMS when TWILIO_* is set. A missing WhatsApp
 *   config simply means every code goes by SMS (e.g. while Meta approves the number).
 * - SMS_ALLOWED_PREFIXES: comma-separated E.164 prefixes allowed to receive SMS (default +961).
 */
export function otpConfigFromEnv(env: Env, fetchFn: Fetch = fetch): OtpConfig {
  const mode = env('OTP_PROVIDER_MODE') === 'log' ? 'log' : 'live';
  const smsPrefixes = (env('SMS_ALLOWED_PREFIXES') ?? '+961')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^\+\d{1,4}$/.test(p));

  if (mode === 'log') {
    return {
      mode,
      smsPrefixes,
      channels: { whatsapp: new LogChannel('whatsapp'), sms: new LogChannel('sms') },
    };
  }

  const channels: Partial<Record<ChannelKind, OtpChannel>> = {};
  const waToken = env('WHATSAPP_ACCESS_TOKEN');
  const waNumber = env('WHATSAPP_PHONE_NUMBER_ID');
  const waTemplate = env('WHATSAPP_OTP_TEMPLATE');
  if (waToken && waNumber && waTemplate) {
    channels.whatsapp = new WhatsAppChannel(
      {
        accessToken: waToken,
        phoneNumberId: waNumber,
        template: waTemplate,
        graphVersion: env('WHATSAPP_GRAPH_VERSION') ?? 'v21.0',
        languages: {
          en: env('WHATSAPP_OTP_LANG_EN') ?? 'en',
          ar: env('WHATSAPP_OTP_LANG_AR') ?? 'ar',
          fr: env('WHATSAPP_OTP_LANG_FR') ?? 'fr',
        },
      },
      fetchFn,
    );
  }

  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  const service = env('TWILIO_MESSAGING_SERVICE_SID');
  const from = env('TWILIO_FROM');
  if (sid && token && (service || from)) {
    channels.sms = new TwilioSmsChannel(
      {
        accountSid: sid,
        authToken: token,
        messagingServiceSid: service,
        from,
        statusCallbackUrl: env('TWILIO_STATUS_CALLBACK_URL'),
        webOtpDomain: env('OTP_WEB_DOMAIN'),
        brand: env('OTP_BRAND') ?? 'APP_NAME',
      },
      fetchFn,
    );
  }
  return { mode, smsPrefixes, channels };
}

/** Locale for the message: user metadata (set by the app at sign-in), else English. */
export function localeFromUser(user: unknown): 'en' | 'ar' | 'fr' {
  const meta = (user as { user_metadata?: { locale?: unknown } } | null)?.user_metadata;
  const l = typeof meta?.locale === 'string' ? meta.locale : '';
  return l === 'ar' || l === 'fr' ? l : 'en';
}
