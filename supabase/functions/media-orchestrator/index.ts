// Media orchestrator (M10): classify → publish → cleanup steps of the photo pipeline. Called every
// minute by pg_cron (app_media_orchestrate) with a shared secret while a media queue has work. The
// image transform itself runs in the external worker (apps/media-worker, benchmark decision).
import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0';
import { mediaConfigFromEnv } from '../_shared/media/config.ts';
import { runOrchestrator, supabaseMediaStore } from '../_shared/media/orchestrator.ts';
import { secretMatches } from '../_shared/notify/config.ts';
import { env, requireEnv, serviceRpcTarget } from '../_shared/runtime.ts';

const cfg = mediaConfigFromEnv(env, (apiKey) => {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    beta: {
      messages: { create: (params, options) => client.beta.messages.create(params, options) },
    },
  };
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  if (!secretMatches(req.headers.get('x-media-secret'), requireEnv('MEDIA_ORCHESTRATOR_SECRET'))) {
    return new Response(null, { status: 401 });
  }
  const { url, key } = serviceRpcTarget();
  const summary = await runOrchestrator({
    store: supabaseMediaStore(url, key),
    classifier: cfg.classifier,
    autoPublish: cfg.autoPublish,
    limit: 10,
    log: (line) => console.log(line),
  });
  return new Response(
    JSON.stringify({ mode: cfg.mode, autoPublish: cfg.autoPublish, ...summary }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
});
