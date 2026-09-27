# Phase 3 · Part 7 — Required Database Tests

Tooling: **pgTAP** (run with `supabase test db` in CI on every migration), plus a small **TypeScript harness** (Vitest + `pg`) for concurrency and property-based tests that need parallel connections. Tests run against a seeded fixture: 2 businesses (A, B), 1 location each, 4 staff at A (normal, senior with `accepts_any_assignment=false`, owner with `publicly_bookable=false`, archived), services with overrides, customers (verified, anonymous, suspended, restricted), admins per role.

A migration is **not mergeable** unless all of these pass.

---

## 1. Schema hygiene

1. Every table in `public` has RLS enabled (`select … from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity` returns 0 rows).
2. `anon` has no table privileges in `public` except the listed catalog tables.
3. `authenticated` has **no INSERT/UPDATE/DELETE** on: bookings, booking_items, booking_events, reviews, review_ratings, review_media, media_assets, reports, disputes, moderation_cases, business_members, notifications, search_documents, quality scores, audit.*.
4. Every SECURITY DEFINER function has `search_path` set to `''`, and none is executable by `public`.
5. No UPDATE/DELETE is possible on `audit.*` or `booking_events` by any role, including `service_role` (trigger raises).

## 2. Tenancy & integrity

6. Composite FKs reject cross-tenant references:
   - a business-A staff member on a business-B service (`staff_services`)
   - a booking item with a business-B location
   - a business-A staff member at a business-B location
   - a note on a business-B customer
7. `services` price-type checks: every invalid combination fails (e.g. `range` without `price_max`, `on_consultation` that is online-bookable).
8. `staff_members` rejects `publicly_bookable = false and accepts_any_assignment = true`.
9. `staff_weekly_hours` / `location_hours` / `staff_schedule_overrides` reject overlapping intervals. Effective-dated rows can't overlap on the same weekday.
10. At most 3 specialties per staff member; exactly one active owner per business; one primary location.
11. `bookings.source` and `business_customers.acquired_via` can't be updated. `reviews.trust_tier` can't be updated.

## 3. Availability engine

12. A slot is offered only when `[t − buffer_before, t + duration + buffer_after)` fits within: staff hours (or override) ∩ location hours − breaks (gaps) − time off − closures − busy items.
13. Date overrides fully replace weekly hours; `is_working = false` blocks the whole day; effective-dated hours switch on the right date.
14. Staff duration and price overrides are reflected in slots, holds and snapshots.
15. Min notice, max advance, and the slot grid (anchored to local midnight in `slot_interval_minutes` steps) are respected. Off-grid starts are rejected by `create_hold` (`INVALID_SLOT`).
16. **DST:** on Beirut spring-forward and fall-back dates, the generated slots map to correct UTC instants, with no duplicate or missing bookable times beyond the actual clock change.
17. Expired holds don't block availability. The caller's own hold is ignored during a reschedule check.
18. **Public non-leak (critical):**
    - `get_available_slots(p_staff_id => internal_owner)` returns 0 rows.
    - `get_staff_options`, `get_business_page`, `get_next_available`, `search_*`, `get_business_reviews`, `get_business_results`, `get_result_detail`, `get_rebook_suggestions` and `get_my_favorites` never contain an internal-only or archived `staff_id` or display name. The test scans the JSON payloads for those IDs and names.
    - Reviews and results of internal-only staff still count in `business_rating_summary`, but their payloads show "a team member".
19. Any-mode slots include only staff with `publicly_bookable and accepts_any_assignment`. Specific mode with the senior stylist returns their slots; Any mode never assigns them.
20. `staff_choice_mode`: `any_only` rejects specific requests; `choose_only` rejects Any.

## 4. Concurrency (TypeScript harness, parallel connections)

21. **Same slot, one free staff member:** 20 parallel `create_hold` calls → exactly 1 succeeds, 19 get `SLOT_TAKEN`/`STAFF_NOT_FREE`.
22. **Same slot, Any mode, N free staff:** N+5 parallel calls → exactly N succeed, **each with a distinct `staff_id`**. The rest get `SLOT_TAKEN`.
23. Parallel `create_manual_booking` and `create_hold` on the same staff/time → at most one blocking item.
24. Parallel reschedules of two bookings into the same slot → one wins.
25. **Property test (fuzz):** random schedules, services, buffers, holds, confirms, cancels, reschedules and no-shows over 10k operations. After every step, no two `blocks_time` items for one staff member overlap, and every item has a non-null `staff_id`.
26. **Idempotency:** `confirm_booking` retried with the same key → the same booking, no duplicate notifications.

## 5. State machine

27. Every transition not listed in `private.booking_transitions` raises `TRANSITION_NOT_ALLOWED` (exhaustive from × to × actor matrix).
28. Customer cancel after start → rejected. Inside the cancellation window → `is_late_cancel = true` and a `late_cancel` reliability event.
29. `mark_no_show` is allowed only within `[starts_at, starts_at + 24h]`. It releases time (a walk-in can then be booked into the slot).
30. Request expiry job → pending becomes cancelled(system) with event `expired`; auto-complete job → confirmed becomes completed(system) after the configured delay.
31. `reassign_booking_item` on a `specific`/`rebook` item without notify → notification still enqueued; `requested_staff_id` preserved.
32. Every status change writes exactly one `booking_events` row with the correct actor.
33. Holds: one active hold per user; `confirm_booking` works with a valid token after anonymous → real account sign-in, fails with a wrong token, and fails for anonymous or unverified-phone users.

## 6. Customers, claim, reliability

34. **Phone verification alone links nothing.** Creating or updating `auth.users.phone_confirmed_at` changes no `business_customers.user_id` and no `bookings.customer_user_id`, even when unclaimed shadows with that phone exist at several businesses.
35. **`claim_booking(token)`**:
    - succeeds only for a non-anonymous caller whose OTP-verified phone equals the token's phone and the booking's customer phone
    - fails on phone mismatch, expired, reused, anonymous caller, wrong purpose, or booking older than 12 months
    - links **only that booking** plus the relationship; other visits at the same business stay unlinked until offered and confirmed
36. **Offers (`get_claimable_visits`)** return only business name/area, visit count and latest month. No services, staff, prices or exact dates. Candidates older than 12 months never appear. Dismissed businesses aren't offered again until a newer visit exists.
37. **`claim_visits(business_ids)`** links only the confirmed businesses' candidate bookings (≤ 12 months). Unconfirmed businesses remain untouched.
38. **Safe merge:** when the user already has a record at the business, the shadow's bookings and notes are re-pointed to the survivor, the shadow is archived with `merged_into_id`, and `customer_user_id` is set only on the bookings claimed in that call (never on bookings older than 12 months). Stats are recomputed.
39. **Online booking with an existing unclaimed shadow:** `confirm_booking` doesn't merge or link the shadow; the new record inherits `acquired_via` from the shadow; a possible-duplicate row and a claim offer are created.
40. After a relationship is claimed, a new `create_manual_booking` on that record sets `customer_user_id` automatically. On an unclaimed record it stays null.
41. Verified Visit eligibility exists only for bookings linked via Flow A, Flow B, or a claimed relationship.
42. Reliability: one no-show → label stays `reliable`/`new_customer`. Two recent no-shows → `some_missed_appointments`. Scores decay over time. `forgiven` and `dispute_overturned` reverse effects. `restricted` forces request mode in `confirm_booking`; `blocked` rejects.
43. `customer_reliability_label` is callable only by members of a business that has that customer, and returns only the coarse label.

## 7. Reviews & results

44. Eligibility:
    - only the booking's customer
    - only completed (or no-show with an open dispute)
    - within 30 days
    - one per booking (unique)
    - never business members or staff users, past or present
45. Tier: customer-initiated source → `verified_booking`; `manual`/`walk_in` + claimed → `verified_visit`. Base weights come from the active config.
46. Independent moderation: rejecting one image leaves the text, ratings and other images unchanged. Rejected text leaves the ratings published.
46a. **Rating publication is event-driven:** with a clean fraud pre-check, the rating is `active` and counted immediately while the text is `pending` or `manual_review`. No timer is involved.
46b. **Quarantine:** a pre-check or later signal ≥ `investigation_threshold` → `rating_state = 'quarantined'`. The review disappears from every public RPC. `business_rating_summary`, `staff_stats`, labels and `compute_quality_scores` exclude it and are recomputed at once. Dismissal restores; confirmation removes.
46c. `private.rating_is_counted` is the only predicate used by the summary, stats and ranking functions (dependency check: those functions reference it, and none filters `rating_state` on its own).
46d. **Media worker contract:** `media_processing_complete` accepts identical payloads from `processor = 'edge'` and `'external'`, is idempotent per `job_id`, and rejects results for media not in `processing`. Derivatives are never placed in `ugc-public` before approval.
47. Visibility functions never return pending, rejected, removed, quarantined or deleted content, or unapproved media paths.
48. A business can't delete, hide or reorder organic results (no executable path). `feature_result` accepts only approved, non-minor media of its own business, max 6, unique ranks.
49. `delete_my_review` removes public visibility immediately and schedules public derivative deletion. `legal_hold` retains data.
50. `no_show_upheld` dispute outcome removes a review posted during the dispute; `no_show_overturned` restores eligibility and adjusts reliability.
51. Verified Visit cap: in `compute_quality_scores`, visit-tier weight never exceeds the configured share.

## 8. RLS behavior (run as each role via `set local role` + JWT claims)

52. Business A members can't read or modify any business-B row in any table.
53. Reception can't read `staff_time_off.reason` and can't update services, settings or staff.
54. The staff role sees only its own booking items and bookings, and can't see other staff members' customers.
55. Customers can't select `bookings`/`reviews` directly. Anonymous users can't create favorites, reviews, reports or confirmed bookings.
56. Admin policies require `aal2`: the same admin user with an `aal1` JWT gets nothing.
57. Moderators can't publish ranking configs or resolve legal disputes; ops can't decide moderation cases.
58. Storage: a user can upload to `ugc-private` only at a path registered to them, can't read any `ugc-private` object, and can't write to `ugc-public`.

## 9. Search & ranking

59. `search_key` matches Arabizi and Arabic variants ("7ala2" → barber synonym, "الأشرفية" / "achrafieh" / "ashrafieh" → the same area).
60. Non-visible businesses and locations (draft, paused, suspended, test) never appear in search or public RPCs.
61. `validate_ranking_params` rejects weights not summing to 100. Only one active config at a time. Publish/rollback write audit rows.
62. Organic `search_businesses` never reads `sponsored_placements` (enforced by a dependency check on the function's SQL via `pg_depend`).

## 10. Notifications & audit

63. Confirming a booking enqueues exactly the expected notifications with `dedupe_key`s. Cancel/reschedule cancels pending reminders.
64. `set_notification_preference` refuses to disable the last transactional channel.
65. WhatsApp "Confirm" button handling sets `customer_confirmed_at` only when the sender phone matches the booking's customer.
66. Every admin RPC writes exactly one `audit.admin_actions` row with a reason code. Audited business tables write `audit.entity_changes` with the correct actor.
