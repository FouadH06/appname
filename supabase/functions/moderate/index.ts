// Text moderation + translation worker (M9). Called every minute by pg_cron (app_moderate) with a
// shared secret while the moderation or translation queue has work.
import Anthropic from 'npm:@anthropic-ai/sdk@0.129.0';
import { secretMatches } from '../_shared/notify/config.ts';
import { moderationConfigFromEnv } from '../_shared/moderation/config.ts';
import { postgrestModerationStore, runModeration } from '../_shared/moderation/pipeline.ts';
import { env, requireEnv, serviceRpcTarget } from '../_shared/runtime.ts';

const cfg = moderationConfigFromEnv(env, (apiKey) => {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    beta: {
      messages: { create: (params, options) => client.beta.messages.create(params, options) },
    },
  };
});
if (env('MODERATION_MODE') === 'llm' && cfg.mode !== 'llm') {
  console.warn(
    'moderate: MODERATION_MODE=llm but ANTHROPIC_API_KEY is missing, using the heuristic classifier',
  );
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  if (!secretMatches(req.headers.get('x-moderate-secret'), requireEnv('MODERATE_SECRET'))) {
    return new Response(null, { status: 401 });
  }
  const { url, key } = serviceRpcTarget();
  const summary = await runModeration({
    store: postgrestModerationStore(url, key),
    classifier: cfg.classifier,
    translator: cfg.translator,
    limit: 20,
    log: (line) => console.log(line),
  });
  return new Response(JSON.stringify({ mode: cfg.mode, ...summary }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
