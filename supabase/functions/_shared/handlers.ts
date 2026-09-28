import { localeFromUser } from './otp/config.ts';
import type { DeliverOutcome } from './otp/router.ts';
import type { OtpMessage } from './otp/types.ts';
import { verifyMetaSignature, verifyStandardWebhook, verifyTwilioSignature } from './signatures.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Supabase Auth hook error shape: { error: { http_code, message } }
const hookError = (httpCode: number, message: string) =>
  json({ error: { http_code: httpCode, message } }, httpCode);

// ─── Send SMS Hook (Supabase Auth → us → WhatsApp / SMS) ───────────────────
export async function handleSendSmsHook(
  req: Request,
  deps: {
    hookSecrets: string;
    deliver: (m: OtpMessage) => Promise<DeliverOutcome>;
    log?: (line: string) => void;
  },
): Promise<Response> {
  if (req.method !== 'POST') return hookError(405, 'method not allowed');
  const body = await req.text();
  const valid = await verifyStandardWebhook({
    secrets: deps.hookSecrets,
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signature: req.headers.get('webhook-signature'),
    body,
  });
  if (!valid) return hookError(401, 'invalid signature');

  let payload: {
    user?: { phone?: string; new_phone?: string };
    sms?: { otp?: string; phone?: string };
  };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return hookError(400, 'invalid payload');
  }
  // sms.phone is the destination. For a phone change (anonymous visitor linking a number) it is
  // the NEW number, also in user.new_phone, while user.phone is still empty.
  const phone = payload.sms?.phone || payload.user?.new_phone || payload.user?.phone || '';
  const otp = payload.sms?.otp ?? '';
  if (!phone || !/^\d{4,10}$/.test(otp)) return hookError(400, 'invalid payload');

  try {
    const outcome = await deps.deliver({ phone, otp, locale: localeFromUser(payload.user) });
    if (outcome.ok) {
      deps.log?.(`otp sent via ${outcome.provider}${outcome.fellBack ? ' (fallback)' : ''}`);
      return json({});
    }
    // The code is shown to the user by the app (OTP_TOO_MANY → "try again later", etc.)
    return hookError(outcome.httpStatus, outcome.code);
  } catch (e) {
    deps.log?.(`otp hook error: ${e instanceof Error ? e.message : String(e)}`);
    return hookError(500, 'OTP_DELIVERY_FAILED');
  }
}

export type StatusUpdate = (
  provider: 'twilio' | 'whatsapp',
  messageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered',
  error: string | null,
  at: string | null,
) => Promise<void>;

// ─── Twilio status callback (SMS delivery receipts) ────────────────────────
const TWILIO_STATUS: Record<string, 'sent' | 'delivered' | 'failed' | 'undelivered'> = {
  sent: 'sent',
  delivered: 'delivered',
  failed: 'failed',
  undelivered: 'undelivered',
};

export async function handleTwilioStatus(
  req: Request,
  deps: { authToken: string; publicUrl: string; update: StatusUpdate },
): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<
    string,
    string
  >;
  const ok = await verifyTwilioSignature({
    authToken: deps.authToken,
    url: deps.publicUrl,
    params,
    signature: req.headers.get('x-twilio-signature'),
  });
  if (!ok) return new Response(null, { status: 403 });
  const status = TWILIO_STATUS[params.MessageStatus ?? ''];
  if (status && params.MessageSid) {
    await deps.update('twilio', params.MessageSid, status, params.ErrorCode ?? null, null);
  }
  return new Response(null, { status: 204 });
}

// ─── WhatsApp webhook (M4: message statuses; M7 adds button replies) ───────
interface WaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string }[];
}

export async function handleWhatsAppWebhook(
  req: Request,
  deps: { appSecret: string; verifyToken: string; update: StatusUpdate },
): Promise<Response> {
  if (req.method === 'GET') {
    // Meta's subscription handshake
    const q = new URL(req.url).searchParams;
    if (q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === deps.verifyToken) {
      return new Response(q.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response(null, { status: 403 });
  }
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const body = await req.text();
  const ok = await verifyMetaSignature({
    appSecret: deps.appSecret,
    body,
    signature: req.headers.get('x-hub-signature-256'),
  });
  if (!ok) return new Response(null, { status: 403 });

  const payload = JSON.parse(body) as {
    entry?: { changes?: { value?: { statuses?: WaStatus[] } }[] }[];
  };
  const statuses = (payload.entry ?? []).flatMap((e) =>
    (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []),
  );
  for (const s of statuses) {
    if (!s.id || !s.status) continue;
    if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null;
    const err = s.errors?.[0]
      ? `${s.errors[0].code ?? ''} ${s.errors[0].title ?? ''}`.trim()
      : null;
    await deps.update(
      'whatsapp',
      s.id,
      s.status as 'sent' | 'delivered' | 'read' | 'failed',
      err,
      at,
    );
  }
  return new Response('ok', { status: 200 }); // Meta retries anything else
}
