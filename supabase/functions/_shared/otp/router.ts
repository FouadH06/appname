import type { ChannelKind, OtpChannel, OtpMessage, OtpStore } from './types.ts';

export interface DeliverDeps {
  store: OtpStore;
  channels: Partial<Record<ChannelKind, OtpChannel>>;
  smsPrefixes: string[];
}

export type DeliverOutcome =
  | { ok: true; channel: ChannelKind; provider: string; fellBack: boolean }
  | { ok: false; httpStatus: number; code: string };

const REFUSALS: Record<string, number> = {
  OTP_TOO_MANY: 429,
  INVALID_PHONE: 400,
  SMS_NOT_AVAILABLE: 400,
  NOT_SUPPORTED: 400,
};

/**
 * Routing (state and limits live in public.otp_route):
 * 1. The database picks the channel: WhatsApp by default; SMS when the customer asks again after a
 *    WhatsApp code ("Send by SMS instead") and SMS is allowed for that number's country.
 * 2. A channel that isn't configured, or whose send fails, falls back to SMS in the same request
 *    when SMS is available. This also covers the period before the WhatsApp number is approved.
 * 3. Every attempt is recorded (provider, message id, error) for delivery metrics.
 */
export async function deliverOtp(
  message: Omit<OtpMessage, 'phone'> & { phone: string },
  deps: DeliverDeps,
): Promise<DeliverOutcome> {
  const first = await deps.store.route(message.phone, deps.smsPrefixes, null);
  if (!first.allowed) return refusal(first.reason);

  const attempt = async (
    channel: ChannelKind,
    deliveryId: string,
    phone: string,
  ): Promise<{ ok: boolean; provider: string }> => {
    const impl = deps.channels[channel];
    if (!impl) {
      await deps.store.mark(deliveryId, 'failed', channel, null, 'channel_not_configured');
      return { ok: false, provider: channel };
    }
    const res = await impl.send({ ...message, phone });
    await deps.store.mark(
      deliveryId,
      res.ok ? 'sent' : 'failed',
      impl.provider,
      res.ok ? res.messageId : null,
      res.ok ? null : res.error,
    );
    return { ok: res.ok, provider: impl.provider };
  };

  const r1 = await attempt(first.channel, first.delivery_id, first.phone);
  if (r1.ok) return { ok: true, channel: first.channel, provider: r1.provider, fellBack: false };

  if (first.channel === 'whatsapp' && first.sms_available) {
    const second = await deps.store.route(message.phone, deps.smsPrefixes, 'sms');
    if (second.allowed) {
      const r2 = await attempt('sms', second.delivery_id, second.phone);
      if (r2.ok) return { ok: true, channel: 'sms', provider: r2.provider, fellBack: true };
    }
  }
  return { ok: false, httpStatus: 502, code: 'OTP_DELIVERY_FAILED' };
}

function refusal(reason: string): DeliverOutcome {
  return { ok: false, httpStatus: REFUSALS[reason] ?? 400, code: reason };
}
