// Deno-side wiring shared by the entrypoints (kept out of the unit-tested modules).
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
  await rpc(fetch, url, key, 'otp_status_update', {
    p_provider: provider,
    p_message_id: messageId,
    p_status: status,
    p_error: error,
    p_at: at,
  });
};
