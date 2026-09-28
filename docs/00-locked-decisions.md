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
| 2026-09-28 | **M3 approved and closed.** D1–D9 approved. Product decisions kept: 3 recent no-shows → requests, 5 → blocked pending admin review; auto-complete 6 h after end; default assignment least booked that day; manual bookings bypass online notice/horizon/grid; late-cancel penalty only for confirmed bookings; undo no-show adds a correcting event. Staging (`oplwsnpyavnqnhlzyhxr`): 315/315 pgTAP, hosted races 10/10 × 5 scenarios, non-leak and API smoke pass, fingerprint identical, zero residue. Gate A on staging (database time p95): slots 25.1 ms, hold 12.6 ms, confirm 8.2 ms. Found at verification: H6 availability grid built once per request (staging p95 195 ms → 25 ms); **D10** explicit `service_role` EXECUTE on public RPCs (hosted default; same rule as M1 tables). |
| 2026-09-28 | **M2 approved and closed.** D1–D8 approved/recorded. Staging (`oplwsnpyavnqnhlzyhxr`): 201/201 pgTAP, 11/11 API smoke, schema fingerprint identical. D8: slug CHECKs on citext now cast to text (operator binding differed by DDL search path). Reserved slugs extended per review. M3 requirement: pending-request expiry bounded by appointment start. |
| 2026-09-28 | **M2 spec corrections (bug fixes, design unchanged):** (1) NULL-unsafe CHECKs in Part 2 (`services` range price, `staff_schedule_overrides` working hours) let invalid rows through, because a NULL CHECK passes; they now guard with IS NOT NULL. (2) `staff_services` override shape made NULL-safe. (3) `staff_weekly_hours` and `staff_schedule_overrides` gain FK `(staff_id, business_id)` so the RLS-relevant `business_id` can't disagree with the staff member's business. Part 2 amended. |
| 2026-09-28 | **M1 staging verification passed** (hosted project `oplwsnpyavnqnhlzyhxr`): `app_owner` model works on hosted Supabase; 101/101 pgTAP; 11/11 anon API smoke; schema fingerprint identical to local. Staging revealed hosted grants `service_role` DML on `public` tables by default → now explicit in migration `20260927211000` so local = hosted (consistent with Part 1 §6.1; audit/private remain closed). |
| 2026-09-27 | M1 sequencing (plan, not spec): business-membership helpers (`has_business_role`, `my_business_ids`, `my_staff_id`, `my_staff_ids`) and `catalog_suggestions` move to M2 because they reference M2 tables. |
| 2026-09-27 | M0 tooling (not a spec change): runtime Node 24 LTS (CI + .nvmrc); TypeScript pinned to 6.0.x because typescript-eslint supports < 6.1 (TS 7 native compiler lacks the JS API that Next.js/typescript-eslint use); Supabase local `auto_expose_new_tables = false` and `max_rows = 200` to match Phase 3 Part 6. |
