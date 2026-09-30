# M14 — Analytics, hardening & launch preparation: launch-readiness report

Status: **approved 2026-09-30** (decisions below) · branch `m14-launch` · branch CI green on `1c1d5a1` (run 36712513599: format/lint/typecheck/unit/audit, build, pgTAP, web + admin + app e2e)

Lean scope per the PO: real launch risks only. This report separates what the code proves from what only
staging, real devices and real providers can prove — **CI green does not mean launch-ready.**

## Readiness at a glance

| Level | Meaning | Status |
|---|---|---|
| **Code-complete** | every milestone M0–M14 merged, full regression + CI green | ✅ after this milestone merges (all features for launch built; local regression green) |
| **Staging-verified** | migrations M4–M14 applied and smoke-tested on hosted staging, restore drill done | ❌ staging still runs the M3 schema — checklist §A |
| **Pilot-ready** | + real WhatsApp/SMS, production config, real-phone funnel, native app builds, pilot businesses ready | ❌ blocked on external accounts (Meta, Twilio, Apple, Google, domain, Turnstile keys) and staging — §B–E |
| **Launch-ready** | + legal texts, hosted load/security re-run, Gate D (50–70 businesses, 4-week pilot metrics, store approvals) | ❌ — §F–H |

The single source of truth for what remains: [`docs/launch/pre-real-user-checklist.md`](../launch/pre-real-user-checklist.md).

## Built

| Area | Contents |
|---|---|
| **Analytics (B11)** | `business_daily_metrics` / `staff_daily_metrics` (Phase 3 Part 5 §7) rebuilt nightly for the last 7 days (`app_daily_metrics`), 400-day backfill on deploy; `biz_get_analytics`: KPIs vs the previous period (revenue, completed, unique customers, new vs returning, average value, cancellation, no-show, utilization), daily trend, top services, source mix, team table; **today is always live**. Revenue "estimated" for from/range prices. Owner/manager see revenue; reception counts only unless `reception_sees_revenue`; staff no access. Web dashboard page (tiles 2-col on phones) |
| **Monitoring** | `app_cron_health` snapshots every `app_*` job's last run (pg_cron is only visible to the job owner, so the snapshot runs as a cron statement) → `admin_system_health` (ops): failing/late jobs, queue backlogs (messages, search refresh, photos, comments, account deletions), delivery rate per channel (24 h), DB size, alerts. Admin **System** page. `health_ping` + `/api/health?deep=1` for an uptime monitor. pg_cron run history pruned to 7 days |
| **Launch readiness** | `admin_launch_readiness` (ops): Gate D cluster counts vs target and ≥ 15, category coverage; per live business the go-live checklist + contact, map pin, public staff, description, owner account, bookings 14 d, failed messages 7 d; platform settings (link domain, WhatsApp templates approved, ranking active, quality-score freshness, test businesses). Admin **Launch** page |
| **Security review** | Frozen as `340_security_review` (with the existing `010_schema_hygiene`): exact anonymous RPC surface (18 read/lookup functions), every `admin_*` gated on an admin role, every `biz_*` on membership, client-callable private helpers = the reviewed RLS/storage predicates, dispatcher/worker RPCs service-role only, bucket visibility, no client read of private uploads, no client UPDATE or writes to public/staging buckets, size/type limits on every bucket, no client writes to rollups/push tokens/favorites |
| **Backups** | `scripts/backup-restore-check.sh`: logical dump → restore into a scratch database → compare every table's row count, functions, policies, triggers, schema fingerprint, and ownership/grants |
| **Load** | `scripts/load-check.mjs`: closed-loop readers + anonymous hold/release sessions (local-only guard) |
| **Config / dependencies** | `docs/launch/config-and-secrets.md` (every variable, production value, unsafe defaults); secret scan of tracked files; `pnpm audit` gate (high/critical) in CI |
| **Operations** | `docs/runbooks/README.md`: double booking, WhatsApp outage, moderation backlog, account deletion, legal request, job failing, restore, incident comms + log |
| **Legal placeholders** | `/terms`, `/privacy` (existing), new `/review-guidelines` (footer link, reserved slug) — texts are a PO/counsel task |
| **M13 follow-ups** | Contact Support entry and dispute WhatsApp + push (done before the M13 merge) |

## Launch risks found and fixed

1. **Silent message loss.** A dispatcher run that died mid-batch (Edge Function timeout, crash) left
   rows in `processing` forever — never retried, never alerted. Now: `claimed_at`; unfinished claims are
   retried after 10 min, failed after 5 attempts (at-least-once; a rare duplicate after an outage is
   possible); System shows stuck rows.
2. **Account deletion was still the M4 skeleton.** It anonymized the profile but kept the person's reviews
   and photos, push tokens, favorites and the Auth record (phone number). Now the spec'd behaviour: reviews
   and photos removed exactly as when the author deletes them, push disabled, favorites dropped, and the
   Auth user scrubbed (see decision 1).
3. **Web host needs no secret.** The service key was listed for the web app but no code path uses it —
   documented as "do not set" (smaller blast radius).
4. **App booking review race (M13).** CI's fresh database showed a brand-new customer an enabled-looking
   Confirm that disabled once the first-name field appeared; Confirm now renders after the profile check.
5. Minor: `IP_HASH_SECRET` is unused because IP events are never recorded (fraud uses the device hash) —
   documented, no raw IPs stored.

## Results

| Check | Result |
|---|---|
| pgTAP | **973/973** (new: `330_launch` 31 — rollups, analytics roles/live today/idempotency, schedules, system health, readiness, stale claims, account deletion end to end incl. Auth scrub; `340_security_review` 10) |
| Unit | 197 passed, 3 skipped (edge 97, api 21, core 20, ui-web 23, media-worker 13, web 13, admin 5, i18n 5) |
| Web e2e | **22 passed**, 14 skipped (project split). Final serial run: 20 passed, 2 failed — the analytics spec (first test of the run, cold dev-server compile before the code field appeared) and the search suggestion (known timing flake); both pass on rerun. New: B11 analytics (manager sees revenue, reception doesn't), deep health |
| Admin e2e | 1 passed (now also opens System and Launch) |
| App e2e (web build) | 1 flow passed (incl. Contact Support) |
| Lint · typecheck · format · db lint (no new warnings) · web + admin builds · app web export | ✅ |
| **Security review** | 0 findings requiring change in RLS/definer/storage; anonymous surface and privileged gating frozen as tests |
| **Secret scan** | 0 secrets in tracked files |
| **Dependencies** | 0 high/critical; 2 moderate in the Expo toolchain (`uuid` via `xcode`, build-time; `decode-uri-component` via `expo-router`, client-side) — accepted, re-check at the EAS build |
| **Backup → restore** | dump and comparison from one exported snapshot while background jobs run: data (136 tables, 3,305 rows), functions, policies, triggers and schema **identical**; ownership/grants **not** restorable by the `postgres` role — see decision 2 |

### Load check (local stack, launch-scale dataset: 105 businesses, 60 s)

25 concurrent readers + 10 anonymous booking sessions, closed loop (no think time):

| RPC | calls | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| `search_businesses` | 8,319 | 79 ms | 166 ms | 249 ms | 0 |
| `search_suggest` | 3,088 | 54 ms | 137 ms | 200 ms | 0 |
| `get_home` | 2,117 | 53 ms | 134 ms | 198 ms | 0 |
| `get_business_page` | 3,064 | 45 ms | 124 ms | 199 ms | 0 |
| `get_available_slots` | 4,330 | 49 ms | 141 ms | 234 ms | 0 |
| `create_hold` | 180 | 81 ms | 255 ms | 381 ms | 0 |
| `release_hold` | 180 | 59 ms | 204 ms | 404 ms | 0 |

**354 req/s, 0 errors.** Estimated 5× launch peak ≈ 10 req/s (50–70 businesses), so the local stack has
~35× headroom; the per-request database times match M3/M12 (search p95 ≈ 30 ms in-database). Numbers
include Docker-on-Windows networking; staging must be re-measured (checklist §G). Reproduce:

```
docker cp supabase/tests/helpers <db-container>:/tmp/ && docker cp scripts/load-dataset.sql <db-container>:/tmp/
docker exec -w /tmp <db-container> psql -U postgres -f /tmp/load-dataset.sql
node scripts/load-check.mjs --seconds 60 --readers 25 --holders 10
npx supabase db reset   # removes the dataset
```

## Decisions (approved by the PO, 2026-09-30)

1. Deleted accounts: keep the **scrubbed Auth record** (phone, email, sessions, sign-in methods removed; sign-in
   blocked; pseudonymous UUID kept for integrity); the Privacy policy must describe this accurately.
2. Restores: rely on **Supabase point-in-time restore**; verify ownership and grants in the staging restore drill.
3. **Sentry (or equivalent) at pilot start**, not an M14 blocker.
4. **Reception may open Analytics without revenue**, unless the owner enables revenue visibility.
5. Meta, Twilio, Apple, Google, domain, Turnstile and production Supabase configuration remain **explicit
   pre-pilot blockers** (checklist §B–D).

## Known limitations

- Staging verification, real providers, native devices and legal texts are not done (checklist §A–F).
- Analytics: no rating column in the team table (reviews are per visit; staff rating was not in the rollup
  spec), no CSV export or heatmap (SOON in Phase 2).
- The load script is local-only by design; a staging run needs the PO's go-ahead.
