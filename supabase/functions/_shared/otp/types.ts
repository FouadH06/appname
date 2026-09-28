// OTP delivery contract. WhatsApp is the primary channel and SMS the fallback (review decision
// 2026-09-28). Each provider sits behind OtpChannel, so a cheaper local SMS provider can replace
// Twilio later without touching the auth flow or the routing rules.

export type ChannelKind = 'whatsapp' | 'sms';

export interface OtpMessage {
  /** E.164, with '+' */
  phone: string;
  otp: string;
  locale: 'en' | 'ar' | 'fr';
}

export type SendResult =
  { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };

export interface OtpChannel {
  readonly kind: ChannelKind;
  /** Provider name stored with each delivery (e.g. 'whatsapp', 'twilio', 'log'). */
  readonly provider: string;
  send(message: OtpMessage): Promise<SendResult>;
}

/** Database side of routing (public.otp_route / otp_mark, service_role only). */
export interface OtpStore {
  route(
    phone: string,
    smsPrefixes: string[],
    forceChannel: ChannelKind | null,
  ): Promise<RouteDecision>;
  mark(
    deliveryId: string,
    status: 'sent' | 'failed',
    provider: string,
    messageId: string | null,
    error: string | null,
  ): Promise<void>;
}

export type RouteDecision =
  | {
      allowed: true;
      channel: ChannelKind;
      delivery_id: string;
      phone: string;
      sms_available: boolean;
    }
  | { allowed: false; reason: string };

export type Fetch = typeof fetch;
