// Notification dispatch contract (M7). The database decides WHAT to send and to whom (outbox rows
// with channel order, templates and payload); this code only renders and talks to providers, so
// providers can be swapped without touching the booking logic.
import type { SendResult } from '../otp/types.ts';

export type { SendResult };
export type NotifyChannel = 'whatsapp' | 'sms';
export type Locale = 'en' | 'ar' | 'fr';

export interface Template {
  type: string;
  channel: NotifyChannel;
  locale: Locale;
  provider_template_name: string | null;
  body: string;
  variables: string[];
  buttons: string[];
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
}

/** One claimed outbox row (public.notify_claim). */
export interface Claimed {
  id: string;
  type: string;
  locale: Locale;
  phone: string;
  attempts: number;
  critical: boolean;
  payload: Record<string, unknown>;
  channels: NotifyChannel[];
  templates: Partial<Record<NotifyChannel, Template>>;
}

export type Outcome = 'sent' | 'retry' | 'failed';

export interface NotifyStore {
  claim(limit: number): Promise<Claimed[]>;
  recordAttempt(
    id: string,
    channel: NotifyChannel,
    provider: string,
    messageId: string | null,
    ok: boolean,
    error: string | null,
  ): Promise<void>;
  finish(id: string, outcome: Outcome, error: string | null): Promise<void>;
}

export interface WhatsAppSender {
  readonly provider: string;
  /** Approved template with body parameters and quick-reply button payloads. */
  sendTemplate(
    to: string,
    template: string,
    language: string,
    params: string[],
    buttonPayloads: string[],
  ): Promise<SendResult>;
  /** Free-form text, only inside an open 24 h customer session (button replies). */
  sendText(to: string, text: string): Promise<SendResult>;
}

export interface SmsSender {
  readonly provider: string;
  sendText(to: string, text: string): Promise<SendResult>;
}
