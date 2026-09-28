// Webhook signature checks with WebCrypto only (runs in Deno and Node 24).

const encoder = new TextEncoder();

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent comparison of two strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmac(
  algorithm: 'SHA-256' | 'SHA-1',
  key: Uint8Array<ArrayBuffer>,
  data: string,
): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algorithm }, false, [
    'sign',
  ]);
  return crypto.subtle.sign('HMAC', k, encoder.encode(data));
}

/**
 * Standard Webhooks (used by Supabase Auth hooks). Secret format "v1,whsec_<base64>"; several
 * secrets may be given separated by "|" during rotation. Signature header: "v1,<base64> ...".
 */
export async function verifyStandardWebhook(opts: {
  secrets: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { id, timestamp, signature, body } = opts;
  if (!id || !timestamp || !signature) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (opts.toleranceSeconds ?? 300)) return false;

  const provided = signature
    .split(' ')
    .map((s) => s.split(',', 2))
    .filter(([v, sig]) => v === 'v1' && sig)
    .map(([, sig]) => sig as string);
  const keys = opts.secrets
    .split('|')
    .map((s) =>
      s
        .trim()
        .replace(/^v1,/, '')
        .replace(/^whsec_/, ''),
    )
    .filter(Boolean);

  for (const key of keys) {
    const expected = bytesToBase64(
      await hmac('SHA-256', base64ToBytes(key), `${id}.${timestamp}.${body}`),
    );
    if (provided.some((p) => timingSafeEqual(p, expected))) return true;
  }
  return false;
}

/**
 * Twilio request validation: base64(HMAC-SHA1(authToken, url + sorted(key + value)...)).
 * `url` must be the exact public URL Twilio called (including query string).
 */
export async function verifyTwilioSignature(opts: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}): Promise<boolean> {
  if (!opts.signature) return false;
  const data =
    opts.url +
    Object.keys(opts.params)
      .sort()
      .map((k) => k + opts.params[k])
      .join('');
  const expected = bytesToBase64(await hmac('SHA-1', encoder.encode(opts.authToken), data));
  return timingSafeEqual(opts.signature, expected);
}

/** Meta (WhatsApp Cloud API) webhooks: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(appSecret, body)). */
export async function verifyMetaSignature(opts: {
  appSecret: string;
  body: string;
  signature: string | null;
}): Promise<boolean> {
  if (!opts.signature?.startsWith('sha256=')) return false;
  const expected =
    'sha256=' + bytesToHex(await hmac('SHA-256', encoder.encode(opts.appSecret), opts.body));
  return timingSafeEqual(opts.signature, expected);
}
