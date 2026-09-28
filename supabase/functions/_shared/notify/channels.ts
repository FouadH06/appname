import { errorText, post } from '../otp/channels.ts';
import type { Fetch } from '../otp/types.ts';
import type { SendResult, SmsSender, WhatsAppSender } from './types.ts';

// Providers for booking messages. Same accounts as the OTP channels (M4), different message kinds:
// utility templates with quick-reply buttons, session text replies, and plain SMS.

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
}

async function metaSend(
  fetchFn: Fetch,
  cfg: WhatsAppCloudConfig,
  body: unknown,
): Promise<SendResult> {
  try {
    const res = await post(
      fetchFn,
      `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number };
    };
    if (res.ok && json.messages?.[0]?.id) return { ok: true, messageId: json.messages[0].id };
    return {
      ok: false,
      error: `whatsapp ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`.trim(),
      retryable: res.status >= 500 || res.status === 429,
    };
  } catch (e) {
    return { ok: false, error: `whatsapp ${errorText(e)}`, retryable: true };
  }
}

export class WhatsAppCloudSender implements WhatsAppSender {
  readonly provider = 'whatsapp';
  constructor(
    private readonly cfg: WhatsAppCloudConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  sendTemplate(
    to: string,
    template: string,
    language: string,
    params: string[],
    buttonPayloads: string[],
  ) {
    const components: unknown[] = [];
    if (params.length) {
      components.push({ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) });
    }
    buttonPayloads.forEach((payload, i) =>
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(i),
        parameters: [{ type: 'payload', payload }],
      }),
    );
    return metaSend(this.fetchFn, this.cfg, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: { name: template, language: { code: language }, components },
    });
  }

  sendText(to: string, text: string) {
    return metaSend(this.fetchFn, this.cfg, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^\+/, ''),
      type: 'text',
      text: { body: text, preview_url: true },
    });
  }
}

export interface TwilioTextConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  from?: string;
  statusCallbackUrl?: string;
}

export class TwilioTextSender implements SmsSender {
  readonly provider = 'twilio';
  constructor(
    private readonly cfg: TwilioTextConfig,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async sendText(to: string, text: string): Promise<SendResult> {
    const form = new URLSearchParams({ To: to, Body: text });
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

// ─── Local development / CI: prints instead of sending ─────────────────────
let seq = 0;
const logId = (kind: string) => `log-${kind}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export class LogWhatsApp implements WhatsAppSender {
  readonly provider = 'log';
  constructor(private readonly logFn: (line: string) => void = console.log) {}
  sendTemplate(
    to: string,
    template: string,
    language: string,
    params: string[],
    buttons: string[],
  ) {
    this.logFn(
      `[notify:whatsapp] ${to} ${template}/${language} ${JSON.stringify(params)} ${buttons.join(' ')}`,
    );
    return Promise.resolve<SendResult>({ ok: true, messageId: logId('wa') });
  }
  sendText(to: string, text: string) {
    this.logFn(`[notify:whatsapp-text] ${to} ${text}`);
    return Promise.resolve<SendResult>({ ok: true, messageId: logId('wat') });
  }
}

export class LogSms implements SmsSender {
  readonly provider = 'log';
  constructor(private readonly logFn: (line: string) => void = console.log) {}
  sendText(to: string, text: string) {
    this.logFn(`[notify:sms] ${to} ${text}`);
    return Promise.resolve<SendResult>({ ok: true, messageId: logId('sms') });
  }
}
