// ExternalImageProcessor entrypoint: polls the transform queue and serves /health for the host.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-side only), PORT (8790), POLL_MS (3000),
// CONCURRENCY (2), HEIF_DEC (optional path to libheif's heif-dec for iPhone HEIC).
import { createServer } from 'node:http';
import { heifDecoderFromEnv } from './processor.ts';
import { PROCESSOR_VERSION, runOnce, supabaseStore } from './worker.ts';

const env = (name: string, fallback?: string) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing ${name}`);
  return v;
};

const store = supabaseStore(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
const pollMs = Number(env('POLL_MS', '3000'));
const concurrency = Number(env('CONCURRENCY', '2'));
const heifDecoder = await heifDecoderFromEnv();
const log = (line: string) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);

let lastRun = Date.now();
let stopping = false;
createServer((req, res) => {
  const healthy = Date.now() - lastRun < 60_000;
  res.writeHead(req.url === '/health' && healthy ? 200 : req.url === '/health' ? 503 : 404, {
    'Content-Type': 'application/json',
  });
  res.end(
    JSON.stringify({
      processor: PROCESSOR_VERSION,
      heic: !!heifDecoder,
      lastRun: new Date(lastRun).toISOString(),
    }),
  );
}).listen(Number(env('PORT', '8790')));

process.on('SIGTERM', () => (stopping = true));
process.on('SIGINT', () => (stopping = true));
log(`media-worker started (${PROCESSOR_VERSION}, HEIC ${heifDecoder ? 'on' : 'off'})`);

while (!stopping) {
  try {
    const s = await runOnce(store, { concurrency, heifDecoder, log });
    lastRun = Date.now();
    if (s.claimed === 0) await new Promise((r) => setTimeout(r, pollMs));
  } catch (e) {
    log(`media-worker: claim failed: ${e instanceof Error ? e.message : String(e)}`);
    await new Promise((r) => setTimeout(r, pollMs * 2));
  }
}
process.exit(0);
