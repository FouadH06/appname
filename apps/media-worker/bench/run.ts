// Image processor benchmark (M10 plan): decode success, metadata leaks, p95 latency and memory over
// the corpus, 500 sequential and 20-concurrent jobs. Candidate: the Node/libvips ExternalImageProcessor
// (src/processor.ts). The Edge candidate runs separately (bench/edge/, same criteria).
// Usage: node --experimental-strip-types bench/run.ts [corpusDir] [label]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { inputMetadata, metadataLeaks } from '../src/metadata.ts';
import { DEFAULT_DERIVATIVES, heifDecoderFromEnv, transform } from '../src/processor.ts';

const dir = process.argv[2] ?? 'bench/corpus';
const label = process.argv[3] ?? `${platform()}-${arch()}`;
const LIMIT = 12 * 1024 * 1024;
const heifDecoder = await heifDecoderFromEnv();
// BENCH_DUMP=dir writes the derivatives of the first 60 files (for an exiftool cross-check)
const dumpDir = process.env.BENCH_DUMP;
if (dumpDir) mkdirSync(dumpDir, { recursive: true });
const files = readdirSync(dir)
  .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f))
  .sort();

let peakRss = 0;
const sample = () => (peakRss = Math.max(peakRss, process.memoryUsage().rss));
const timer = setInterval(sample, 20);
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

async function one(buf: Buffer) {
  const t0 = performance.now();
  const r = await transform(buf, { heifDecoder });
  sample();
  return { r, ms: performance.now() - t0 };
}

// ── 1. correctness over the corpus ──
const perFile: object[] = [];
let decodeOk = 0;
let eligible = 0;
let tooLargeOk = 0;
let leakCount = 0;
let orientationErrors = 0;
const byFormat: Record<string, number[]> = {};
for (const f of files) {
  const buf = readFileSync(join(dir, f));
  const ext = f.split('.').pop()!.toLowerCase();
  // libvips can't read HEVC HEIC; the corpus's HEIC files are made from upright JPEGs (from their names)
  const input =
    ext === 'heic' ? { exif: true, orientation: 1, gps: true } : await inputMetadata(buf);
  const { r, ms } = await one(buf);
  if (buf.length > LIMIT) {
    if (!r.ok && r.error_code === 'TOO_LARGE') tooLargeOk++;
    perFile.push({ f, bytes: buf.length, expected: 'TOO_LARGE', got: r.ok ? 'ok' : r.error_code });
    continue;
  }
  eligible++;
  if (!r.ok) {
    perFile.push({ f, bytes: buf.length, error: r.error_code, detail: r.detail });
    continue;
  }
  decodeOk++;
  (byFormat[ext] ??= []).push(ms);
  const leaks: string[] = [];
  for (const d of r.derivatives)
    leaks.push(...(await metadataLeaks(d.data)).map((l) => `${d.name}:${l}`));
  leakCount += leaks.length;
  // orientation applied: 5–8 swap the stored dimensions; outputs must be upright and within bounds
  const [nameW, nameH] = f.split('-')[1]!.split('x').map(Number) as [number, number];
  const stored = ext === 'heic' ? { width: nameW, height: nameH } : await sharp(buf).metadata();
  const swap = input.orientation >= 5;
  const uprightLandscape =
    (swap ? stored.height! : stored.width!) >= (swap ? stored.width! : stored.height!);
  if (dumpDir && decodeOk <= 60) {
    for (const d of r.derivatives) writeFileSync(join(dumpDir, `${f}.${d.name}.webp`), d.data);
  }
  const full = r.derivatives.find((d) => d.name === 'full')!;
  const outLandscape = full.width >= full.height;
  const within = r.derivatives.every(
    (d) => Math.max(d.width, d.height) <= DEFAULT_DERIVATIVES.find((x) => x.name === d.name)!.max,
  );
  if (outLandscape !== uprightLandscape || !within) orientationErrors++;
  perFile.push({
    f,
    bytes: buf.length,
    ms: Math.round(ms),
    input,
    out: r.derivatives.map(
      (d) => `${d.name} ${d.width}x${d.height} ${Math.round(d.bytes / 1024)}KB`,
    ),
    leaks,
  });
}
const corpusMs = Object.values(byFormat).flat();

// ── 2. 500 sequential jobs ──
const eligibleFiles = files.filter((f) => readFileSync(join(dir, f)).length <= LIMIT);
const seq: number[] = [];
let seqFail = 0;
for (let i = 0; i < 500; i++) {
  const { r, ms } = await one(readFileSync(join(dir, eligibleFiles[i % eligibleFiles.length]!)));
  seq.push(ms);
  if (!r.ok) seqFail++;
}

// ── 3. 20 concurrent jobs, 5 waves (100 jobs) ──
const conc: number[] = [];
let concFail = 0;
for (let wave = 0; wave < 5; wave++) {
  const batch = Array.from(
    { length: 20 },
    (_, i) => eligibleFiles[(wave * 20 + i * 7) % eligibleFiles.length]!,
  );
  const res = await Promise.all(batch.map((f) => one(readFileSync(join(dir, f)))));
  for (const x of res) {
    conc.push(x.ms);
    if (!x.r.ok) concFail++;
  }
}
clearInterval(timer);

const summary = {
  candidate: 'external (Node + sharp/libvips)',
  label,
  env: {
    platform: platform(),
    arch: arch(),
    cpus: cpus().length,
    cpu: cpus()[0]?.model,
    memGB: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    vips: sharp.versions.vips,
    heifInput: sharp.format.heif.input.fileSuffix,
    heifDec: heifDecoder ? 'heif-dec (libheif)' : 'none',
  },
  corpus: {
    files: files.length,
    eligible,
    decodeOk,
    decodeRate: decodeOk / Math.max(1, eligible),
    tooLargeRejected: tooLargeOk,
    byFormat: Object.fromEntries(Object.entries(byFormat).map(([k, v]) => [k, v.length])),
  },
  metadataLeaks: leakCount,
  orientationOrBoundsErrors: orientationErrors,
  latencyMs: {
    corpus: {
      p50: Math.round(pct(corpusMs, 50)),
      p95: Math.round(pct(corpusMs, 95)),
      max: Math.round(Math.max(...corpusMs)),
    },
    sequential500: {
      p50: Math.round(pct(seq, 50)),
      p95: Math.round(pct(seq, 95)),
      max: Math.round(Math.max(...seq)),
      failures: seqFail,
    },
    concurrent20x5: {
      p50: Math.round(pct(conc, 50)),
      p95: Math.round(pct(conc, 95)),
      max: Math.round(Math.max(...conc)),
      failures: concFail,
    },
  },
  peakRssMB: Math.round(peakRss / 2 ** 20),
  pass: {
    decode100: decodeOk === eligible,
    zeroLeaks: leakCount === 0,
    p95Under8s: pct(seq, 95) < 8000 && pct(conc, 95) < 8000,
    noFailures: seqFail === 0 && concFail === 0,
  },
};
mkdirSync('bench/results', { recursive: true });
writeFileSync(
  `bench/results/external-${label}.json`,
  JSON.stringify({ summary, perFile }, null, 1),
);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
