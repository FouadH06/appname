# M3 — Booking engine (headless): report

Status: **closed** (approved 2026-09-28; staging verified) · Branch `m3-booking-engine` → `main` · Gate A: **passed on staging**

Review decisions: D1–D9 approved; D10 recorded at staging verification. Product decisions kept: 3 recent no-shows → requests, 5 → blocked pending admin review; auto-complete 6 h after end; default assignment least booked that day; manual bookings bypass online notice/horizon/grid; late-cancel penalty only for confirmed bookings; undoing a no-show adds a correcting event.

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| Bookings | `bookings` (header, 8-char Crockford ref, immutable `source`, idempotency key), `booking_items` with **THE exclusion constraint** `(staff_id, occupied)`, `booking_events` (append-only), `private.booking_transitions` (17 allowed transitions), `private.access_tokens` | Part 3 §1 |
| Status machine | `private.assert_transition` (actor-specific) + `bookings_status_guard` trigger (rejects any unlisted change for every caller; owns timestamps, expiry, hold fields) + `sync_blocks_time` (cancelled/no-show release time) | Part 3 §1.4, §4.7 |
| **Review requirement** | CHECK `status <> 'pending' or expires_at <= starts_at`; confirm sets `least(now() + request expiry, starts_at)`; reschedule re-bounds; accept rejects after expiry; job cancels at expiry | M2 review |
| Availability engine | `staff_service_terms`, `local_instant` (IANA/DST-safe), `staff_working_time` (override → weekly effective-dated ∩ location hours − closures), `staff_busy_time` (ignores expired holds), `staff_time_off_time`, `staff_free_time` (multiranges), `candidate_staff` (**the single place** `publicly_bookable` is enforced), `compute_slots` (one engine) | Part 3 §2 |
| Public / business reads | `get_available_slots`, `get_available_days`, `get_next_available` (anon + authenticated; no staff ids in Any mode), `biz_get_available_slots` (members; includes internal-only staff) | Part 3 §2.4–2.5 |
| Assignment | `rank_free_staff` with all four rules (least booked [default], priority, round robin, minimize gaps); the exclusion constraint decides the actual winner | Part 3 §3 |
| Customer RPCs | `create_hold` (anonymous-auth visitors, rate-limited, one active hold per user), `extend_hold`, `release_hold`, `change_hold_staff`, `confirm_booking` (token proves ownership, reliability gates, limits, explicit-claim-safe customer record, idempotent), `cancel_my_booking` (late-cancel rule), `reschedule_my_booking` | Part 3 §4.1–4.3, 4.5–4.6 |
| Business RPCs | `create_manual_booking` (phone/shadow, walk-in, internal-only staff, outside-hours override, price/duration override, log after the fact), `accept_request`, `decline_request`, `biz_cancel_booking` (reason required for customer bookings), `biz_reschedule_booking`, `reassign_booking_item` (**forced notify** for specific/rebook), `mark_completed(_bulk)`, `mark_no_show` (24 h window), `undo_no_show`, `update_booking_note` | Part 3 §4.4 |
| Reliability | `private.reliability_events`, `customer_reliability`, recompute (180-day window, 60-day half-life, completed credit capped at 1.0), tiers, `customer_reliability_label` (coarse label; only for businesses that have the customer) | Part 2 §2.4 |
| CRM cache | `recompute_business_customer_stats` (recomputed, never incremented) | Part 3 §5 |
| Jobs (pg_cron) | expire holds (1 min), expire requests (1 min), auto-complete (5 min), nightly (reliability decay, rate-limit and token cleanup) | Part 3 §6 |
| Audit | Composite-key fix: UPDATE diffs carry `_key` (M2 limitation closed) | M2 report |

## Migrations created

| File | Contents |
|---|---|
| `20260929100000_m3_audit_composite_keys.sql` | `audit.capture` records full composite keys |
| `20260929100100_m3_bookings.sql` | Bookings, items (exclusion constraint), events, transitions, status guard, access tokens, RLS |
| `20260929100200_m3_reliability.sql` | Reliability events, tiers, coarse label |
| `20260929100300_m3_availability.sql` | Availability engine, public/business wrappers, assignment ranking |
| `20260929100400_m3_booking_rpcs.sql` | All booking RPCs, concurrency helpers, CRM stats |
| `20260929100500_m3_jobs.sql` | Scheduled jobs + pg_cron schedules |
| `20260929100600_m3_slots_grid.sql` | Availability grid built once per request (H6, found on staging) |
| `20260929100700_m3_service_role_execute.sql` | Explicit `service_role` EXECUTE on public RPCs so local = hosted (D10) |

## Tests executed

### pgTAP (transactional, local + CI): **315/315** (114 new in M3)

| Suite | Tests | Proves |
|---|---|---|
| `120_booking_schema` | 19 | Exclusion constraint (overlap, back-to-back, other staff, holds blocked, cancelled frees, buffers protected), occupied/selection checks, **pending expiry ≤ start**, hold token, status guard (no revival, no → held), immutable source/events, ref format, audit composite key |
| `130_availability` | 21 | Split shifts + buffer arithmetic (24 slots), overrides clipped to opening hours, day off, time off, closures (end exclusive), busy time, expired holds ignored, effective-dated hours, **non-leak** (Any excludes senior + internal-only; internal-only has no public slots/next-available), minimum notice, `any_only`, business wrapper membership, **DST** (09:00 Beirut = 07:00 UTC the day before, 06:00 UTC on the switch day, same 30 slots) |
| `140_booking_rpcs` | 46 | Anonymous hold → sign-in → confirm by token; one hold per user; off-grid; internal-only not holdable; idempotent confirm; SLOT_TAKEN vs specific Maya; change staff on hold; **request expires at start**; accept; restricted → request; blocked rejected; manual shadow; internal staff; outside hours + override; claimed relationship auto-links; **shadow never merged, attribution inherited, duplicate flagged**; forced notify on reassign; late cancel + reliability; reason required; atomic reschedule frees old slot; busy target rejected; complete/no-show windows; staff own vs colleague; cross-business and customer access denied |
| `150_state_machine` | 4 | All 144 (from × to × actor) combinations match the table exactly |
| `160_reliability` | 13 | One no-show never labels; decay; forgiveness; restricted/blocked thresholds; capped credit; label only for businesses with the customer; raw history unreadable |
| `170_booking_rls` | 11 | Reception sees the business's bookings and events; staff only their own; other business, customer (direct), anon see nothing; no direct writes; anon can't hold |

### Concurrency / fuzz / performance harness (`packages/db-tests`, parallel connections)

| Scenario (Part 7 §4) | Result (local, full Gate A size) |
|---|---|
| #21 20 parallel holds, one staff member | ✅ **100/100 runs**: exactly one winner |
| #22 "Any", 3 free staff, 8 parallel holds | ✅ **100/100**: exactly 3 winners, 3 distinct staff |
| #23 manual booking vs online hold, same staff/time | ✅ **100/100**: exactly one |
| #24 two parallel reschedules into one slot | ✅ **100/100**: one wins |
| #26 5 parallel confirm retries, same idempotency key | ✅ all return the same booking |
| #25 **fuzz**, 10,000 random RPC operations × 5 seeds, 4 parallel workers | ✅ **0 overlaps** (checked every 250 ops), **0 unexpected errors**, 0 null staff; ~1,500–1,800 items per seed |
| Spike S4: 8 staff, 1,920 bookings in the business, ~10k items in the DB, 100 samples | ✅ database time: `get_available_slots` 14 days Any **p95 16.0 ms** (117.9 ms before H6); `create_hold` **p95 7.6 ms** |

CI runs the harness at reduced sizes (25 runs, 2k ops × 2 seeds, 30 perf samples) on every push.

**How latency is measured.** Each perf sample records the **database time** (`EXPLAIN ANALYZE` planning + execution, which is what Gate A targets) and the **client round trip** (begin → claims → call → commit). Gate A ceilings apply to database time. On Docker Desktop for Windows the round trip carries port-proxy and VM disk noise: right after the 50k-op fuzz run, `create_hold` round-trip p95 reached ~417 ms while its database time stayed at 7.5 ms (commit flushes competing with post-fuzz write-back); on an idle DB the round trip is 13 ms. The round trip has a loose ceiling (1.5 s) to catch disasters. The hosted round trip is measured in the staging latency check at close.

### Gate A checklist (Phase 4 M3)

- [x] Fuzz: 0 overlaps and 0 null staff across 10k random operations, 5 seeds
- [x] Concurrency tests pass 100/100 runs
- [x] p95 `get_available_slots` (14 days, 8 staff) < 150 ms: **25.1 ms on staging** (database time; 16.0 ms locally)
- [x] p95 `create_hold` < 100 ms: **12.6 ms on staging** (database time; 7.6 ms locally)
- [x] No public RPC returns internal-only staff (non-leak tests)

## What the harness caught (and the fixes)

| # | Finding | Fix |
|---|---|---|
| H1 | **Exclusion-constraint deadlocks** under parallel "Any" holds: concurrent conflicting inserts wait on each other, and Postgres kills one after 1 s (`40P01`). The constraint still prevented every double booking, but callers got a raw error instead of the next free staff member | Per-staff advisory lock taken **inside** the sub-transaction of each write that claims staff time (released on failure, so no lock cycles); `deadlock_detected` caught as a backstop |
| H2 | Parallel confirm retries with the same key returned `HOLD_NOT_FOUND` to the losers | `confirm_booking` re-checks the idempotency key after losing the race |
| H3 | Fuzz: parallel manual bookings for the **same new phone** raced to create the shadow customer (`23505`) | Atomic `INSERT … ON CONFLICT DO NOTHING` + re-read, for shadows and for the user's own record in `confirm_booking` |
| H4 | Perf: `get_available_slots` p95 **7.3 s**. Postgres inlined a single-use CTE and recomputed per-staff free time for every grid row | `WITH … AS MATERIALIZED` → **118 ms** (62×) |
| H5 | Perf on a loaded DB (after fuzzing): busy-time, hold-cleanup and minimize-gaps lookups filter `blocks_time` only, so the exclusion constraint's **partial** index (`blocks_time and not allow_overlap`) can't serve them and Postgres scanned each staff member's whole booking history. Fast when empty, degrades linearly with volume | Index `booking_items_busy_gist (staff_id, occupied) where blocks_time`, plus an index-usable overlap predicate in the gap query. Verified with `EXPLAIN`: index-only scans |
| H6 | **Staging Gate A** (smaller shared ARM compute): `get_available_slots` p95 **195.5 ms**, over the 150 ms target. `compute_slots` built the local-time grid per staff member through `private.local_instant()`, which can't be inlined (its `SET search_path` clause), so 8 staff × 14 days × 96 slots paid ~10.7k function calls with a configuration change each | Grid built once per request with the same (DST-safe) expression, then checked per staff member. Identical results (hash-compared); **p95 25.1 ms on staging** (7.8×), 16.0 ms locally |

## Deviations from the Phase 3 specification

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | Part 3 §4.7 `apply_transition` | `assert_transition` + status-guard trigger; each RPC does one UPDATE | Row CHECKs (e.g. held ⇔ token) must hold after a single write; the trigger is a safety net for every caller including service_role |
| D2 | Part 3 §4 concurrency | Advisory locks + deadlock handling (H1), idempotent retries (H2), atomic find-or-create (H3) | Found by the harness; the constraint stays the final arbiter |
| D3 | Part 3 §2.3 | Materialized per-staff CTE (H4); busy-time GiST index (H5) | Performance (Gate A) |
| D4 | Part 3 §4.3 step 11 (enqueue notifications) | RPCs record `notify` in `booking_events.data`; M7 derives the outbox from events in the same transaction | M3 RPCs won't change when messaging lands |
| D5 | Scope | Deferred: customer read models (`get_my_bookings`/`get_my_booking`) → M8, `contest_no_show` → M8/M9 (needs `disputes`), waitlist → Soon, claim RPCs → M4 | Belong to the milestone that uses them |
| D6 | Part 3 §3 tie-break | Deterministic (`staff_id`) instead of `random()` | Reproducible tests and support investigations |
| D7 | Part 3 §4.5 late cancel | Late-cancel penalty applies to **confirmed** bookings only (withdrawing a pending request is never "late") | Fairness; the request wasn't accepted yet |
| D8 | Part 3 §4.4 undo | `undo_no_show` adds an exact compensating `forgiven` event (same timestamp) rather than deleting history | Auditable reliability history |
| D9 | Error codes | Added `OUTSIDE_HOURS`, `REASON_REQUIRED`, `NOT_SUPPORTED`, `INVALID_PHONE`, `NOT_FOUND`, `IMMUTABLE_FIELD` | Distinct UI messages |
| D10 | Part 1 §6.1 grants | `service_role` gets EXECUTE on public RPCs explicitly (grant + default privileges) | Hosted Supabase grants it by default and local didn't (found by the staging fingerprint). Same rule as the approved M1 table-grant fix: local = hosted. Booking RPCs still need a user, so a bare service_role call gets `AUTH_REQUIRED` |

All are recorded in the Phase 3 Part 3 amendments box and the decision log.

## Staging verification (hosted project `oplwsnpyavnqnhlzyhxr`)

| Check | Result |
|---|---|
| Migrations applied (6 M3 + 2 found at verification) | ✅ `db push`, dry run reviewed first |
| Full hosted pgTAP | ✅ **315/315** (includes non-leak, DST, RLS suites) |
| Hosted races (`scripts/hosted-booking-smoke.py`), 10 rounds each, real parallel backends | ✅ #21 20 holds → 1 winner **10/10** · #22 Any, 3 free, 8 holds → 3 distinct staff **10/10** · #23 manual vs online **10/10** · #24 parallel reschedules **10/10** · #26 confirm retries **10/10** · 0 overlaps, 0 null staff |
| Internal-only staff non-leak (logged-out Data API) | ✅ Any-mode slots carry no staff ids; internal-only id → no slots, next-available null, never in staff listing; business RPC denied |
| Logged-out/API security smoke | ✅ `hosted-smoke.sh` 11/11 + 10 booking checks (no reads of bookings/items/events, anon `create_hold` denied, private helpers not exposed) |
| Schema fingerprint hosted = local | ✅ identical, 11 sections (after D10; the fingerprint's grant list is now sorted, it was hashed in grant order) |
| Test residue | ✅ every table count equals the pre-run snapshot; `data-residue.sql` all zero; no cron jobs, run logs or scratch schema left |

**Hosted latency** (8 staff, 1,920 bookings, 30 samples each):

| Function | Database time p50 / p95 | Real round trip from the dev machine (Data API) p50 / p95 |
|---|---|---|
| `get_available_slots` 14 days, Any | 24.1 / **25.1 ms** | 143.5 / 455.6 ms (logged out, measured directly) |
| `create_hold` | 9.5 / **12.6 ms** | ≈ 110–175 ms (derived, see below) |
| `confirm_booking` | 3.7 / **8.2 ms** | ≈ 105–170 ms (derived, see below) |
| Baseline: tiny table read | n/a | 99.5 / 161.3 ms |
| Baseline: RPC rejected by grants | n/a | 96.4 / 109.8 ms |

The round trip is dominated by network and API overhead (~100 ms from this machine to eu-central-1, even for a request that does no work). `create_hold` and `confirm_booking` need a signed-in user; staging has anonymous sign-ins disabled and the verification doesn't create Auth accounts, so their round trip is **derived** (measured API baseline + measured database time). It will be measured directly once a real client signs in (M5/M8). The 455 ms p95 on `get_available_slots` is network variance; the baseline read's tail moved the same way in that run.

How the hosted harness works: fixture data is created as `postgres` through the CLI (no DB password, no service-role key). Customers are simulated with JWT claims inside the transaction, as pgTAP does. Contenders run as one-shot `pg_cron` jobs, so each gets its own backend: parallel CLI logins rotate the temporary login role and trip the pooler's auth circuit breaker, which happened once and cleared on its own. Perf work is rolled back. Everything else is deleted afterwards (append-only leaf rows via `session_replication_role = replica`) and checked against a pre-run snapshot. A power cut interrupted one run after fixture setup; `--cleanup-orphans` removed its data and staging was confirmed back at the exact baseline before the final run.

## Suggested manual checks

1. **Reliability thresholds** (score = recency-weighted no-shows 1.0 / late cancels 0.4, 60-day half-life): 1 no-show → still "new/reliable"; 2 recent → "some missed"; 3 → online bookings become requests; 5 → blocked (admin review). Are the restricted/blocked levels right for Lebanon?
2. **Auto-complete** runs 6 h after an appointment ends (business setting). That's what opens review eligibility if reception never marks it.
3. **Default assignment rule** for "Any available" is *least booked that day*. Salons can switch to priority, round robin or minimize gaps.
4. **Manual bookings** skip online rules (minimum notice, horizon, grid) on purpose. Reception can log walk-ins and after-the-fact visits from earlier today.
5. **Error codes** (`SLOT_TAKEN`, `STAFF_NOT_FREE`, `OUTSIDE_WINDOW`, …) become customer and reception messages in M5/M8. The full list is in Phase 3 Part 3 §1.6 plus D9.
