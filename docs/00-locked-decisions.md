# APP_NAME — Locked Decisions (Phase 1 → Phase 2)

Status: **LOCKED** (2026-09-27). Changes require an explicit decision entry at the bottom.

## Product thesis
Lebanon-first **Discovery + Trust + Booking + Business Management** for appointment-based services.
Launch vertical: Beauty & Grooming (hair salons, barbers, nail salons, beauty centers, makeup, lash/brow, spas).
Aesthetic/laser: added carefully after the core flow works.

MVP must answer two questions only:
- **Consumer:** can we help users discover, trust and book more easily than Instagram + WhatsApp?
- **Business:** will businesses use our calendar and booking tools every day?

## Naming
- Working name placeholder: `APP_NAME` everywhere (code, copy, routes). Public URL placeholder: `platform.com/{business-slug}`.

## Launch geography
| Cluster | Areas | Target supply |
|---|---|---|
| 1 | Achrafieh / Mar Mikhael | 15–25 businesses |
| 2 | Hamra / Verdun | 15–25 businesses |
| 3 | Hazmieh / Baabda | 15–25 businesses |
| Next | Jounieh / Kaslik | after model is proven |

50–70 quality businesses before serious customer acquisition. Outside clusters, the product says so honestly instead of showing empty results.

## Sequencing
1. **Public customer web booking** (acquisition product) + **Business Dashboard** — first.
2. **Expo customer app** (retention/discovery product) — immediately after.
- No app download required for a first booking. Flow: business link → service → staff preference (Any available [default] / Choose someone) → date & time → verify phone → book.
- Post-booking: encourage app for rebooking, favorites, notifications, discovery.

## Reviews & trust
- Verified-only at launch. **No booking → no review.**
- **Verified Booking** = marketplace/customer-initiated booking + completed. Weight 1.0.
- **Verified Visit** = business-created booking + customer OTP-confirms phone ownership + completed. Weight 0.5, capped at 40% of a business's total review weight.
- One review per booking. Customer can delete own review. Business cannot delete; can reply or report.
- Customers can dispute a false no-show; a pending dispute does not block the review.
- Ratings, text, and each image are moderated independently.
- Reviewers shown publicly as first name + last initial. Business CRM does not link reviews to customer records.

## Customer Results
- Two distinct concepts: **Business Portfolio** (business-controlled) and **Customer Results** (customer-uploaded after verified visits).
- Business may report, reply to the linked review, feature an approved result. Business may NOT delete, hide, or reorder the organic feed.
- Result-photo discovery ("search balayage → see real results → Book Similar") is architected now, ships later. Every result stores: canonical service, business, location/area, staff, price snapshot, booking date, trust tier.

## Ranking
- Internal: Bayesian weighted rating + volume + recency + reliability + completeness + responsiveness; versioned `RankingConfig`, editable in Admin.
- Public: **no leaderboards** ("#1 salon"). Only discovery labels: Top Rated, Highly Rated for Cleanliness, Great Punctuality, Popular Near You, Available Today, Best Value, New on APP_NAME.
- Sponsored placement (later) is always labeled and never feeds organic ranking.

## Calendar = source of truth
- Manual appointment creation must take seconds: Phone/Customer → Service → Employee → Time → Save.
- Manual bookings block availability exactly like online bookings (same exclusion constraint).

## Staff (first-class)
- Customers are never forced to choose a worker. Two modes: **Any Available** (default, "Recommended for fastest booking") and **Choose Someone**.
- Any mode: slots = union across eligible staff who accept automatic assignment; on time selection the server assigns one concrete staff member by business rule (least booked that day [default] · round robin · priority order · minimize gaps) and shows "You'll be with {name}" before confirmation.
- Every booking item always has a concrete `staff_id` (NOT NULL). Selection mode is recorded (`any` / `specific` / `rebook` / `business`).
- Returning customers get "Book again with {staff}". Staff favorites architected now (People + Places favorites), UI ships Soon.
- StaffMember connects to Business, BusinessLocation(s), Services (with duration/price overrides), schedules (weekly hours, overrides, days off, breaks, time off), Bookings, Reviews, Customer Results, Favorites.
- Business calendar views: all staff columns · selected staff columns · one staff (day/week) · merged agenda.
- Visibility flags: `publicly_bookable` (customer can see/choose online; false = internal-only, never in any public API, still fully usable in dashboard) is independent from `accepts_any_assignment`; the combination `publicly_bookable=false AND accepts_any_assignment=true` is invalid.
- Staff rating shown only at ≥5 verified reviews; specialties max 3, chosen from services the staff member actually performs.

## WhatsApp
- Deep notification/communication layer, not a dependency. Channel router: push → WhatsApp → SMS (email for business/admin where useful).
- Customer: confirmation, reminder (Confirm/Cancel), reschedule link, review request, waitlist availability.
- Business: new booking, cancellation, new review, important schedule changes.

## Reliability
- Internal score, recency-weighted (rolling window with decay), forgiving of a single incident.
- Businesses see only: **New Customer · Reliable · Some Missed Appointments**. Never where/when other misses occurred.

## Monetization
- Launch: customers free, businesses free. No payments/subscriptions implemented.
- Architecture preserves: `plans`, `subscriptions`, `entitlements`, booking `source` attribution, `payment_status`, sponsored placement slots.

## Engineering posture
- Solo product owner + heavy AI-assisted development. Lean: one Supabase project, Postgres-first logic, Edge Functions only for external I/O, no microservices.
- Non-negotiable: data model, RLS, booking concurrency (exclusion constraints), availability engine, permissions, moderation, audit logs, data security.
- Monorepo: `apps/web` (public + booking + business dashboard `/biz`), `apps/admin` (separate deploy), `apps/mobile` (Expo); `packages/db|core|api|i18n|ui-web`.

## Decision log
| Date | Decision |
|---|---|
| 2026-09-27 | Phase 1 architecture locked with decisions 1–4 and A–J above. |
| 2026-09-27 | Staff-selection system made explicit (Any Available default / Choose Someone; assignment at hold time; staff favorites; staff as first-class entity). Staff belong to Business with many-to-many BusinessLocation assignment; services owned by Business (refines Phase 1 "services hang off location"). |
| 2026-09-27 | Phase 2 approved. `is_public` renamed `publicly_bookable`. Phase 3 schema written (docs/phase-3/01-07); awaiting review. |
| 2026-09-27 | Phase 3 approved with three changes: (1) **explicit claim model**: phone verification never links history; claim via secure token + OTP on that phone, older visits only after customer confirmation, 12-month limit, safe merge, no auto-merge on online booking (acquired_via inherited). (2) **Event-driven rating publication**: synchronous fraud pre-check; ratings publish independently of text; quarantined/under-investigation ratings are never displayed or counted (single `rating_is_counted` predicate). (3) **Provider-independent image processing**: `ImageProcessor` worker contract (Edge Function or external worker), staging bucket; choice decided by the Phase 4 benchmark. |
| 2026-09-27 | Phase 4 roadmap proposed (docs/phase-4/01-implementation-plan.md): risk-first order, headless booking engine before UI, business pilot before customer web, Gates A–D. |
| 2026-09-27 | Phase 4 approved. M7 + M8 are developed in parallel with the M6 salon pilot; Gate B still blocks broad public booking. Milestone protocol: implement → test → fix → report (built / deviations / results) → approval. Project root `C:\Projects\APP_NAME`, docs in-repo. |
| 2026-09-27 | **M1 deviation (implementation detail, architecture unchanged):** SECURITY DEFINER functions owned by `app_owner` can't use `auth.uid()`/`auth.jwt()`, because the Supabase migration role has no grant option on the `auth` schema (the GRANT is silently ignored). `private.jwt()`/`private.uid()` read the same request GUCs directly; all definer functions use them (enforced by a hygiene test). RLS policies may still use `auth.uid()`. Phase 3 Part 1 §7 amended. |
| 2026-09-29 | **M3 implemented (awaiting review).** Booking engine per Part 3 with amendments: status guard trigger + `assert_transition`; per-staff advisory locks inside write sub-transactions (exclusion-constraint deadlocks found by the concurrency harness); idempotent confirm under parallel retries; atomic find-or-create of customer records (found by fuzzing); materialized per-staff CTE (availability p95 7.3 s → 118 ms); busy-time GiST index `where blocks_time` (the exclusion constraint's partial index can't serve availability lookups); notifications derived from `booking_events` in M7; read models → M8, `contest_no_show` → M8/M9, waitlist → Soon. Pending-request expiry bounded by start (CHECK). Local Gate A: 100/100 races, 0 overlaps in 10k ops × 5 seeds, p95 database time: slots 117.9 ms, holds 7.5 ms. |
| 2026-09-28 | **M8 approved and closed.** D1–D11 approved. Added before merge: customer reschedule with Any available (preview shows the assigned person; confirm re-checks and moves atomically; internal-only staff → contact the business). Kept: 1-minute page cache with live booking rules in the flow; English-first customer UI (Arabic/RTL extraction follow-up); terms/privacy placeholders until the legal gate. Hosted M4–M8 verification, slow-4G performance test and in-app browser matrix remain mandatory before real users. |
| 2026-10-04 | **M8 implemented (awaiting review).** Public business page (server-rendered, 1-minute cache, 301 for old slugs, no internal staff anywhere), booking flow (Any available default, rebook shortcut, auto-skip, holds with countdown, phone code, request mode), success + booking detail (calendar, directions, reschedule with same staff, cancel with late warning, no-show contest → disputes), My bookings with claim prompt, WhatsApp link → manage. Deviations D1–D11 in the M8 report. pgTAP 636/636; web e2e 15 (phone funnel). Gate B still blocks broad public launch; hosted M4–M8 verification deferred. |
| 2026-09-28 | **M7 approved and closed.** D1–D9 approved. Reception receives new booking / request / customer cancellation alerts by default (management alerts stay owner/manager-only). Quiet hours 22:00–08:00 (location time zone): only reminders are affected — 24 h moves to the end, 2 h inside is skipped; team alerts wait unless time-sensitive. Final copy approved: Change / Cancel quick reply (never cancels directly), customer cancellation acknowledgement, "Your request expired", Arabic with Latin digits and Levantine months. Hosted M4–M7 verification remains a mandatory pre-real-user gate. |
| 2026-10-03 | **M7 implemented (awaiting review).** Notifications outbox driven by booking events; `notify-dispatch` (pg_cron → Vault → pg_net) with WhatsApp templates (EN + AR, Confirm / Cancel on reminders) and SMS fallback for critical booking messages; reminders 24 h / 2 h with reschedule/cancel handling; receipts with receipt-driven SMS retry; Confirm button with phone match; preferences (one channel stays on); team alert settings; delivery-failure alert; ops delivery report. Deviations D1–D9 in the M7 report. pgTAP 603/603; edge unit 45; web e2e 14 (real dispatcher + signed webhook). Real delivery needs the Meta/Twilio accounts (external). Hosted verification deferred with M4–M6. |
| 2026-09-28 | **M6 approved and closed.** D1–D11 approved. Added before merge: privacy-safe Gate B creation timing (drawer opened → saved, role, customer kind, flow; no customer data) with an ops median report. Kept: Agenda default on phones (Day · Single available); reception may block time; no broad customer search for staff; customer-caused cancellations only; mobile swipe/long-press/resize deferred; notification sending in M7. Hosted M4–M6 verification remains a mandatory pre-real-user gate. |
| 2026-10-02 | **M6 implemented (awaiting review).** Calendar (Day · Columns / Single / Week / Agenda; all / several / one staff), appointment drawer with walk-ins and the speed targets (existing customer 4 interactions, new 5), drag-to-move with notify prompt, reassign, block time, affected-booking flows, bookings list with requests, customer detail, staff booking history, lean overview, Realtime. Deviations D1–D11 in the M6 report, notably Realtime also on `bookings` (D1) and customer cancellations only in CRM stats (D2). pgTAP 550/550; web e2e 13. Hosted verification deferred with M4/M5. |
| 2026-09-28 | **M5 approved and closed.** D1–D10 approved. Adjustments before merge: "Open" defaults to 9:00–19:00; the owner's own staff profile uses their real name (the wizard asks for it; blank names rejected). Kept: cover photo + priced online service with a performer required to go live; ops' temporary manager access ends when the owner accepts; pausing online booking keeps the profile visible; OpenStreetMap for now (production tile provider decided pre-launch); dashboard English-first, RTL/i18n-ready. Hosted M4 + M5 verification remains a mandatory pre-real-user / pre-launch gate. |
| 2026-10-01 | **M5 implemented (awaiting review).** Business dashboard shell, B1 wizard (assisted + owner), services, staff (schedules, overrides, time off, access), settings, basic customers, minimal A4 create business. Deviations D1–D10 in the M5 report, notably media tables brought forward from M10 (D1) and ops as a temporary manager during assisted onboarding (D2). pgTAP 497/497; onboarding e2e green. Hosted verification deferred with M4's. |
| 2026-09-28 | **M4 approved and closed; hosted staging verification DEFERRED (not cancelled).** D1–D9 approved. Merged on local + CI coverage because a tooling issue blocked hosted work. Staging Turnstile will use Cloudflare's official test secret until the staging web app has a domain. The deferred hosted checklist (M4 report) must be completed before any real users or launch. Real WhatsApp/SMS delivery is an external launch dependency and doesn't block M5. |
| 2026-09-28 | **M4 implemented (awaiting review).** Providers per review: WhatsApp Cloud API primary, Twilio SMS fallback, both behind `OtpChannel`; Cloudflare Turnstile (official test keys locally/CI). Explicit claim model, invitations, OTP routing, access summary, account-deletion skeleton, auth UI and pages; 429 pgTAP, e2e against the local stack. Deviations D1–D9 in the M4 report, notably **D2** (admin TOTP needs an account email) and **D3** (SMS fallback limited to allowed country prefixes). |
| 2026-09-28 | **M3 approved and closed.** D1–D9 approved. Product decisions kept: 3 recent no-shows → requests, 5 → blocked pending admin review; auto-complete 6 h after end; default assignment least booked that day; manual bookings bypass online notice/horizon/grid; late-cancel penalty only for confirmed bookings; undo no-show adds a correcting event. Staging (`oplwsnpyavnqnhlzyhxr`): 315/315 pgTAP, hosted races 10/10 × 5 scenarios, non-leak and API smoke pass, fingerprint identical, zero residue. Gate A on staging (database time p95): slots 25.1 ms, hold 12.6 ms, confirm 8.2 ms. Found at verification: H6 availability grid built once per request (staging p95 195 ms → 25 ms); **D10** explicit `service_role` EXECUTE on public RPCs (hosted default; same rule as M1 tables). |
| 2026-09-28 | **M2 approved and closed.** D1–D8 approved/recorded. Staging (`oplwsnpyavnqnhlzyhxr`): 201/201 pgTAP, 11/11 API smoke, schema fingerprint identical. D8: slug CHECKs on citext now cast to text (operator binding differed by DDL search path). Reserved slugs extended per review. M3 requirement: pending-request expiry bounded by appointment start. |
| 2026-09-28 | **M2 spec corrections (bug fixes, design unchanged):** (1) NULL-unsafe CHECKs in Part 2 (`services` range price, `staff_schedule_overrides` working hours) let invalid rows through, because a NULL CHECK passes; they now guard with IS NOT NULL. (2) `staff_services` override shape made NULL-safe. (3) `staff_weekly_hours` and `staff_schedule_overrides` gain FK `(staff_id, business_id)` so the RLS-relevant `business_id` can't disagree with the staff member's business. Part 2 amended. |
| 2026-09-28 | **M1 staging verification passed** (hosted project `oplwsnpyavnqnhlzyhxr`): `app_owner` model works on hosted Supabase; 101/101 pgTAP; 11/11 anon API smoke; schema fingerprint identical to local. Staging revealed hosted grants `service_role` DML on `public` tables by default → now explicit in migration `20260927211000` so local = hosted (consistent with Part 1 §6.1; audit/private remain closed). |
| 2026-09-27 | M1 sequencing (plan, not spec): business-membership helpers (`has_business_role`, `my_business_ids`, `my_staff_id`, `my_staff_ids`) and `catalog_suggestions` move to M2 because they reference M2 tables. |
| 2026-09-27 | M0 tooling (not a spec change): runtime Node 24 LTS (CI + .nvmrc); TypeScript pinned to 6.0.x because typescript-eslint supports < 6.1 (TS 7 native compiler lacks the JS API that Next.js/typescript-eslint use); Supabase local `auto_expose_new_tables = false` and `max_rows = 200` to match Phase 3 Part 6. |
| 2026-10-05 | **M9 implemented (awaiting review).** Verified reviews (one per completed booking, tier frozen: verified booking 1.0 / verified visit 0.5), stars published at once after the in-transaction fraud pre-check (new account, shared device → quarantine), comments and business replies moderated separately by the `moderate` worker (rules → language detection incl. Arabizi → classifier → decision matrix; personal data redacted; insults at a person / unsure → human), nightly duplicate-text + burst detectors, reports (→ moderation case or attendance dispute), minimal admin queue/case, on-demand translations, review request 2 h after completion (quiet hours respected). Classifier: Claude via the official SDK, default `claude-opus-5` (model/cost = PO decision); without a key the keyword classifier runs in strict mode on hosted projects (held-out recall 18.8 %). Deviations D1–D11 in the M9 report. pgTAP 713/713; web e2e 16; admin e2e 1. Pre-existing time-of-day test failures in `240_calendar` and the M8 public-booking e2e diagnosed and fixed. |
| 2026-09-29 | **M9 approved in principle.** Review copy approved; team alert shows the star rating. No LLM key → strict: the keyword classifier never publishes a comment on hosted/staging/production (explicit rejects may reject; everything else → moderator; stars follow their own rules). Moderation model: Claude Sonnet 5 default, benchmarked with the eval gate (0 harmful blind held-out comments auto-published; unsure/refused → human; benign hold-back acceptable); Opus 5.5 only if Sonnet fails and it materially improves. `LLM_MODEL` configurable. LLM auto-publication stays off (`MODERATION_AUTO_PUBLISH`) until the gate passes on the expanded blind set (150 held out). Anthropic key: set by the PO as a Supabase secret, never in chat or Git. Hosted M4–M9 verification mandatory before real users. |
| 2026-09-29 | **M9 closed.** Branch CI green on `8109fcb` (run 36563218311), merged to `main` as `f60b69c`, main CI green (run 36564134608). Moderation defaults kept: keyword classifier never auto-publishes outside local development; Sonnet 5 is the default configurable LLM; `MODERATION_AUTO_PUBLISH` stays false until the blind evaluation passes the zero-harmful-publication gate — an API key alone never enables automatic publication. M10 started on `m10-media`. Hosted M4–M9 verification mandatory before real users. |
| 2026-09-29 | **M10 implemented (awaiting review).** Image benchmark: Edge Functions fail (51 % decode, `WORKER_LIMIT`) → external transform worker (`apps/media-worker`, Node + sharp/libvips + libheif for HEVC HEIC, Docker); benchmark workflow gated on all criteria (100 % eligible decode incl. HEIC, 0 leaks, p95 < 8 s, 0 stress failures). Private-first buckets (nothing public before approval), hash stage in SQL, `media-orchestrator` with Claude vision (`MEDIA_LLM_MODEL` → `LLM_MODEL` → Sonnet 5); `MEDIA_AUTO_PUBLISH=false` until the labelled image eval passes (≥ 90 % automatic decisions correct, 0 falsely public); hosted without a key every photo goes to a moderator. C16 upload with consent, C6 results + detail, B10 featuring (no hide/delete), A3 image case blurred by default. Deviations D1–D11 in the M10 report (D11 = Option A: p95 < 8 s at the production concurrency of 2 per 4-vCPU worker; 20-concurrent run = stress test); result message copy pending. Hosted M4–M10 verification mandatory before real users. |
| 2026-09-29 | **M10 closed.** Approved with D1–D11 (Option A: p95 < 8 s at the production concurrency of 2 per 4-vCPU worker; the 20-concurrent run is a stress test). Branch CI green on `9af192b`, image benchmark green on `c3c049c` (worker unchanged since), merged to `main` as `baca65d`, main CI green (run 36606567164). M11 started on `m11-admin` with a leaner approach toward a real pilot: strong tests for security, permissions, destructive admin actions, RLS and auditability; focused tests while developing; full regression only at the milestone gate; concise docs. |
| 2026-09-29 | **M11 implemented (awaiting review).** Lean admin console: overview, businesses (status incl. suspend with keep/cancel of upcoming bookings, verify placeholder, test flag), customers (reliability internals, forgive, warn/suspend), reviews (quarantine/restore/remove), disputes (evidence, info requests, outcome effects, 7-day default rules), catalog (RPC-only writes), ranking configs (versioned, publish/rollback; scores in M12), unified audit log (PII masked below superadmin), global search. Every mutating admin RPC requires a reason code and writes exactly one audit row; role matrix tested. Deviations in the M11 report. |
| 2026-09-29 | **M11 closed.** Branch CI green on `d6bffe4`, merged to `main` as `63af1c5`, main CI green (run 36614449033). M12 (search & discovery) started on `m12-search`, lean approach: deterministic, explainable ranking from the documented inputs; no ML/embeddings/personalization beyond the spec; focused tests while developing, full regression + ~30 reviewed queries + realistic p95 at the gate. |
| 2026-09-29 | **M12 implemented (awaiting review).** Search documents with trigger-fed refresh; deterministic quality scores (Bayesian with category × cluster prior, decay, Verified Visit cap, volume, reliability, completeness, responsiveness) recomputed nightly and on ranking publish (before the switch); price levels; labels; text relevance is a gate; recommended score from the active config's query weights; next slots precomputed per service; date/time filter bounded to 40 candidates; zero-result log + admin search debugger; web home / search / explore / `/{area}/{category}` / sitemap. No ML, embeddings or personalization beyond "booked here before". Launch-scale search p95 ≈ 34 ms locally. |
