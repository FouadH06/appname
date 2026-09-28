import type { Fetch, OtpChannel, OtpMessage, SendResult } from './types.ts';

const TIMEOUT_MS = 8000;

export async function post(fetchFn: Fetch, url: string, init: RequestInit): Promise<Response> {
  return fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

// ─── WhatsApp Cloud API (Meta) ─────────────────────────────────────────────
// Sends an approved AUTHENTICATION template: body parameter = code, and the copy-code button
// parameter = code (Meta requires both for one-tap/copy-code templates).
export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  template: string;
  /** Template language per app locale, e.g. { en: 'en', ar: 'ar' } */
  languages: Partial<Record<OtpMessage['locale'], string>>;
  graphVersion: string;
}

export class WhatsAppChannel implements OtpChannel {
  readonly kind = 'whatsapp' as const;
  readonly provider = 'whatsapp';
  constructor(
    private readonly cfg: WhatsAppConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async send(m: OtpMessage): Promise<SendResult> {
    const lang = this.cfg.languages[m.locale] ?? this.cfg.languages.en ?? 'en';
    try {
      const res = await post(
        this.fetchFn,
        `https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.cfg.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: m.phone.replace(/^\+/, ''),
            type: 'template',
            template: {
              name: this.cfg.template,
              language: { code: lang },
              components: [
                { type: 'body', parameters: [{ type: 'text', text: m.otp }] },
                {
                  type: 'button',
                  sub_type: 'url',
                  index: '0',
                  parameters: [{ type: 'text', text: m.otp }],
                },
              ],
            },
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number };
      };
      if (res.ok && json.messages?.[0]?.id) return { ok: true, messageId: json.messages[0].id };
      return {
        ok: false,
        error:
          `whatsapp ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`.trim(),
        retryable: res.status >= 500 || res.status === 429,
      };
    } catch (e) {
      return { ok: false, error: `whatsapp ${errorText(e)}`, retryable: true };
    }
  }
}

// ─── Twilio Programmable Messaging (SMS) ───────────────────────────────────
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** Either a Messaging Service SID (preferred) or a sender number */
  messagingServiceSid?: string;
  from?: string;
  statusCallbackUrl?: string;
  /** Adds the Web OTP line ("@domain #123456") so Android Chrome can autofill the code. */
  webOtpDomain?: string;
  brand: string;
}

export function smsBody(m: OtpMessage, brand: string, webOtpDomain?: string): string {
  const text =
    m.locale === 'ar'
      ? `رمز ${brand} الخاص بك: ${m.otp}. لا تشاركه مع أحد.`
      : m.locale === 'fr'
        ? `Votre code ${brand} : ${m.otp}. Ne le partagez avec personne.`
        : `Your ${brand} code is ${m.otp}. Don't share it with anyone.`;
  return webOtpDomain ? `${text}\n\n@${webOtpDomain} #${m.otp}` : text;
}

export class TwilioSmsChannel implements OtpChannel {
  readonly kind = 'sms' as const;
  readonly provider = 'twilio';
  constructor(
    private readonly cfg: TwilioConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async send(m: OtpMessage): Promise<SendResult> {
    const form = new URLSearchParams({
      To: m.phone,
      Body: smsBody(m, this.cfg.brand, this.cfg.webOtpDomain),
    });
    if (this.cfg.messagingServiceSid) form.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else if (this.cfg.from) form.set('From', this.cfg.from);
    if (this.cfg.statusCallbackUrl) form.set('StatusCallback', this.cfg.statusCallbackUrl);
    try {
      const res = await post(
        this.fetchFn,
        `https://api.twilio.com/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + btoa(`${this.cfg.accountSid}:${this.cfg.authToken}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        sid?: string;
        code?: number;
        message?: string;
      };
      if (res.ok && json.sid) return { ok: true, messageId: json.sid };
      return {
        ok: false,
        error: `twilio ${res.status} ${json.code ?? ''} ${json.message ?? ''}`.trim(),
        retryable: res.status >= 500 || res.status === 429,
      };
    } catch (e) {
      return { ok: false, error: `twilio ${errorText(e)}`, retryable: true };
    }
  }
}

// ─── Local development: prints the code to the function log ────────────────
// Never enabled outside local/CI (the config refuses it unless OTP_PROVIDER_MODE=log).
export class LogChannel implements OtpChannel {
  readonly provider = 'log';
  constructor(
    readonly kind: 'whatsapp' | 'sms',
    private readonly logFn: (line: string) => void = console.log,
  ) {}

  send(m: OtpMessage): Promise<SendResult> {
    this.logFn(`[otp:${this.kind}] ${m.phone} → ${m.otp}`);
    return Promise.resolve({ ok: true, messageId: null });
  }
}
