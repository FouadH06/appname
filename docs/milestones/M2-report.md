# M2 — Business core schema: report

Status: **closed** (reviewed + hosted staging verified) · Branch `m2-business-core` → merged to `main`

## Review decisions (2026-09-28)

- D1–D7 approved. Access model approved (reception and staff get role-limited RPCs/views in M5/M6, not direct customer-table access).
- Default booking settings kept (60 min notice, 30-day horizon, 15-min slots, 2 h cancellation window, 4 h request expiry).
- Reserved slugs extended: `pricing`, `partners`, `services`, `dashboard` added. The brand name stays as the `app-name` placeholder until chosen. Test asserts the full approved list.
- For M3: a pending request must never outlive the appointment start (expiry bounded by `starts_at`).

## Hosted staging verification (2026-09-28)

| Check | Result |
|---|---|
| M2 migrations applied (`db push`, dry run first) | ✅ 6/6 (incl. D8 fix below) |
| Full pgTAP on hosted | ✅ **201/201** |
| Logged-out Data API smoke | ✅ 11/11 |
| Hosted lint (app schemas) | ✅ no issues |
| Schema fingerprint local vs hosted | ✅ **identical, 11/11 categories** (after D8) |
| No leftover data | ✅ all zeros |

**What staging revealed (D8):** the first fingerprint showed the two slug CHECKs compiled differently. `slug ~ '...'` on a `citext` column bound to citext's **case-insensitive** regex operator locally (where `extensions` was on the search path during migrations), and to the case-sensitive text operator on hosted. Locally that would have accepted uppercase slugs. The fix is new migration `20260928100500_m2_slug_checks_explicit.sql`, which casts to `text` so every environment compiles the same lowercase-only rule. Two tests added. A convention was added for extension-type operators.

## What was implemented

| Area | Tables / functions | Spec |
|---|---|---|
| Businesses | `businesses`, `reserved_slugs` (route words + every area, category and cluster slug), `business_slug_history` (301 redirects), slug trigger (reserved → `SLUG_UNAVAILABLE`, another business's old slug → rejected, own old slug → reclaimable), `business_categories` (primary kept in sync with `primary_category_id`) | Part 2 §5 |
| Locations | `business_locations` (one primary, PostGIS point, `Asia/Beirut`), `location_hours` (split hours, overlap exclusion), `location_closures` | Part 2 §5.1 |
| Team | `business_members` (one active owner), `private.business_invitations` | Part 2 §5.2 |
| Settings | `business_settings` (auto-created per business), `business_verifications` placeholder | Part 2 §5.3–5.4 |
| Services | `service_groups`, `services` (price-type rules), `service_combo_items`, `catalog_suggestions` (deferred from M1) | Part 2 §4, §6 |
| Staff | `staff_members` (`publicly_bookable` / `accepts_any_assignment` + the invalid-combination check), `staff_locations`, `staff_services` (duration/price overrides, max 3 specialties), `staff_weekly_hours` (effective-dated, split shifts), `staff_schedule_overrides`, `staff_time_off`, `staff_stats` (auto-created) | Part 2 §7–8 |
| CRM | `business_customers` (shadow model, `merged_into_id`, immutable `acquired_via`), `private.possible_duplicates`, `private.claim_dismissals`, `customer_notes` | Part 2 §2.2–2.3, Part 5 §4 |
| Billing placeholders | `plans` (`launch_free` seeded), `plan_entitlements`, `business_subscriptions` (auto-created), `private.has_entitlement()` | Part 5 §9 |
| Helpers | `private.has_business_role`, `my_business_ids`, `my_staff_id`, `my_staff_ids`, `is_publicly_visible_location` (deferred from M1) | Part 1 §7, Part 6 §2 |
| Security | RLS on all 26 new public tables, per the Part 6 §3.3/§3.4 matrix; column-level INSERT/UPDATE grants (no client can set `business_id` on update, `user_id`/`status`/`archived_at` on staff, `status` on businesses, etc.); admin read policies; audit triggers per Part 5 §8 | Part 6, Part 5 §8 |

TypeScript types regenerated (`packages/db/src/database.types.ts`, 2,220 lines).

## Migrations created

| File | Contents |
|---|---|
| `20260928100000_m2_businesses.sql` | Businesses, slugs, categories, locations, hours, closures, members, invitations, settings, verification, helpers, RLS, audit |
| `20260928100100_m2_services.sql` | Service groups, services, combos, catalog suggestions, RLS, audit |
| `20260928100200_m2_staff.sql` | Staff, staff locations/services, schedules, time off, stats, staff helpers, RLS, audit |
| `20260928100300_m2_crm.sql` | Business customers, possible duplicates, claim dismissals, notes, RLS, audit |
| `20260928100400_m2_billing_placeholders.sql` | Plans, entitlements, subscriptions, `has_entitlement`, RLS, audit |
| `20260928100500_m2_slug_checks_explicit.sql` | D8: search-path-independent slug checks |

## Tests executed

Shared fixtures: `supabase/tests/helpers/fixtures.psql` (users, role switching, businesses with locations and owners, staff, services).

| Suite | Tests | What it proves |
|---|---|---|
| `080_business_core` | 22 | Bootstrap (settings, launch plan, primary category), entitlements, slug rules (reserved words, area slugs, format, history, reclaim, cross-business block), one owner, one primary location, split hours + overlap exclusion, cross-tenant hours rejected, public visibility (live / test / paused) |
| `090_services_staff` | 32 | All price-type rules incl. NULL cases, staff flag combinations, cross-tenant FKs (staff↔service, staff↔location, hours business id, hours at an unlinked location), specialty cap, override shape rules, split shifts, effective-dated hours, day-off vs working override, open-ended time off rejected, **M2 DoD demo business** (2 staff with different overrides, split shifts, a closure) |
| `100_crm` | 10 | Immutable attribution, shadow phone uniqueness, same phone at another business, user record coexisting with an unclaimed shadow (explicit claim model), one record per user, merge bookkeeping, `claimed_at` needs a user, notes can't cross tenants |
| `110_business_rls` | 33 | Role matrix: other-business owner sees and changes nothing; owner (team, profile, status blocked, all time off, audit actor); manager (prices, settings, staff; login linking and members RPC-only); reception (reads services, can't price or add staff, **no time-off reasons**, customers via RPC only, writes notes, own membership only); staff (own schedule, own time off, own stats; no customers or notes); customer (nothing); anon (no access); admin (reads all) |
| M1 suites (000–070) | 101 | Still green over the new schema (hygiene checks every new table and function) |

### Results

| Where | Result |
|---|---|
| Local (`db reset` from zero) | ✅ all 16 migrations |
| Local `supabase test db` | ✅ **198/198** |
| Local `db lint` (app schemas) | ✅ no issues |
| `pnpm check` | ✅ |
| CI run `36353045895` on `f961cae` | ✅ Quality · ✅ Database (reset from zero → 198 pgTAP → lint) · ✅ Build · ✅ E2E |

## Deviations from the Phase 3 specification

| # | Spec | Change | Why |
|---|---|---|---|
| **D1** | Part 2 `services` and `staff_schedule_overrides` CHECKs | Guard comparisons with `IS NOT NULL` | **Spec bug found by tests:** a CHECK that evaluates to NULL passes, so a range price without a max and a working override without an end time were accepted |
| **D2** | Part 2 `staff_weekly_hours`, `staff_schedule_overrides` | Add FK `(staff_id, business_id) → staff_members` | **Spec gap:** the `staff_locations` FK didn't tie the row's own `business_id` (which RLS uses) to the staff member's business |
| D3 | Part 2 `staff_services` | Override shape checks (range needs a max; a max only with range), NULL-safe | Same rules as `services`; closes the same NULL hole |
| D4 | Part 2 override "day off vs working" constraint trigger | Not created | The exclusion constraint already guarantees it (a day-off row covers 0–1440), and a test proves it |
| D5 | Part 6 §3.3: plans readable by owner/manager | Any signed-in user can read active plans and entitlements | Not sensitive; avoids a join-heavy policy. Subscriptions stay owner/manager |
| D6 | Additive constraints | `website_url` must be http(s); location name ≤ 80; time off must have finite bounds; `business_customers` FKs for `merged_into_id` / `preferred_staff_id` / `favorite_service_id` with checks (merged ⇒ archived, claimed ⇒ has user); `catalog_suggestions.service_id` composite FK | Data integrity; nothing the spec allows is blocked |
| **D8** | Part 2 slug CHECKs on `citext` | Explicit `::text` casts (new migration) | Operator binding depended on the DDL search path, so local and hosted enforced different rules (found by staging fingerprint) |
| D7 | `business_categories` writes | Owner/manager may add/remove **secondary** categories only; the primary row follows `businesses.primary_category_id` automatically | Keeps one source of truth for the primary category |

**Known limitation (to address in M3):** `audit.entity_changes.row_id` is a single uuid. For composite-key tables (`staff_services`) it records `staff_id`, and an UPDATE diff doesn't include `service_id`. I'll add the full key to the audit payload in M3, where booking tables need it too.

## Suggested manual checks

1. **Reserved slugs:** is anything missing that should never become a business URL (e.g. your brand name, `pricing`, `partners`)? The list is in `20260928100000_m2_businesses.sql`.
2. **Launch plan entitlements** (`crm`, `advanced_analytics`, `staff_max = 100`, `multi_location = false`, `promotions = false`, …): these are placeholders only. Confirm the keys make sense to you.
3. **RLS choices worth a second look:**
   - reception can't read `business_customers` directly (CRM RPCs come in M5/M6)
   - staff can't read customer notes directly
   - only owners can submit verification
4. **Defaults** in `business_settings` (1 h minimum notice, 30-day horizon, 15-min slots, 2 h cancellation window, 4 h request expiry): these become every new salon's starting point.
