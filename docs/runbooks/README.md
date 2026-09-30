# Runbooks

Short, operational. Every action below goes through the admin console (audited, reason code required) or
a documented SQL statement run by the superadmin in the Supabase SQL editor. Never edit production rows
by hand outside these steps. Record every incident in the incident log (bottom).

**Where to look first:** admin → **System** (jobs, queues, delivery rates, alerts) and **Overview**
(queue tiles, cluster health). Uptime: `https://<web>/api/health?deep=1` (503 = database unreachable).

---

## 1. Double booking reported

The database makes overlapping bookings for the same staff member impossible (one exclusion constraint
covers holds and bookings), so a "double booking" is almost always one of: two staff with similar names,
a manual booking the business created on top of a walk-in, a reschedule the customer didn't notice, or
a calendar kept outside APP_NAME.

1. Admin → Businesses → the business → **Audit** link; filter by the booking reference(s).
2. Compare both bookings' staff, times and `booking_events` (who created / moved each, and when).
3. If both are really on the same staff at overlapping times with `blocks_time`: **treat as Sev 1**
   (the core guarantee failed) — pause online booking for that business (Businesses → status → paused,
   reason `incident`), capture both rows and events, escalate to engineering.
4. Otherwise explain the cause to the business; if a customer was turned away, support contacts them.

## 2. WhatsApp outage / messages not arriving

Signals: System → alert *WhatsApp delivery below 90 %* or *Messages waiting more than 15 minutes*;
businesses reporting missing confirmations.

1. Check Meta's status page and the WhatsApp Manager (quality rating, template status, phone number limits).
2. Critical booking messages fall back to SMS automatically (confirmations, reminders, changes). Confirm
   SMS attempts are succeeding (System → delivery → sms).
3. If WhatsApp is down for > 30 min: tell pilot businesses (WhatsApp broadcast from the ops phone or a
   call) that confirmations arrive by SMS; nothing else changes — bookings still work.
4. If *SMS* is also failing: check Twilio console (balance, number status, carrier filtering for +961).
5. A dispatcher run that died mid-batch leaves rows in `processing`; they are retried automatically once the
   claim is 10 minutes old (at most 5 attempts, then `failed`). Delivery is at-least-once: a customer may
   rarely get the same message twice after an outage.
6. After recovery: System → delivery rates back above 90 %; failed rows stay failed (customers were
   informed by the other channel or will see the booking in the app / My bookings).

## 3. Moderation backlog

Signals: System → *Review comments waiting > 1 h* / *Customer photos waiting > 30 min*; Overview queue tiles
overdue.

1. Stars are already public (event-driven publication); only comments / photos wait. No customer impact
   beyond delay.
2. Assign moderators (Admin → Moderation, oldest first; overdue cases are highlighted).
3. If the `moderate` or `media-orchestrator` job is failing (System → jobs): check the Edge Function logs
   in Supabase; common causes: expired `ANTHROPIC_API_KEY`, provider rate limit, worker host down
   (`apps/media-worker` health endpoint). Without the LLM, everything routes to humans — it never auto-publishes.
4. Media worker down: restart the container; pending photos resume automatically.

## 4. Account deletion

Customers delete from Profile (app) or the account page (web). Deletion is processed every 15 minutes.

1. System → *Account deletions overdue or needing support*.
2. `needs_support` = the account is the **active owner of a business**. Contact the owner: transfer
   ownership (Businesses → members) or close the business first; then re-queue:
   `update private.account_deletions set status = 'requested', note = null where user_id = '<id>';`
3. The job cancels future bookings (business notified), removes the person's reviews and photos, disables
   app push, drops favorites and anonymizes the profile; within 15 more minutes the Auth record is scrubbed
   (phone, email, sessions, sign-in methods removed; `auth_deleted_at` set). Businesses keep their own
   customer record (name/phone they entered), as designed.
4. Confirm to the requester (support channel) once `auth_deleted_at` is set.

## 5. Legal request (data access, removal, law enforcement)

1. Log it (who, what, when, legal basis). Only the **superadmin** handles legal requests.
2. Data-subject access (Law 81/2018): export the person's profile, bookings, reviews and messages via the
   admin customer page + audit log; send through the verified phone owner only.
3. Content removal (defamation etc.): Admin → Reviews / Disputes (legal type, superadmin only). Set
   `legal_hold` instead of deleting when evidence must be preserved.
4. Law-enforcement requests: require a written, official request; involve counsel before releasing data.

## 6. Scheduled job failing or late

Signal: System → job *failing* or *late*.

| Job | Effect when broken | First check |
|---|---|---|
| `app_notify_dispatch` | messages queue up | Vault secrets `notify_dispatch_url/secret`; Edge Function logs |
| `app_expire_holds` / `app_expire_requests` | held slots stay blocked / requests don't expire | DB errors in job message |
| `app_auto_complete` | visits stay "confirmed" → no review requests | job message |
| `app_search_refresh` | search shows stale data | queue size in System |
| `app_moderate` / `app_media_orchestrate` | comments / photos wait | Vault secrets; Edge Function logs |
| `app_nightly`, `app_quality_scores`, `app_daily_metrics` | stale reliability, ranking, analytics | job message; re-run manually (below) |
| `app_cron_health` | System page goes blind | pg_cron itself |

Manual re-run (superadmin, SQL editor): `select private.job_daily_metrics();`,
`select private.compute_quality_scores();`, `select private.job_nightly();`.

## 7. Restore from backup

1. Decide the recovery point (Supabase dashboard → Database → Backups / PITR).
2. **Restore into a new project first**, never over production, unless production is unrecoverable.
3. On the restored project: run `supabase/tests/database/010_schema_hygiene` and
   `340_security_review` (ownership and grants must survive — a logical restore by a role that can't
   `SET ROLE app_owner` loses them; see the M14 report), then a smoke: business page, search, a hold.
4. Swap: point the web app / app env at the restored project, or restore in place per Supabase support.
5. Re-register Vault secrets and Edge Function secrets if the project changed.

## 8. Incident communication

- **Sev 1** (bookings impossible, data exposure, double booking confirmed): pause affected surfaces, notify
  pilot businesses within 30 min by WhatsApp/phone, write the timeline as you go.
- **Sev 2** (messages delayed, search stale, moderation backlog): fix, then inform affected businesses if
  customers noticed.
- Afterwards: incident log entry — what happened, impact, root cause, fix, follow-up.

### Incident log

| Date | Sev | Summary | Root cause | Follow-up |
|---|---|---|---|---|
| — | — | — | — | — |
