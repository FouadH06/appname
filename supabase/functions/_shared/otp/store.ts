import type { ChannelKind, Fetch, OtpStore, RouteDecision } from './types.ts';

/** Calls service_role-only RPCs through PostgREST (no client library needed in the function). */
export async function rpc<T>(
  fetchFn: Fetch,
  supabaseUrl: string,
  serviceKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`rpc ${name} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function postgrestOtpStore(
  supabaseUrl: string,
  serviceKey: string,
  fetchFn: Fetch = fetch,
): OtpStore {
  return {
    route: (phone: string, smsPrefixes: string[], forceChannel: ChannelKind | null) =>
      rpc<RouteDecision>(fetchFn, supabaseUrl, serviceKey, 'otp_route', {
        p_phone: phone,
        p_sms_prefixes: smsPrefixes,
        p_force_channel: forceChannel,
      }),
    mark: async (deliveryId, status, provider, messageId, error) => {
      await rpc(fetchFn, supabaseUrl, serviceKey, 'otp_mark', {
        p_delivery_id: deliveryId,
        p_status: status,
        p_provider: provider,
        p_message_id: messageId,
        p_error: error,
      });
    },
  };
}
