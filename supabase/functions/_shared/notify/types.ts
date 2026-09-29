// Notification dispatch contract (M7). The database decides WHAT to send and to whom (outbox rows
// with channel order, templates and payload); this code only renders and talks to providers, so
// providers can be swapped without touching the booking logic.
import type { SendResult } from '../otp/types.ts';

export type { SendResult };
export type NotifyChannel = 'whatsapp' | 'sms' | 'push';
export type Locale = 'en' | 'ar' | 'fr';

export interface Template {
  type: string;
  channel: NotifyChannel;
  locale: Locale;
  provider_template_name: string | null;
  body: string;
  variables: string[];
  buttons: string[];
  button_labels: string[];
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
  /** active Expo push tokens of the recipient (M13; empty for web-only customers) */
  push_tokens?: string[];
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
  /** tokens the push provider reported as no longer registered (M13) */
  disablePushTokens?(tokens: string[]): Promise<void>;
}

/** A WhatsApp template button: quick reply (payload comes back to our webhook) or URL suffix. */
export type TemplateButton =
  { kind: 'quick_reply'; payload: string } | { kind: 'url'; text: string };

export interface WhatsAppSender {
  readonly provider: string;
  /** Approved template with body parameters and button parameters, in template order. */
  sendTemplate(
    to: string,
    template: string,
    language: string,
    params: string[],
    buttons: TemplateButton[],
  ): Promise<SendResult>;
  /** Free-form text, only inside an open 24 h customer session (button replies). */
  sendText(to: string, text: string): Promise<SendResult>;
}

export interface SmsSender {
  readonly provider: string;
  sendText(to: string, text: string): Promise<SendResult>;
}

/** Push message (M13): title + body, and a path the app opens (the same path as the web route). */
export interface PushMessage {
  title: string;
  body: string;
  path: string;
}
export interface PushResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
  retryable: boolean;
  /** tokens the provider says are gone (uninstalled app, revoked permission) */
  invalidTokens: string[];
}
export interface PushSender {
  readonly provider: string;
  send(tokens: string[], message: PushMessage): Promise<PushResult>;
}
