# Phase 4 — Implementation Roadmap & Milestones

Status: proposed (2026-09-27). Builds on the locked Phase 1–3 docs.

---

## 1. How we build

1. **Highest risk first.** The booking engine (availability, concurrency, state machine) and RLS are built and proven **headless** (SQL + tests, no UI) before any screen depends on them.
2. **Business side before customer side.** A salon can use the calendar with manual bookings before any customer ever sees a booking page. That tests the *business question* early, and it makes sure availability data is real by the time customers arrive.
3. **Gates, not dates.** Each milestone has a Definition of Done. Four **gates** (A–D) require real-world evidence before the next phase of work starts.
4. **Vertical slices after the core.** From M5 on, every milestone ships DB → RPC → UI → tests together and is deployed to staging.
5. **AI-assisted, spec-driven.** Every task gives the AI coding tool the relevant doc sections (the context pack in each milestone) and requires tests in the same change. Migrations are small, ordered, and never edited after merge.

### Global Definition of Done (applies to every milestone)

- [ ] Migrations applied cleanly from zero on local and staging (`supabase db reset`); generated TypeScript types committed.
- [ ] All pgTAP tests plus the milestone's new tests pass in CI; schema hygiene tests (RLS on, grants, definer `search_path`) still green.
- [ ] New RPC error codes mapped in `packages/i18n`; no raw DB errors reach the UI.
- [ ] Audit coverage for every new mutating admin/business action.
- [ ] Deployed to staging; smoke-tested on a real phone (375px) and desktop.
- [ ] Docs updated where behavior differs from the spec (decision log entry).

---

## 2. Risk register (what each milestone retires)

| # | Risk | Impact | Retired in |
|---|---|---|---|
| R1 | Double bookings / wrong availability | Businesses abandon the product | **M3** (headless proof + concurrency fuzzing) → Gate A |
| R2 | RLS leaks (cross-tenant data, internal-only staff) | Trust and legal damage | M1–M3 (tests), re-verified every milestone |
| R3 | Reception won't use the calendar (too slow vs notebook) | Availability data is useless | **M6** speed tests + Gate B pilot |
| R4 | WhatsApp Business API approval / template delays | No confirmations or reminders | **Spike S1 starts day 1** (external lead time) |
| R5 | OTP delivery in Lebanon; auth inside Instagram/TikTok in-app browsers | Web funnel conversion collapses | **Spike S2** early, then M4/M8 |
| R6 | Image processing too heavy for Edge Functions | Results feature blocked | **Spike S3** early, formal benchmark in M10 |
| R7 | Availability performance at realistic volume | Slow booking flow | Spike S4 + M3 perf tests |
| R8 | Moderation quality for Arabizi / mixed-language text | Unfair removals or abuse getting through | M9 evaluation set |
| R9 | Supply cold start | An empty marketplace | Ops track (§6), Gate C/D |

---

## 3. Spikes (time-boxed, start in parallel with M0–M1)

| Spike | Goal | Time box | Output |
|---|---|---|---|
| **S1 WhatsApp** | Meta Business verification, WhatsApp Cloud API number, submit EN/AR utility templates (confirmation, reminder with buttons, cancellation, review request, OTP) | Start day 1; approvals run in the background | Approved templates, cost per message, webhook test |
| **S2 Auth in webviews** | Supabase phone OTP via Send SMS Hook routed to WhatsApp, with SMS fallback provider; anonymous sign-in → phone link/upgrade; test inside the Instagram, TikTok and WhatsApp in-app browsers on iOS and Android | 3–4 days | Working prototype page + findings (autofill, cookie/storage behavior, deep links) |
| **S3 Image processing** | Quick feasibility of HEIC/JPEG/PNG/WebP decode, EXIF strip, WebP re-encode, pHash, 3 derivatives in a Supabase Edge Function vs a small external worker (libvips/sharp) | 2–3 days | Go / no-go signal; the formal benchmark stays in M10 |
| **S4 Availability perf** | Run `compute_slots` against synthetic data: 70 businesses × 8 staff × 90 days of bookings | 1–2 days (after M3 core) | p95 timings; indexes confirmed |

---

## 4. Milestones

Rough sizing for one product owner working with AI tools: **S** ≈ 1 week, **M** ≈ 2 weeks, **L** ≈ 3 weeks. These are planning aids, not commitments.

---

### M0 — Project foundation · S

**Goal:** a repo and pipeline where every later milestone is cheap to build, test and deploy.

- **Backend:** Supabase projects (local via CLI, staging, production); migration workflow; seed script skeleton; Edge Functions scaffold; secrets management.
- **Frontend:** Turborepo + pnpm monorepo: `apps/web` (Next.js App Router), `apps/admin` (Next.js), `apps/mobile` (Expo, empty shell), `packages/db` (types), `packages/core` (zod schemas, domain types), `packages/api` (typed RPC client), `packages/i18n` (EN/AR, RTL helpers), `packages/ui-web` (design tokens from Phase 2 Part 1).
- **Tests:** CI runs lint, typecheck, unit tests (Vitest) and pgTAP (`supabase test db`); Playwright scaffold.
- **Edge cases:** reproducible local reset; env separation (no production keys locally).
- **DoD:** push to main → CI green → staging deploy for web/admin; `supabase db reset` works; design tokens render in light/dark; the RTL toggle flips a sample page correctly.
- **Context pack:** Phase 1 §12, Phase 2 Part 1 §2–4, Phase 3 Part 1 §2–4.

---

### M1 — Database foundations · M

**Goal:** the security and identity bedrock.

- **Backend:**
  - Extensions, schemas (`public/private/audit`), **all enums**.
  - Helper functions (`uid`, `has_business_role`, `my_business_ids`, `my_staff_ids`, `is_admin` with aal2, `is_active_customer`, `normalize_phone`, `normalize_digits`, `normalize_text`, `search_key`).
  - `profiles` + `sync_profile_from_auth` trigger (phone sync only, no claims); `admin_users`.
  - Audit framework (`audit.admin_actions`, `audit.entity_changes`, `audit.capture()`, immutability triggers); `rate_limits`.
  - Catalog + areas/clusters tables with **seed data** (Lebanon areas, 3 live clusters, Beauty & Grooming categories, canonical services, synonyms, rating dimensions).
  - Baseline grants and default privileges.
- **Frontend:** none (maybe an internal page listing seeded catalog to eyeball).
- **Tests:** schema hygiene suite (Part 7 §1), phone normalization cases (Lebanese formats, Arabic-Indic digits, foreign numbers), `normalize_text`/`search_key` cases (Arabizi, Arabic variants), audit immutability, `is_admin` requiring aal2.
- **Edge cases:** `unaccent` immutability wrapper; seed idempotency; citext slugs.
- **DoD:** Part 7 tests §1 all green; seed loads in < 10 s; catalog reviewed by you for real Lebanese service names and synonyms.
- **Context pack:** Phase 3 Parts 1, 2 (§1, §3, §4), 5 (§1, §8), 6 (§1–2).

---

### M2 — Business core schema · M

**Goal:** everything a business *is*, with tenancy and RLS proven.

- **Backend:**
  - Businesses, slugs (reserved + history), locations, hours, closures, members, invitations (table), settings, verification placeholder.
  - Service groups, services (price checks), combo items.
  - Staff (`publicly_bookable`, `accepts_any_assignment`, check constraint), `staff_locations`, `staff_services` (overrides, specialty cap), weekly hours (effective-dated), overrides, time off, `staff_stats`.
  - `business_customers` (with `merged_into_id`, `possible_duplicates`), `customer_notes`.
  - Plans/subscriptions placeholders + `has_entitlement` (launch_free).
  - Composite FKs everywhere; column-level grants; RLS policies from Part 6 §3.3; audit triggers.
- **Frontend:** none.
- **Tests:** tenancy/integrity tests (Part 7 §2); RLS per role for these tables (Part 7 §8 subset: cross-tenant, reception can't read time-off reasons, staff sees own rows).
- **Edge cases:** slug collisions with reserved words and other businesses' history; one owner per business; a staff member at a location they're not linked to.
- **DoD:** you can create a full demo business (2 staff with different overrides, split shifts, a closure) purely via SQL fixtures, and all tenancy/RLS tests pass for owner, manager, reception, staff, other-business member, customer, anon.
- **Context pack:** Phase 3 Part 2 (§2, §5–8), Part 6 §3–4, Part 7 §2, §8.

---

### M3 — Booking engine (headless) · L · ⚠ highest risk

**Goal:** prove that availability and bookings are *correct* under concurrency before any UI exists.

- **Backend:**
  - `bookings`, `booking_items` (**exclusion constraint**), `booking_events` (immutable), `booking_transitions`, blocks_time sync trigger, access tokens.
  - Availability engine: `staff_service_terms`, `staff_working_time`, `staff_busy_time`, `staff_free_time`, `candidate_staff`, `compute_slots`, `get_available_slots`, `get_available_days`, `get_next_available`, `biz_get_available_slots`.
  - Assignment: `rank_free_staff` (least_booked + priority now; round_robin + minimize_gaps behind a flag).
  - RPCs: `create_hold`, `extend_hold`, `change_hold_staff`, `release_hold`, `confirm_booking` (customer checks, idempotency, shadow non-merge rule), `create_manual_booking`, `accept_request`, `decline_request`, cancel (customer/business), reschedule (both), `reassign_booking_item`, `mark_completed(_bulk)`, `mark_no_show`, `undo_no_show`, `apply_transition`.
  - Reliability events + `customer_reliability` recompute + label function; CRM stats recompute.
  - Jobs: expire holds, expire requests, auto-complete (pg_cron).
- **Frontend:** none. A throwaway **"engine console"** page in `apps/admin` (dev-only) to click through holds/bookings visually is allowed.
- **Tests:**
  - Part 7 §3 (availability incl. DST and the **public non-leak** of internal staff), §4 (concurrency harness in TypeScript: parallel holds, Any-mode distinct staff, manual vs online races, reschedule races, **10k-operation fuzz**), §5 (state machine exhaustive matrix), reliability basics.
  - Spike S4 performance run.
- **Edge cases:**
  - buffers crossing shift boundaries
  - a service longer than the remaining shift
  - a closure spanning a DST change
  - a hold confirmed after an anonymous → existing-account switch
  - expired-but-present holds
  - a no-show releasing time for a walk-in
  - business booking outside hours (flagged)
  - customer overlapping bookings
- **DoD — Gate A (Engine proven):**
  - [ ] Fuzz: 0 overlaps and 0 null staff across 10k random operations, repeated with 5 seeds.
  - [ ] Concurrency tests pass 100/100 runs.
  - [ ] p95 `get_available_slots` (14 days, 8 staff) < 150 ms on staging; `create_hold` p95 < 100 ms.
  - [ ] No public RPC returns internal-only/archived staff (automated payload scan).
- **Context pack:** Phase 3 Part 3 (all), Part 2 §7–8, Part 7 §3–5.

---

### M4 — Auth, identity & claim model · S–M

**Goal:** real people can sign in the way Lebanese users expect, and the explicit claim model works.

- **Backend:**
  - Supabase phone auth with **Send SMS Hook** (Edge Function) → WhatsApp OTP, SMS fallback after 30 s or on failure; OTP rate limits; Turnstile on OTP send and anonymous sign-in.
  - Anonymous auth enabled; link-phone upgrade path.
  - Business invitations (`invite_member`, `accept_invitation`, role changes, `transfer_ownership`).
  - Admin TOTP MFA enforced.
  - Claim model: `claim_booking(token)`, `get_claimable_visits`, `claim_visits`, `dismiss_claimable_visits`, `link_business_customer` (safe merge).
  - `resolve_access_token`; `delete_my_account` job skeleton.
- **Frontend:** reusable auth components in `packages/ui-web`: `PhoneInput` (+961 rules), `OtpInput` (autofill, paste, resend countdown, "Send by SMS instead"); business login; admin login with MFA.
- **Tests:** claim tests (Part 7 §6: phone verification links nothing, token/phone match, 12-month window, offers reveal minimum, safe merge, acquired_via inheritance); invitation flows; RLS for anonymous users (can't do customer actions).
- **Edge cases:** foreign numbers; a user changing phone; a number already used by another account; OTP lockout; WhatsApp not installed.
- **DoD:** S2 findings applied; OTP median delivery measured (target < 15 s via WhatsApp, < 30 s via SMS); anonymous-hold → OTP → confirm works inside the Instagram in-app browser on iOS and Android.
- **Context pack:** Phase 3 Part 1 §6, Part 2 §1–2, Part 3 §4.2–4.3, Part 6 §7, Part 7 §6.

---

### M5 — Business dashboard I: onboarding & setup · M–L

**Goal:** a business can be set up (by ops or the owner) and its menu, team and hours match reality.

- **Backend:** RPCs `publish_business`, `pause_online_booking`, `change_business_slug`, `archive_staff`, `register_business_media` + `business-media` bucket policies; `biz_search_customers`, `biz_upsert_customer`, notes RPCs; minimal admin RPCs `admin_create_business` + owner invite.
- **Frontend (`apps/web/biz`):**
  - App shell: role-aware navigation (desktop sidebar / tablet rail / mobile bottom nav), business switcher placeholder, command palette skeleton.
  - **B1 Onboarding wizard** (assisted and owner modes) with service templates from the canonical catalog and a go-live checklist.
  - **B8 Services**, **B9 Staff** (profile incl. `publicly_bookable` / auto-assignment toggles, services with overrides, schedule editor with breaks, overrides, time off, 2-week preview), **B12 Settings** (profile, location & hours, closures with affected-bookings handling, booking rules, team, share kit: link + QR poster PDF).
  - **B6 Customers** list (basic).
  - **Minimal admin:** A4 "Create business + send invite".
- **Tests:** Playwright: onboard a business end-to-end in both modes; services/staff CRUD respects roles (reception can't edit services); schedule editor produces the expected availability (asserted via `get_available_slots`).
- **Edge cases:** closure over existing bookings; staff archived with future bookings (blocked with reassign/cancel flow); slug change redirects; Arabic business names (RTL text in LTR UI).
- **DoD:** ops can onboard a real salon in ≤ 20 minutes on a phone; the public availability for that salon matches what the owner expects on 3 spot-checked days.
- **Context pack:** Phase 2 Part 3 (B1, B6, B8, B9, B12), Part 1 §8.4; Phase 3 Part 2, Part 6 §3.3.

---

### M6 — Business dashboard II: calendar & daily operations · L · ⚠ adoption risk

**Goal:** the calendar is faster than the notebook.

- **Backend:** `biz_get_calendar` (role-projected: names, pinned notes, reliability label, time off without reason); Realtime on `booking_items`; `biz_get_customer`; bookings list RPCs; requests queue.
- **Frontend:**
  - **B3 Calendar:** Day·Columns (all / selected staff), Day·Single, Week·Single, Agenda; drag-to-move with notify prompt; "★ Requested" marker; block time; now line; mobile agenda.
  - **B4 Appointment Creation:** smart phone/name field, service chips, staff incl. Any and internal-only, time chips from `biz_get_available_slots`, walk-in, keyboard flow, Undo.
  - **B5 Bookings** (tabs, requests accept/decline, event timeline drawer).
  - **B7 Customer Detail** (stats, notes, history; no reviews).
  - **B2 Overview (lean):** attention items, today list, 4 tiles.
  - Status actions: complete, no-show, bulk-complete prompt.
- **Tests:**
  - Playwright **speed tests** (existing customer ≤ 4 interactions; new customer ≤ 6); keyboard-only creation; conflict toast on overlap; Realtime: a booking made in tab A appears in tab B < 2 s.
  - Role tests: staff sees only their own column.
- **Edge cases:** two receptionists editing the same slot; moving a specifically-requested booking (mandatory notify); DST day rendering; 10-minute and 3-hour services; very long customer names; offline banner.
- **DoD — Gate B (Business pilot):**
  - [ ] 3–5 friendly businesses in **one cluster** use the calendar for **all** appointments (manual + walk-ins) for **2 consecutive weeks**.
  - [ ] ≥ 80% of their appointments are logged in the calendar (spot-check vs their notebook/WhatsApp).
  - [ ] Median manual booking creation time in real use < 15 s (instrumented).
  - [ ] Top 10 friction points logged and the critical ones fixed.
- **Context pack:** Phase 2 Part 3 (B2–B7), Phase 3 Part 3 §4.4, Part 6 §4 (Realtime).

---

### M7 — Notifications & WhatsApp · M

**Goal:** reliable confirmations and reminders over WhatsApp, with fallbacks.

- **Backend:**
  - `notifications` outbox, deliveries, templates (EN + AR), routing config, preferences, business notification settings, push tokens table.
  - `notify-dispatch` Edge Function (claim due, render, send, retry/backoff, SMS fallback for critical types).
  - WhatsApp webhook (signature check; delivery statuses; **Confirm** → `customer_confirm_attendance`; **Cancel** → manage link).
  - Scheduled reminders (24h/2h) with dedupe; cancellation of stale reminders.
  - Business alerts (new booking/request/cancellation).
  - `manage_booking` and `claim_visit` links in messages.
- **Frontend:** B12 notification settings; customer preference UI component (for web/app later); delivery-failure alert on B2.
- **Tests:** Part 7 §10 (enqueue expectations, preference rule, Confirm-button phone match); dispatcher idempotency (a double run sends nothing twice); provider failure → SMS fallback.
- **Edge cases:** shadow customer with a foreign number; template not yet approved for a locale (fall back to EN); WhatsApp 24h session rules; reminder for a booking made < 2h ahead (skipped); reschedule resets reminders.
- **DoD:** pilot businesses' customers receive confirmations and reminders; delivery success ≥ 95% (WhatsApp + fallback) over one week; Confirm-button usage is being measured.
- **Context pack:** Phase 3 Part 5 §6, Part 3 §4.3 step 11; S1 results.

---

### M8 — Public web booking (acquisition product) · L

**Goal:** `platform.com/{slug}` turns an Instagram click into a confirmed booking in under a minute.

- **Backend:** `get_business_page` (+ slug redirect), `get_staff_options` (non-leak), `get_my_bookings`/`get_my_booking`, `cancel_my_booking`, `reschedule_my_booking`, `contest_no_show` (creates dispute rows; admin UI in M11), OG image generation endpoint.
- **Frontend (`apps/web`):**
  - **C1** business page (SSR/ISR, sticky CTA, desktop booking panel, no competitor links).
  - **C7–C11** flow (Service → Staff Preference incl. "Book again with…" → Date/Time with staff chips → Review with assigned staff + "Change" + inline OTP → Success with calendar/directions/app prompt).
  - **C12/C13** web My Bookings and Booking Detail (magic link + OTP).
  - Claim UI (Flow A + "We found previous visits" prompt).
  - QR poster / share kit polish.
- **Tests:**
  - Playwright on mobile viewport through the full funnel.
  - Error-code paths (`SLOT_TAKEN` recovery, `HOLD_EXPIRED` recheck, `RELIABILITY_REQUEST_ONLY` switching to request mode).
  - Lighthouse: LCP < 2.5 s on slow 4G, CLS < 0.1.
  - In-app-browser manual test matrix (Instagram/TikTok/WhatsApp × iOS/Android).
- **Edge cases:** business paused; on-consultation services (WhatsApp CTA); a visitor with an existing upcoming booking; a device in another timezone; single-staff auto-skip; `choose_only` / `any_only` modes; price differences in Any mode.
- **DoD — Gate C (Pilot cluster live):**
  - [ ] 10–20 businesses in one cluster have the link in their Instagram bio and/or QR at the counter.
  - [ ] ≥ 50 real online bookings completed; funnel measured (page → service → time → OTP → confirmed) with conversion from page view to booking tracked in PostHog.
  - [ ] 0 double bookings; 0 severity-1 incidents for 2 weeks.
- **Context pack:** Phase 2 Part 2 (C1, C7–C13), Part 1 §8.1–8.2, §9; Phase 3 Part 3 §4, Part 5 §2.2.

---

### M9 — Reviews, text moderation & fraud pre-check · L

**Goal:** trustworthy, verified reviews with fair, context-aware moderation.

- **Backend:**
  - `reviews`, ratings, replies, translations, rating summary.
  - `review_eligibility`, `submit_review` with **synchronous `fraud_precheck`** and the event-driven publication rules, `rating_is_counted`, edit/delete.
  - Text pipeline (rules → normalize incl. Arabizi → LLM classifier → decision matrix) via the `moderation` queue.
  - Reports (`report_content`), `review_attendance` disputes.
  - `moderation_cases` + `admin_decide_case`; fraud signals + nightly detectors; review-request notifications at completion.
- **Frontend:** **C15** Leave Review (web token link + app-ready components); public reviews on C1; **B10** Reviews (reply, report, translate); **minimal admin A2/A3** for text cases.
- **Tests:**
  - Part 7 §7 (eligibility, tiers, independent moderation, quarantine exclusion, single predicate).
  - A **moderation evaluation set:** 200+ labeled real-style reviews (English/Arabic/French/Arabizi/mixed; profanity-about-service vs abuse; PII; spam), with target precision/recall tracked per category and a regression check on prompt/model changes.
- **Edge cases:** review during an open no-show dispute; text rejected but rating kept; reply containing customer PII; translation of mixed-language text; business report limits.
- **DoD:** evaluation set ≥ 95% correct on "publish vs not" and 0 false-publishes on threats/hate; median time to text decision < 2 min (automated); moderation queue workable by one person daily.
- **Context pack:** Phase 3 Part 4 §1, §3–6; Phase 2 C15, B10, A2–A3.

---

### M10 — Customer results & media pipeline · L

**Goal:** verified customer result photos, safely.

- **Backend:**
  - **Formal image benchmark** (below) → choose `EdgeImageProcessor` or `ExternalImageProcessor`.
  - `media_assets`, `review_media`, `business_media` moderation hook; buckets `ugc-private` / `ugc-staging` / `ugc-public` + policies.
  - `request_review_media_upload`, `finalize_media_upload`, sweeper, orchestrator, `ImageProcessor` + `ImageClassifier` implementations, `media_processing_complete`, decision logic (hash dup, safety, OCR, relevance with booking context, minors).
  - `feature_result` / `unfeature_result`; removal job for public derivatives.
- **Frontend:** **C16** upload with consent; **C6** results grid + Result Detail ("Book similar" → prefilled flow); business portfolio management; featuring in B10; admin image queue (blurred by default).
- **Benchmark (decides the processor):**

  | Test | Pass criteria |
  |---|---|
  | Decode HEIC (iPhone 12–16), JPEG (Android), PNG, WebP; 200-image corpus up to 12 MB | 100% decode success |
  | EXIF/GPS stripping verified with exiftool on outputs | 0 metadata leaks |
  | Re-encode + 320/800/2048 WebP derivatives + pHash + blurhash | p95 < 8 s per image, no OOM/timeouts over 500 sequential + 20 concurrent jobs |
  | Cost per 1,000 images | recorded |

  If Edge Functions fail any criterion → deploy the small external worker for **transform only**. Nothing else changes.
- **Tests:** Part 7 media contract test; private-first guarantees (no public object before approval, storage policy tests); relevance decisions on a labeled image set (hair, nails, beard, makeup, irrelevant, memes, screenshots, documents).
- **Edge cases:** before/after pairs (Soon flag); an upload after the review exists; a customer deleting a featured photo; minor flag; a duplicate of the business's portfolio photo; a very large panorama.
- **DoD:** benchmark report committed; 0 metadata leaks; automatic decisions on the labeled image set ≥ 90% correct, with the rest routed to manual review (never falsely public).
- **Context pack:** Phase 3 Part 4 §2, §3.2; Phase 2 C6, C16.

---

### M11 — Admin console completion · M

**Goal:** the platform can be operated safely by 1–2 people.

- **Backend:** admin RPCs for businesses (status, verify placeholder), customers (status, reliability forgive), reviews (quarantine/restore), disputes (`admin_resolve_dispute` with effects and default rules job), catalog CRUD + suggestions inbox, ranking drafts/publish/rollback/explain, `admin_get_audit`, `admin_search`.
- **Frontend:** A1 Overview (queues + cluster health), A2/A3 full moderation, A4 Businesses, A5 Customers, A6 Reviews, A7 Reports & Disputes (incl. the customer "I was there" UI polish in C13), A8 Catalog (synonyms, areas), A9 Ranking (versions, editor, inspector), A10 Audit Log.
- **Tests:** admin role matrix (Part 7 §8 #51); every admin RPC writes one audit row; dispute outcome effects (Part 7 §7).
- **Edge cases:** concurrent moderators (claim/expire); legal-hold content; suspending a business with upcoming bookings.
- **DoD:** a full no-show dispute runs end-to-end (customer contest → admin decision → reliability and review effects → notifications); any admin action can be traced in the audit log within 3 clicks.
- **Context pack:** Phase 2 Part 4; Phase 3 Part 4 §3–5, Part 5 §3, §8, Part 6 §5.

---

### M12 — Search & discovery · M–L

**Goal:** customers can find and compare trusted businesses across the launch clusters.

- **Backend:** `search_documents` + refresh queue; `search_suggest`, `search_businesses` (gates, query scoring, filters, bounded availability filtering); `compute_quality_scores` (Bayesian, decay, Verified Visit cap, components) + history + labels; price levels; `search_log` (zero-result report in A1); SEO landing data (`/{area}/{category}`).
- **Frontend (web):** C2 lean web home, C3 search overlay, C4 results (list, filters, sort), SEO landing pages, labels on cards.
- **Tests:** Part 7 §9 (Arabizi/Arabic matching, visibility, config validation, organic search never touching sponsored); ranking unit tests on crafted fixtures (3×5★ doesn't outrank 400×4.8★; quarantined reviews excluded; the visit cap is honored).
- **Edge cases:** clusters with too few businesses (label thresholds tuned via A9 preview); query outside launched categories ("dentist"); area aliases.
- **DoD:** the top 30 real search queries from pilot users return sensible results (manually reviewed); search p95 < 300 ms.
- **Context pack:** Phase 3 Part 5 §1–3; Phase 2 C2–C4, A9.

---

### M13 — Expo customer app (retention product) · L

**Goal:** make rebooking and discovery effortless for returning customers.

- **Backend:** push tokens + push channel in the dispatcher; `get_rebook_suggestions`; `toggle_favorite_business`; `get_my_favorites` (places); notifications inbox RPCs; universal/app links.
- **Frontend (`apps/mobile`):**
  - Tabs: Home · Explore · Bookings · Favorites · Profile.
  - C2 Home (Book Again with {staff}, upcoming, rails); C3/C4 search; C5 profile with tabs; C6 results.
  - Booking flow C7–C11 reusing `packages/core` + `packages/api`.
  - C12–C14, C15/C16 native, C17 inbox, C18 settings incl. **account deletion** (store requirement); push permission after first booking.
- **Tests:** Detox or Maestro flows (book, rebook, cancel, review); deep links from WhatsApp and web to the app; offline behavior.
- **Edge cases:** web user installing the app (session carry-over via deep link); push disabled; the same account on web and app.
- **DoD:** TestFlight + Play internal testing with pilot customers; one-tap rebook works from Home; submitted to both stores.
- **Context pack:** Phase 2 Part 2 (C2–C6, C12–C18), Part 1 §8.3.

---

### M14 — Analytics & launch hardening · M

**Goal:** businesses see their value; the platform is safe to scale to 50–70 businesses.

- **Backend:** daily rollups (business + staff), `biz_get_analytics` (rollups + live today, source mix); nightly job consolidation; PITR backups; monitoring and alerts (Sentry, Supabase logs, job failure alerts, WhatsApp delivery rate, moderation SLA); load test (simulated 5× launch traffic: holds/confirms/search); security review (RLS re-audit, definer function review, storage policies, secrets); dependency and vulnerability scans.
- **Frontend:** **B11 Analytics** (period, tiles, trend, top services, staff table, source mix); legal pages (terms, privacy per Law 81/2018, review guidelines); status/incident page.
- **Ops:** runbooks (double-booking report, WhatsApp outage, moderation backlog, account deletion, legal request); onboarding of all launch businesses across the 3 clusters.
- **DoD — Gate D (Marketplace launch):**
  - [ ] 50–70 live businesses; each cluster has ≥ 15 across the core categories.
  - [ ] Gate C metrics held for 4 weeks in the pilot cluster; ≥ 30% of pilot businesses' bookings arrive online.
  - [ ] Load test passed; security review items closed; backups restore-tested.
  - [ ] Both app store builds approved.

---

## 5. Order at a glance

**Approved adjustment (2026-09-27): M7 and M8 are developed while the M6 pilot runs.** Development doesn't pause during the 2-week calendar pilot. **Gate B still blocks any broad public-booking launch** (M8 may be deployed to staging and used by pilot salons' own links only once Gate B passes).

```
S1 WhatsApp ─────────────────────────────── (runs in background from day 1)
S2 Auth/webviews ──┐
S3 Images ─────────┼─ (early spikes)
M0 Foundation → M1 DB foundations → M2 Business schema → M3 BOOKING ENGINE ──► Gate A
   → M4 Auth & claims → M5 Dashboard setup → M6 CALENDAR (dev complete, pilot starts)
                                                 │
                    ┌────────────────────────────┴───────────────────────────┐
                    │ PILOT (3–5 salons, ≥2 weeks)   │ DEV in parallel: M7 WhatsApp → M8 Public web booking │
                    └────────────────────────────┬───────────────────────────┘
                                                 ▼
                                  Gate B (pilot evidence) ── required before public booking goes live
   → M8 live for pilot cluster ──► Gate C
   → M9 Reviews/moderation → M10 Results/media → M11 Admin → M12 Search
   → M13 Expo app → M14 Analytics & hardening ──► Gate D (launch)
```

**Gate B evidence (unchanged, now explicit):**
- salons actually use the calendar
- manual bookings are fast enough
- staff schedules work correctly
- businesses aren't keeping a separate conflicting notebook/calendar
- there are no serious booking or availability issues

**Milestone protocol (every milestone):** implement → run the required automated tests → fix failures → report what was built, any architectural decisions or deviations, and the test results → wait for approval before the next milestone. If implementation shows a Phase 3 assumption is technically wrong, stop that part and present what the spec says, why it fails, the smallest safe change, and what it affects, before changing the architecture.

M9–M12 can overlap partially once M8 is stable. M13 can start UI work in parallel with M11–M12, because it only consumes existing RPCs.

## 6. Parallel ops track (non-code, owned by you)

| When | Activity |
|---|---|
| From M0 | Company/legal setup, WhatsApp Business verification (S1), brand name + domain, terms/privacy drafting |
| During M3–M5 | Recruit 3–5 pilot businesses in one cluster (Gate B); collect their real menus, staff and hours |
| During M6–M8 | Shoot cover/portfolio photos on-site; train reception; QR posters printed |
| During M9–M12 | Expand to 10–20 businesses in the pilot cluster; start the other two clusters' pipelines |
| M13–M14 | Reach 50–70 businesses; prepare customer-acquisition campaigns (only after Gate D) |

## 7. Post-launch backlog ("Soon" from Phase 2, not in the milestones above)

Arabic UI (RTL) · Waitlist · Staff favorites (People tab) · Before/after pairs · Map view · Multi-service visits · Processing-time segments & overlap override · Customer segments/import · Business verification · Resources (rooms/machines) · Heatmap & retention analytics · Round-robin/minimize-gaps assignment (flagged in M3) · Impact simulation for ranking · Business-side duplicate merge UI.

## 8. Working with AI tools, per milestone

1. **Context pack first:** paste the listed doc sections, plus `00-locked-decisions.md`, into the session.
2. **Order inside a milestone:** migration → pgTAP tests → RPCs → generated types → `packages/api` wrappers → UI → Playwright.
3. **One migration per concern**, named `YYYYMMDDHHMM_<milestone>_<topic>.sql`; never edit merged migrations.
4. **Review checklist for every AI-generated change:**
   - RLS enabled + policies
   - definer `search_path`
   - business derived from the row, not a parameter
   - error codes
   - audit
   - no `publicly_bookable` leak
   - tests included
5. **Any deviation from the spec** gets a decision-log entry before merge.
