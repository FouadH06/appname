// Liveness for the dev/e2e harness; `?deep=1` (M14) also proves the Supabase API and database answer —
// point the uptime monitor at /api/health?deep=1 (503 when the database is unreachable).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!new URL(request.url).searchParams.has('deep'))
    return Response.json({ ok: true, app: 'web' });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    return Response.json({ ok: false, app: 'web', db: 'not configured' }, { status: 503 });
  const started = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/rpc/health_ping`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const ms = Date.now() - started;
    if (!res.ok)
      return Response.json({ ok: false, app: 'web', db: res.status, ms }, { status: 503 });
    return Response.json({ ok: true, app: 'web', db: 'ok', ms });
  } catch {
    return Response.json({ ok: false, app: 'web', db: 'unreachable' }, { status: 503 });
  }
}
