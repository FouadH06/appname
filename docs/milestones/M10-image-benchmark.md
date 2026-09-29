# M10 — Image processor benchmark

Decides `MEDIA_PROCESSOR` (Phase 3 Part 4 §2.6, Phase 4 plan M10). Result: **external worker**
(`apps/media-worker`, Node + sharp/libvips + libheif, Docker, Debian 13). Edge Functions fail the
criteria.

## Criteria

| Test | Pass |
|---|---|
| Decode HEIC (iPhone, HEVC), JPEG, PNG, WebP; corpus up to 12 MB | **100 %** of eligible files, HEIC included (the browser's HEIC→JPEG conversion does not waive direct HEIC) |
| EXIF/GPS stripping, verified on outputs (in-process chunk check + exiftool) | **0** metadata leaks, sequential and stress outputs |
| Re-encode + 3 WebP derivatives + pHash + blurhash, **at the production concurrency** | **p95 < 8 s** per image |
| Stress: 500 sequential + 20 concurrent × 5 waves on a 4-vCPU worker | **0 failures**, **0 OOM/timeouts**, correct outputs (3 derivatives within bounds, orientation applied), 0 leaks |
| Cost per 1,000 images | method recorded; dollar figure at deployment (below) |

**Interpretation (PO decision 2026-09-29, Option A):** the `< 8 s p95 per image` target applies at the
configured production concurrency — **2 jobs per 4-vCPU worker**, enforced in the worker
(`CONCURRENCY` is capped at 2). The 20-concurrent run is a **stress/stability test**: it must show no
failures, no OOM/timeouts, no leaks and correct outputs, but it is not held to the production latency
target while 20 CPU-heavy jobs contend for 4 CPUs. More capacity = more worker instances, not more jobs
per worker.

The CI workflow (`.github/workflows/image-benchmark.yml`) runs the benchmark **inside the production
worker image** and its Gate step **fails the job unless every criterion is true**:
`decode100`, `zeroLeaks`, `correctOutputs`, `p95Under8sAtProductionConcurrency`, `noFailures`, plus
"HEIC files were actually decoded".

## Corpus

- 200 synthetic photo-like images from `bench/corpus.ts`: JPEG 120 · PNG 35 · WebP 40 · 5 over
  12 MB (must be rejected `TOO_LARGE`), 640×480 up to 12000×2000 panoramas, EXIF + GPS + XMP, all 8
  EXIF orientations.
- 40 **real HEVC HEIC** files encoded with libheif's `heif-enc` (x265) from upright corpus JPEGs, GPS
  kept in the container (exiftool confirms) — encoded on the Linux runner.
- The labelled *content* set (relevance/safety) is a separate eval (`packages/edge-tests`), not this
  benchmark.

## Results

| Run | Environment | Decode | Leaks | Latency | Failures | Peak RSS | Verdict |
|---|---|---|---|---|---|---|---|
| Edge candidate | Supabase edge runtime (local), jsquash WASM codecs | **99/195 (51 %)** — `WORKER_LIMIT` on 96 (0 of 37 ≥ 13 MP) | — | p95 1.3 s (successes only) | 96 | — | **Fail** (also no HEIC, orientation, pHash or blurhash) |
| External, Windows dev | i7-8700, 12 threads | 195/195 (no HEIC) | 0 | seq p95 1.28 s · 20-conc p95 2.80 s | 0 | 496 MB | Not the gate (no HEIC) |
| External, Linux CI `930ea5c` | Ubuntu 24.04 runner, 4 vCPU | **195/235 — all 40 HEIC `DECODE_FAILED`** | 0 | seq p95 1.41 s · 20-conc p95 4.66 s | 101 | 948 MB | **Fail** (the workflow had no gate and showed green) |
| External, Linux CI `6345b69` | Ubuntu runner, 4 vCPU; HEIC routing fixed, gate added | 235/235 | 0 | seq p95 6.31 s · 20-conc p95 12.64 s | 0 | 1,061 MB | Failed the then-gate (20-conc latency) |
| Focused, local | production image (Debian 13, libheif 1.23), 4 CPUs; 3 large HEIC (12–24 MP) + same-size JPEG + corpus | — | — | **pool(2) p50/p95 0.66 / 3.6 s** · 20-conc corpus mix p95 9.2 s · heavy p95 10.5 s | 0 | 1,160 MB | Led to Option A |
| **Final, Linux CI `c3c049c`** (run 36600973519) | production image (Debian 13, libheif 1.23), 4-vCPU runner | **235/235** (JPEG 120 · HEIC 40 · PNG 35 · WebP 40); 5 over 12 MB rejected | **0** (in-process + exiftool: 180 files, 0 with metadata) | **production pool(2) p50/p95 0.64 / 3.34 s** · sequential 0.60 / 3.27 s · stress 20-conc 4.23 / 8.68 s | **0** (pool, 500 sequential, 100 stress; 0 bad outputs, 0 orientation errors) | 1,267 MB | **Pass** — all gate criteria true |

### Per format (final run, first pass over the corpus, sequential)

| Format | n | p50 | p95 | max |
|---|---|---|---|---|
| JPEG | 120 | 0.46 s | 0.85 s | 0.88 s |
| PNG | 35 | 0.50 s | 0.74 s | 0.74 s |
| WebP | 40 | 1.38 s | 2.49 s | 2.54 s |
| HEIC (HEVC) | 40 | 3.21 s | 6.01 s | 6.01 s |

### HEIC vs JPEG (focused run, 4 CPUs, sequential)

| | 12 MP | 24 MP |
|---|---|---|
| HEIC decode step, default PNG level (Debian 12 / before) | 4.5 s | 8.7 s |
| HEIC decode step, PNG level 1 (now) | **1.7 s** | **3.4 s** |
| Whole HEIC job (decode + derivatives + hashes) | ≈ 3.7 s | ≈ 6.3 s |
| Whole same-size JPEG job | ≈ 0.7 s | ≈ 0.9 s |

### What failed and why

1. **HEVC HEIC not decoded** (`930ea5c`): sharp's `metadata()` parses the HEIF header even for HEVC,
   so the processor assumed libvips could decode it and skipped libheif; the decode then failed
   ("HEVC … not built in"). Fix: route on the codec — only AV1-coded HEIF goes to libvips, HEVC goes to
   `heif-dec`/`heif-convert`; the decoder's stderr is kept in the error.
2. **HEIC slow under load** (`6345b69`): libheif's CLI writes a lossless PNG that sharp decodes again;
   at the default zlib level the PNG write dominates. Level 1 is still lossless. The worker passes
   `--png-compression-level 1` where supported, and the production image moved to Debian 13 (libheif
   1.23 with `heif-dec`; Debian 12's 1.15 lacks the option). Remaining 20-concurrent latency is CPU
   contention (20 jobs on 4 CPUs), handled by Option A.

## Cost per 1,000 images

No hosting provider or instance price is selected yet, so the dollar figure is a **deployment-time
item** (M4 checklist). Method:

1. **Worker time per image** at the production concurrency: from the final run's pool(2) latency
   (mean ≈ p50 for this mix) — each 4-vCPU worker completes about `2 / mean_seconds` images per second.
   With the final run's pool p50 of 0.64 s that is ≈ 3 images/s ≈ 11,000 images per worker-hour
   for the corpus mix; an all-HEIC mix (p50 3.2 s per job) gives ≈ 2,200 per worker-hour.
2. **Compute cost per 1,000** = `instance $/hour ÷ images per worker-hour × 1,000`. For an always-on
   worker the real cost is the instance's monthly price regardless of volume; per-image cost matters
   only when scaling out.
3. **Plus** (per 1,000): Claude vision classification (1 request per image; image + short context in,
   small JSON out — priced from the provider's per-token rates for the chosen model, measured during
   the labelled eval), Supabase Storage for ≈ 3 derivatives (thumb/card/full, typically 30–400 KB
   together) + the private original (kept ≤ 30 days after removal), and egress for public views.

## Operating notes

- **Production: 2 jobs per 4-vCPU worker** (`CONCURRENCY` capped at 2; `POLL_MS` default 3000). Size
  memory for ≥ 1.5 GB (peak 1.27 GB was measured across the whole run including the 20-concurrent
  stress; far below that at 2).
- HEIC temp files are written to the container's temp directory and removed after each job.
- Unsupported or corrupt files fail with stable codes (`UNSUPPORTED_FORMAT`, `DECODE_FAILED`,
  `TOO_LARGE`, `TOO_SMALL`) and the customer is told the photo couldn't be opened.
