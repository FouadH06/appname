# M1 — Database foundations: report

Status: **implemented, awaiting review** · Branch `m1-database-foundations`

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| Extensions | btree_gist, citext, pgcrypto, pg_trgm, unaccent, postgis (in `extensions`), pg_cron, pgmq, pg_net. pgTAP is installed by tests only | Part 1 §4 |
| Ownership | `app_owner` NOLOGIN role owns every table, function and enum in `public`/`private`/`audit`; `private.assign_app_ownership()` runs at the end of every migration | Part 1 §2 |
| Schemas & privileges | `private` and `audit` (not exposed via API); default-deny revokes and default privileges for `postgres` and `app_owner` | Part 1 §3, Part 6 §2 |
| Enums | All 54 enums, extracted verbatim from the spec (incl. `rating_state.pending_check`, `booking_no_show_marked`) | Part 1 §5 |
| Helpers | `private.uid`, `is_anonymous`, `normalize_digits`, `normalize_phone`, `normalize_text`, `arabizi_fold`, `search_key`, `set_updated_at`, `is_admin` (aal2), `is_active_customer` | Part 1 §7, Part 5 §1 |
| Audit | `audit.admin_actions`, `audit.entity_changes`, generic `audit.capture(pk)` trigger (changed-columns diff, actor kind), immutability triggers (UPDATE/DELETE/TRUNCATE) for every role | Part 5 §8 |
| Rate limiting | `private.rate_limits`, `private.hit_rate_limit()` raising `RATE_LIMITED` with retry hint | Part 3 §1.6 |
| Identity | `admin_users` (+ audit), `profiles` with phone-only auth sync (no claims), backfill, RLS (own row; name/locale/area editable only), `private.user_devices`, `private.user_ip_events` | Part 2 §1 |
| Locations | `areas` (governorate → district → area), `area_aliases` (generated search key + trigram index), `clusters`, `cluster_areas` | Part 2 §3 |
| Catalog | `categories`, `rating_dimensions`, `canonical_services`, `service_synonyms` (generated search key + trigram index) | Part 2 §4 |
| Seed data | 8 governorates, 4 districts, 10 areas with centroids and aliases; 4 clusters (3 live, exactly the locked areas); Beauty & Grooming with 8 subcategories (Laser & Aesthetics hidden); 6 rating dimensions; 31 canonical services + fallback; EN/AR/FR + colloquial/Arabizi synonyms | Locked decisions |

## Migrations created

_See final section._

## Tests executed

_See final section._

## Deviations from the Phase 3 specification

_See final section._

## Suggested manual checks

_See final section._
