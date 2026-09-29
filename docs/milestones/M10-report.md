# M10 — Customer results & media pipeline: report

Status: **closed** (approved 2026-09-29, D1–D11 incl. Option A) · merged to `main` (`baca65d`, main CI green)

Hosted staging verification stays deferred with M4–M9 (M4 report checklist, now including M10) and
is mandatory before any real users. Decisions needed from you are at the end of this report.

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| Formal image benchmark | 200-image synthetic corpus (JPEG/PNG/WebP up to 12 MB+, EXIF/GPS/orientation) + 40 real HEVC HEIC, run **inside the production worker image** on a 4-vCPU Linux runner: production pool (2 concurrent), 500 sequential, 20 concurrent × 5 stress, exiftool cross-check. Edge Functions **fail** (51 % decode, `WORKER_LIMIT`) → `ExternalImageProcessor`. The CI job **fails unless every criterion passes** (Option A interpretation below). Report: [M10-image-benchmark.md](M10-image-benchmark.md) | Plan M10 benchmark |
| Transform worker | `apps/media-worker` (Node 24 + sharp/libvips 8.18, Docker on Debian 13 with libheif 1.23 + libde265; **2 jobs per 4-vCPU worker, enforced**): sniff by magic bytes, decode (JPEG/PNG/WebP; **HEVC HEIC via libheif's `heif-dec`/`heif-convert`**; AVIF-coded HEIF via libvips), orientation applied, **all metadata stripped**, `thumb` 320 / `card` 800 / `full` 2048 WebP, sha256 of the original, 64-bit DCT pHash, blurhash; decompression-bomb and size limits; stable error codes. Poll loop + `/health` | Part 4 §2.6 |
| Worker contract | `media_claim_transform` → job (read `ugc-private`, write `ugc-staging` under the job's prefix) → `media_processing_complete(job_id, result)`: service role only, **idempotent per job**, late results ignored, same contract for `processor = edge` | Part 7 media contract |
| Private-first storage | `ugc-private` (client may insert only at its registered `{user}/{media}` path), `ugc-staging` (moderators may read; WebP only), `ugc-public` (service writes only). **Nothing reaches `ugc-public` before approval** (pgTAP) | Part 4 §2.2 |
| Upload API | `request_review_media_upload` (consent version + time recorded, 30 days after the visit, ≤ 4 per review, before/after only where the canonical service allows it, only the review's author), `finalize_media_upload`, sweeper for stale uploads, `delete_my_media`, `get_my_review_media` | Part 4 §2.3 |
| Decisions | Hash stage in SQL: exact / near duplicate (pHash Hamming ≤ 6, 180 days) of the business's portfolio or another result → human / "not your result". Then `media-orchestrator` (Edge Function, pg_cron): `ImageClassifier` → `decideImage`: safety hard → reject, grey → human; document/ID → human; contact details / QR → reject; minors → human + minor flag; relevance to the booked service < 0.40 reject, < 0.75 human; refusal / unusable → human. Publish copies derivatives to `ugc-public`; cleanup deletes staging/public objects | Part 4 §3.2 |
| Classifier | `ClaudeImageClassifier` (official SDK, structured output, cached system prompt, image + booking context as data, server-side fallbacks). Model `MEDIA_LLM_MODEL` → `LLM_MODEL` → `claude-sonnet-5`. **Auto-publication only with `MEDIA_AUTO_PUBLISH=true`**; hosted without a key → `NoImageClassifier` → every photo to a moderator; local stack → stub | Same gate as M9 text |
| Business photos | Existing M5 business media get the async safety check (already public; the check only removes or escalates) | M5 D1 |
| Featuring & results | `feature_result` / `unfeature_result` (owner/manager, ≤ 6 slots, never minor-flagged photos); **no API or control to hide, delete or reorder organic results**; `get_business_results`, `get_result` (review, prev/next, more from the business), `biz_get_results` | Part 4 §2.7 |
| Removal | Author deletes a photo or the review → gone at once, featured slot cleared, public derivatives deleted, private original kept 30 days for appeals, then purged (never under legal hold); moderator removal; reports on photos (`my_photo` priority 90) | Part 4 §2.8 |
| Messages | `result_published` ("📸 Your photo … is now live") and `result_rejected` (reason + "Add another photo"), EN + AR, WhatsApp only — **copy needs your approval** ([templates](../notifications/templates.md)) | M7 |
| C16 upload | After the rating on the review page: consent (checkbox, versioned), photo prepared on the phone (≤ 2048 px JPEG; iPhone HEIC converted by the browser), private upload, status (In review / Live / Couldn't be published + reason), remove | Phase 2 C16 |
| C6 results | Business page results strip, `/{slug}/results` grid, `/r/{id}` result detail (trust tier, service · staff, price snapshot, "Book similar" → prefilled booking), report link | Phase 2 C6 |
| B10 featuring | "Customer photos" tab in dashboard reviews: feature into slots 1–6 / unfeature; notice that other photos can't be hidden | Phase 2 B10 |
| A3 image case | Queue links photo cases to an image case page: **blurred until the moderator reveals it**, short-lived signed URL for staging, checks per stage, report, claim, decide (approve / reject / remove / escalate, keep minor flag), audited | Phase 2 A3 |
| Image eval harness | `packages/edge-tests/eval/image-evaluate.ts`: labelled set outside Git, same `decideImage` as production with auto-publication on; gate **≥ 90 % of automatic decisions correct and 0 falsely public** | DoD |

## Migrations created

| File | Contents |
|---|---|
| `20261006100000_m10_media.sql` | trust_config v2 (media thresholds), media columns, `review_media`, jobs, queues, buckets + policies, upload/finalize/delete, worker RPCs, hash stage, classification/publish/cleanup RPCs, business media safety trigger, featuring, public read models, admin image case + decision, sweeper and orchestrator crons (Vault) |
| `20261006100100_m10_media_reports.sql` | `report_content` for photos (keyed by media asset); text decisions refuse photo cases |
| `20261006100200_m10_media_templates.sql` | EN/AR WhatsApp (+ SMS rows, unused) for the 2 result messages — generated by `scripts/notification-templates.py` |

## Tests executed

| Layer | Result | What it proves |
|---|---|---|
| pgTAP | **771/771** (58 new in `290_media`) | Consent, 30-day window, before/after rule, ≤ 4, author only; private path; worker RPCs service-role only; worker contract (buckets, prefixes); **never public before approval**; idempotent per job, late results ignored, edge = same contract; portfolio duplicate → "not your result"; classifier approve → orchestrator publish → public read model; minor → human, flagged, never featured; irrelevant → rejected + staging cleanup; moderator approve/reject; reception can't feature; no business path to hide/delete/reorder; reports; author delete (featured slot cleared, public deleted, original kept 30 days); retention purge respects legal hold; review delete removes photos; sweeper |
| Worker unit | **13** (+1 Linux-only real HEVC decode) | Metadata strip (EXIF/GPS/XMP/ICC), orientation, no enlargement, hashes, pHash near/far, error codes, HEIC routing (**a real HEVC file goes to libheif**), decoder errors surfaced; worker loop |
| Edge unit | **90** (+2 opt-in LLM gates) | Image request shape (SDK types), parsing, refusal → human, `decideImage` matrix, config (local stub / none / Claude, auto-publish only with the flag), orchestrator; image eval scoring |
| E2E web (local stack) | **17 passed** (1 new) | Review → consent → photo prepared and uploaded privately → worker → orchestrator → **published** → business page strip → results grid → result detail ("Verified visit", "Book similar", public derivative) → business features it (no hide/delete control) → customer removes it → gone |
| E2E admin | **1 passed** (extended) | Image case: photo **blurred** by default, signed staging URL loads, reveal, claim, reject with reason → rejected, audited, author told |
| Worker Docker image | ✅ | Real HEVC HEIC decoded inside the production image (Debian 13), 0 metadata |
| Image benchmark (Linux CI, production image, run 36600973519) | **Pass** — 235/235 decoded (40 HEVC HEIC), 0 leaks (exiftool 0/180), **production p95 3.34 s**, sequential p95 3.27 s, stress 20-conc p95 8.68 s with 0 failures / 0 bad outputs, peak 1,267 MB | Gate: 100 % eligible decode incl. HEIC, 0 leaks, correct outputs, p95 < 8 s at production concurrency, 0 failures (sequential, production pool, 20-concurrent stress) |
| Unit, lint, typecheck, format, builds | ✅ | |

## Found while implementing (fixed)

- **HEVC HEIC failed on Linux** (all 40 files, first Linux run): sharp's `metadata()` parses the
  HEIF header even for HEVC, so the processor assumed libvips could decode it and skipped libheif.
  Routing now uses the codec (only AV1 goes to libvips); decoder stderr is kept in the error. The
  benchmark workflow reported this run as green because it had no gate — it now fails unless every
  criterion passes, installs the HEVC plugins strictly and round-trips a real HEIC first.
- **HEIC slow under load** (next run: 20-concurrent p95 12.6 s): libheif's PNG intermediate at the
  default compression dominated (12 MP: 4.5 s). PNG level 1 (lossless) → 1.7 s; the image moved to
  Debian 13 (libheif 1.23) for the option. A focused 4-CPU run then showed p95 3.6 s at the production
  concurrency but 9.2 s with 20 jobs on 4 CPUs → PO decision Option A (D11).
- Edge Functions can't carry the transform: large photos hit `WORKER_LIMIT` (CPU/memory).
- The "Verified visit" label was empty on the server-rendered result page (a constant imported from
  a client module) → moved to a shared module.
- A blank build cache after a power-off broke the typecheck (generated file) — environment.
- First full e2e run after that cache wipe: 6 timeouts from cold compilation; all passed on rerun
  (CI uses a production build).

## Deviations for your approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | Part 4 §2.6 | **External worker** (Docker, Node + sharp/libvips + libheif) for transform only; everything else stays in Supabase | Benchmark: Edge Functions decode 51 % (`WORKER_LIMIT`) |
| D2 | Part 4 §2.6 | The worker uses the **service role** (on the worker host only) through narrow RPCs + storage | Needs to read private originals and write staging |
| D3 | Part 4 §3 | Separate media queues (`media_transform` / `_classify` / `_publish` / `_cleanup`) instead of the M9 `moderation` queue | That claimer drops non-text messages; stages retry independently |
| D4 | Part 4 §3.2 | **No auto-publication without a validated classifier**: `MEDIA_AUTO_PUBLISH=false` until the labelled image eval passes; hosted without a key every photo goes to a moderator | Same rule as M9 comments |
| D5 | DoD | Labelled image-set **run not done**: harness + scoring tests built; the run needs licensed/consented photos (not in Git) and your API key | No real photos or key in this environment |
| D6 | C16 | Browser converts HEIC to JPEG before upload (iOS does this for file inputs); the worker still decodes HEVC HEIC directly (benchmark gate) | Smaller uploads, fewer failures on weak networks |
| D7 | C6 | Organic order = newest published first; featured (≤ 6) first, labelled | Simple and not business-controlled |
| D8 | Plan | Before/after pairs: schema and rules only (Soon); face blur: Later | Phase 2 C6/C16 scope table |
| D9 | C1 / M9 D5 | Staff ratings still not shown | Keeps the M8/M9 deferral |
| D10 | Tooling | Test numbers `70 000 015` / `016`; sharp 0.35.5 / blurhash 2.0.5 pinned | Results e2e; reproducible images |
| D11 | Plan M10 benchmark | **Option A (PO decision 2026-09-29):** `p95 < 8 s per image` applies at the production concurrency — 2 jobs per 4-vCPU worker, capped in the worker; the 20-concurrent run is a stress test (0 failures, 0 OOM/timeouts, 0 leaks, correct outputs), not a latency target | 20 CPU-heavy jobs on 4 CPUs measure contention, not the production path; scale out with more workers |

## Known gaps / notes

- **Not run yet**: the labelled image eval and hosted media flow (key on staging, worker hosting).
- The transform worker needs a host (4 vCPU, ≥ 1.5 GB RAM, 2 jobs at a time) — an infrastructure
  dependency added to the M4 checklist. **Cost per 1,000 images**: calculation method in the benchmark
  report; the dollar figure is a deployment-time item once a provider/instance is chosen.
- The 2 result WhatsApp templates must be submitted to Meta with the others.
- Results on the business page follow its 1-minute cache.

## Decisions needed

1. **Result message copy** (EN/AR in [templates.md](../notifications/templates.md)).
2. **Worker hosting** for staging/production (any Docker host, 4 vCPU / ≥ 1.5 GB; the image is
   `apps/media-worker`) — this also fixes the cost per 1,000 images.
3. **Labelled image set**: who supplies ~100–200 licensed/consented photos across hair, nails, beard,
   makeup, irrelevant, memes, screenshots, documents; then run the gate and only then set
   `MEDIA_AUTO_PUBLISH=true`.
