// Drives the Edge candidate (bench/edge/index.ts, served by the local Supabase edge runtime as
// `image-bench-edge`) over the same corpus and records successes, resource-limit failures and time.
// Usage: SUPABASE_ANON_KEY=… node --experimental-strip-types bench/edge-run.ts [corpusDir]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'bench/corpus';
const url = process.env.EDGE_BENCH_URL ?? 'http://127.0.0.1:54321/functions/v1/image-bench-edge';
const key = process.env.SUPABASE_ANON_KEY ?? '';
const files = readdirSync(dir)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

const rows: { f: string; mp: number; ok: boolean; error?: string; ms?: number }[] = [];
for (const f of files) {
  const buf = readFileSync(join(dir, f));
  if (buf.length > 12 * 1024 * 1024) continue;
  const [w, h] = f.split('-')[1]!.split('x').map(Number) as [number, number];
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    body: buf,
    headers: { Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  type Body = { ok?: boolean; error?: string; code?: string; ms?: { total: number } };
  let body: Body;
  try {
    body = JSON.parse(text) as Body;
  } catch {
    body = { error: text.slice(0, 80) };
  }
  rows.push({
    f,
    mp: Math.round((w * h) / 1e5) / 10,
    ok: body.ok === true,
    error: body.ok ? undefined : (body.error ?? body.code ?? `HTTP ${res.status}`),
    ms: body.ms?.total ?? performance.now() - t0,
  });
  process.stdout.write(body.ok ? '.' : 'x');
}
const ok = rows.filter((r) => r.ok);
const byMp = (lo: number, hi: number) => {
  const xs = rows.filter((r) => r.mp >= lo && r.mp < hi);
  return { n: xs.length, ok: xs.filter((r) => r.ok).length };
};
const summary = {
  candidate: 'edge (Supabase edge runtime + jsquash WASM codecs)',
  eligible: rows.length,
  ok: ok.length,
  decodeRate: ok.length / Math.max(1, rows.length),
  failures: Object.entries(
    rows
      .filter((r) => !r.ok)
      .reduce<Record<string, number>>((a, r) => ((a[r.error!] = (a[r.error!] ?? 0) + 1), a), {}),
  ),
  byMegapixels: {
    '<2MP': byMp(0, 2),
    '2–6MP': byMp(2, 6),
    '6–13MP': byMp(6, 13),
    '≥13MP': byMp(13, 1000),
  },
  computeMsOk: {
    p50: Math.round(
      pct(
        ok.map((r) => r.ms!),
        50,
      ),
    ),
    p95: Math.round(
      pct(
        ok.map((r) => r.ms!),
        95,
      ),
    ),
  },
  over2sComputeOk: ok.filter((r) => r.ms! > 2000).length,
  notes:
    'No orientation handling, pHash or blurhash in this candidate (it would only get slower); HEIC unsupported.',
};
mkdirSync('bench/results', { recursive: true });
writeFileSync('bench/results/edge-local.json', JSON.stringify({ summary, rows }, null, 1));
process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
