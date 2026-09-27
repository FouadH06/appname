# M1 — Database foundations: report

Status: **closed** (reviewed + hosted staging verified) · Branch `m1-database-foundations` → merged to `main`

## Hosted staging verification (2026-09-28)

Staging project `oplwsnpyavnqnhlzyhxr` (Frankfurt, Postgres 17.6.1.166). No real customer or business data was used. Test runs are transactional, and a residue check confirmed nothing remained.

| # | Check | Result |
|---|---|---|
| 1 | Repo linked to staging (CLI login role, no DB password shared) | ✅ |
| 2 | M1 migrations applied from zero (`db push`, dry run first) | ✅ 11/11 (incl. the alignment migration below) |
| 3 | Seed: catalog and location reference data (lives in migrations; `seed.sql` is local-only fixtures and isn't pushed) | ✅ row counts identical to local |
| 4 | `app_owner` ownership model on hosted | ✅ role created, all 18 relations / 16 functions / 54 enums owned by `app_owner`, trigger on `auth.users` installed. **The open risk is closed** |
| 5 | Grants and RLS | ✅ full pgTAP suite on staging: **101/101** |
| 6 | Definer functions via `private.uid()`/`private.jwt()` | ✅ covered by the identity, audit and catalog suites (is_admin aal2, is_active_customer, audit actor attribution) |
| 7 | Anonymous/public default-deny through the real Data API (`scripts/hosted-smoke.sh`) | ✅ **11/11**: catalog readable, hidden category invisible, profiles/admin/catalog writes → 401, `private`/`audit` not exposed |
| 8 | Hosted lint (`db lint --linked`, app schemas) | ✅ no issues |
| 9 | Hosted schema = local schema (`supabase/diagnostics/schema-fingerprint.sql`, 11 catalog fingerprints) | ✅ **identical** |
| 10 | No leftover data (`supabase/diagnostics/data-residue.sql`) | ✅ 0 users, profiles, admins, rate-limit rows, human audit rows |

### What staging revealed (and the fixes)

| Finding | Fix |
|---|---|
| Hosted grants `service_role` DML on new `public` tables via platform default privileges; local didn't (**40 grants differed**). `anon`/`authenticated` were identical | New migration `20260927211000_m1_service_role_grants.sql` grants it explicitly (matches Phase 3 Part 1 §6.1: service_role is server-only and bypasses RLS). `audit`/`private` stay closed to it. Two hygiene tests added |
| Hosted CLI connects as a temporary `cli_login_postgres` role without `extensions` on `search_path` → pgTAP functions not found | Test files set `search_path` and `role postgres` explicitly (test-only change) |
| `db dump --linked` fails through the pooler with the temporary login role (CLI limitation) | Schema comparison via catalog fingerprint instead, which is more targeted than a dump diff anyway |
| Index definitions printed differently (opclass schema-qualified or not) | Cosmetic; fingerprint pins `search_path` |

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
| Seed data | 8 governorates, 4 districts, 10 areas (22 location rows) with centroids and 30 aliases; 4 clusters (3 live, exactly the locked areas); Beauty & Grooming with 8 subcategories (Laser & Aesthetics hidden); 6 rating dimensions; 31 canonical services + fallback; EN/AR/FR + colloquial/Arabizi synonyms | Locked decisions |

## Migrations created (`supabase/migrations/`)

| # | File | Contents |
|---|---|---|
| 1 | `20260927210000_m1_extensions_roles_schemas.sql` | Extensions, `app_owner`, `private`/`audit` schemas, default-deny privileges, `set_updated_at`, `assign_app_ownership` |
| 2 | `20260927210100_m1_enums.sql` | 54 enums (extracted verbatim from the spec) |
| 3 | `20260927210200_m1_helpers.sql` | `jwt`, `uid`, `is_anonymous`, phone + search normalization |
| 4 | `20260927210300_m1_audit.sql` | Audit tables, `audit.capture`, immutability triggers |
| 5 | `20260927210400_m1_rate_limits.sql` | `private.rate_limits`, `hit_rate_limit` |
| 6 | `20260927210500_m1_admin_users.sql` | `admin_users`, `is_admin` (aal2), RLS |
| 7 | `20260927210600_m1_locations_catalog.sql` | Areas, aliases, clusters, categories, rating dimensions, canonical services, synonyms, RLS, catalog audit triggers |
| 8 | `20260927210700_m1_profiles.sql` | Profiles, auth sync trigger + backfill, `is_active_customer`, RLS, device/IP tables |
| 9 | `20260927210800_m1_seed_locations.sql` | Governorates, districts, areas, aliases, clusters |
| 10 | `20260927210900_m1_seed_catalog.sql` | Categories, rating dimensions, 31 canonical services + fallback, 199 synonyms |
| 11 | `20260927211000_m1_service_role_grants.sql` | Explicit `service_role` DML on `public` (local = hosted); added after staging verification |

TypeScript types regenerated: `packages/db/src/database.types.ts` (920 lines).

## Tests executed

| Suite | Tests | What it proves |
|---|---|---|
| `000_harness` | 3 | pgTAP runs; Postgres ≥ 15 |
| `010_schema_hygiene` | 10 | RLS on every public table; anon reads only reference tables; no client grants in private/audit; service_role can't modify audit; definer functions pin `search_path` and never call `auth.*()`; nothing executable by PUBLIC; everything owned by `app_owner` |
| `020_phone` | 16 | Lebanese formats (03/70/71/76/81, landline, +961, 00961), Arabic-Indic digits, foreign numbers, invalid input |
| `030_search_normalization` | 18 | Arabic normalization (hamza, ta marbuta, harakat, tatweel), French accents, Arabizi folding, synonym/alias matching incl. fuzzy |
| `040_audit` | 10 | Insert/update capture with diffs, no-op skipped, admin actor attribution, UPDATE/DELETE/TRUNCATE rejected for every role, clients can't read audit |
| `050_identity` | 20 | Auth → profile phone sync (E.164, verified flag, later confirmation), anonymous/suspended users aren't customers, `is_admin` requires aal2 + role, profile RLS incl. column-level protection |
| `060_catalog` | 17 | Seed integrity (clusters = exactly the locked areas, dimensions, EN+AR synonyms), anon read rules, customers can't write, ops need MFA, catalog edits audited |
| `070_rate_limits` | 5 | Window limit enforced; clients can't call it directly |

### Results

| Where | Result |
|---|---|
| **Local** (Docker, Supabase Postgres 17.6) | `supabase db reset` ✅ all 10 migrations + seed · `supabase test db` ✅ **99/99** · `supabase db lint` (app schemas) ✅ no issues · `pnpm check` ✅ |
| **CI** run `36345606341` on `781b510` | Quality ✅ · **Database ✅** (db start → reset → pgTAP → lint) · Build ✅ · E2E ✅ |

Three CI iterations were needed. Each exposed something real, and each fix is in its own commit:
1. `permission denied for schema auth` → deviation D1 below.
2. The catalog seed's `UNION ALL` produced `text` instead of the enum → explicit casts.
3. The hygiene test found 14 functions executable by PUBLIC. Per-schema default privileges can't revoke the global EXECUTE default, so the revoke is now global.

## Deviations from the Phase 3 specification

| # | Spec | What changed | Why | Impact |
|---|---|---|---|---|
| **D1** | Part 1 §7: `private.uid()` = `select auth.uid()` | `private.jwt()` / `private.uid()` read `request.jwt.claims` directly. All definer functions use them (hygiene test enforces) | `app_owner` can't be granted the `auth` schema: the Supabase migration role has no grant option (the GRANT silently does nothing) | Identical behavior; architecture unchanged. RLS policies may still use `auth.uid()`. Spec amended; decision log entry |
| D2 | Phase 4 M1 scope | `has_business_role`, `my_business_ids`, `my_staff_id`, `my_staff_ids`, `catalog_suggestions` move to M2 | They reference M2 tables (SQL functions are validated at creation) | Sequencing only |
| D3 | Part 5 §8 audited-table list | Also audit catalog edits (categories, canonical services, synonyms, rating dimensions) | These change search and moderation behavior; ops edits should be traceable | Additive |
| D4 | Part 1 §4 extension list | pgTAP installed by the test suite, not by migrations | Test-only dependency shouldn't exist in production | None |
| D5 | CI (not spec) | `scripts/ci-annotate.sh` surfaces failure output as public annotations; CI runs on all branches; lint limited to app schemas | Job logs require sign-in; branch CI before merge; PostGIS internals aren't ours to lint | Tooling only |

| D6 | Part 6 §2 baseline privileges | `service_role` gets explicit DML on `public` tables (new migration) | Hosted already grants it via platform defaults; local must match. Consistent with Part 1 §6.1 | Local = hosted; no client-role change |

**Open risk, resolved 2026-09-28:** the `app_owner` ownership model was verified on hosted staging (see top of this report).

## Suggested manual checks

1. **Catalog wording:** skim `20260927210900_m1_seed_catalog.sql`. Are the service names, Arabic names and Arabizi spellings what Lebanese customers actually type? Anything missing (e.g. "brushing" variants, "lissage", "protéine")?
2. **Areas:** in the local Studio (`pnpm db:start` full stack, or any SQL client on port 54322), check the area names, Arabic spellings and centroids for Achrafieh, Mar Mikhael, Hamra, Verdun, Hazmieh and Baabda. Centroids are approximate.
3. **Clusters:** confirm the clusters should contain exactly the named areas (Gemmayzeh and Ras Beirut exist but are outside clusters for now).
4. **Hidden category:** "Laser & Aesthetics" is seeded but not live, per the locked decision.
5. **Try the normalization yourself** (psql on `postgresql://postgres:postgres@127.0.0.1:54322/postgres`):
   `select private.search_key('7ala2'), private.normalize_phone('03 123 456'), private.search_key('الأشرفية');`
