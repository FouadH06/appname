// Deno-side wiring shared by the entrypoints (kept out of the unit-tested modules).
import { replyText } from './notify/render.ts';
import { rpc } from './otp/store.ts';
import type { StatusUpdate } from './handlers.ts';

export const env = (name: string): string | undefined => Deno.env.get(name) ?? undefined;

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`missing secret ${name}`);
  return v;
}

export function serviceRpcTarget(): { url: string; key: string } {
  return { url: requireEnv('SUPABASE_URL'), key: requireEnv('SUPABASE_SERVICE_ROLE_KEY') };
}

/** Log-mode OTPs are refused on hosted projects: codes must never land in hosted logs. */
export function assertLogModeIsLocal(): void {
  if (env('OTP_PROVIDER_MODE') === 'log' && /\.supabase\.co/.test(env('SUPABASE_URL') ?? '')) {
    throw new Error('OTP_PROVIDER_MODE=log is not allowed on a hosted project');
  }
}

export const statusUpdater: StatusUpdate = async (provider, messageId, status, error, at) => {
  const { url, key } = serviceRpcTarget();
  // notification receipts first; unknown ids are passed on to the OTP receipts (M4)
  await rpc(fetch, url, key, 'notify_status_update', {
    p_provider: provider,
    p_message_id: messageId,
    p_status: status,
    p_error: error,
    p_at: at,
  });
};

/** Button taps → public.whatsapp_button (idempotent per message) → reply text. */
export async function buttonHandler(
  messageId: string,
  from: string,
  payload: string,
): Promise<string | null> {
  const { url, key } = serviceRpcTarget();
  const result = await rpc<Record<string, unknown> | null>(fetch, url, key, 'whatsapp_button', {
    p_message_id: messageId,
    p_from_phone: from,
    p_payload: payload,
  });
  return replyText(result);
}

/** Log mode is local-only for booking messages too. */
export function assertNotifyLogModeIsLocal(): void {
  const mode = env('NOTIFY_PROVIDER_MODE') ?? env('OTP_PROVIDER_MODE');
  if (mode === 'log' && /\.supabase\.co/.test(env('SUPABASE_URL') ?? '')) {
    throw new Error('log mode is not allowed on a hosted project');
  }
}
