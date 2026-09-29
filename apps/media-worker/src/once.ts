// One pass over the transform queue, then exit (e2e tests and manual draining).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { heifDecoderFromEnv } from './processor.ts';
import { runOnce, supabaseStore } from './worker.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const summary = await runOnce(supabaseStore(url, key), {
  heifDecoder: await heifDecoderFromEnv(),
  limit: 20,
});
process.stdout.write(`${JSON.stringify(summary)}\n`);
