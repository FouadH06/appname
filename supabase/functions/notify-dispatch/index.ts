// Notification outbox dispatcher (M7). Called every minute by pg_cron (private.job_notify_dispatch)
// with a shared secret; claims due rows, sends via WhatsApp / SMS and records every attempt.
import { notifyConfigFromEnv, secretMatches } from '../_shared/notify/config.ts';
import { postgrestNotifyStore, runDispatch } from '../_shared/notify/dispatch.ts';
import {
  assertNotifyLogModeIsLocal,
  env,
  requireEnv,
  serviceRpcTarget,
} from '../_shared/runtime.ts';

assertNotifyLogModeIsLocal();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  if (!secretMatches(req.headers.get('x-dispatch-secret'), requireEnv('NOTIFY_DISPATCH_SECRET'))) {
    return new Response(null, { status: 401 });
  }
  const { url, key } = serviceRpcTarget();
  const cfg = notifyConfigFromEnv(env);
  const summary = await runDispatch({
    store: postgrestNotifyStore(url, key),
    whatsapp: cfg.whatsapp,
    sms: cfg.sms,
    mode: cfg.mode,
    limit: 100,
    log: (line) => console.log(line),
  });
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
