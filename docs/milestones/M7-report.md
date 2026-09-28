# M7 — Notifications & WhatsApp: report

Status: **closed** (approved 2026-09-28: D1–D9, reception alerts, quiet hours, final copy) · merged to `main`

Hosted staging verification is deferred together with M4–M6 (see the M4 report checklist, now
including M7). Real WhatsApp / SMS delivery needs the external accounts (Meta business number and
approved templates, Twilio) and is a launch dependency, not a milestone blocker.

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| Outbox & delivery model | `notifications` (outbox + in-app inbox), `notification_deliveries` (one row per provider attempt, receipts), `notification_templates` (EN + AR, WhatsApp + SMS), `notification_preferences`, `business_notification_settings`, `push_tokens` (ready for the app), `private.whatsapp_inbound`, `private.notification_routes` | Part 5 §6 |
| Enqueueing | One trigger on `booking_events` turns every booking change into messages, using the choices the business already makes ("Send confirmation", "Notify"): confirmation (online, or manual with notify), request received / accepted / declined / expired, cancelled by the business (with reason; never for Undo), moved by the business (old and new time), staff changed (mandatory when requested — M3 rule), no-show marked. Business alerts: new online booking, new request, customer cancellation | Part 3 §4.3 step 11, §4.4 |
| Reminders | 24 h and 2 h before; skipped when booked closer than that; a reschedule cancels the old ones and schedules new ones (start time in the dedupe key); cancellation, completion or no-show cancels them; stale reminders are cancelled at dispatch time instead of sent | Part 5 §6 |
| Links | Every customer message carries a link: `claim_visit` for business-created bookings of customers without an account (lets them claim the visit), `manage_booking` otherwise — both open `/m/{token}` | Part 3 §4.4, M4 |
| `notify-dispatch` Edge Function | pg_cron every minute → pg_net → function (shared secret from Vault; nothing is called when nothing is due). Claims due rows with `for update skip locked` (a double or parallel run never sends twice), renders per locale in Beirut time, sends WhatsApp **template** messages with Confirm / Cancel quick-reply payloads, falls back to **SMS** for critical booking messages, records every attempt, retries temporary errors (1 / 5 / 15 min, max 4 attempts) | Part 5 §6 |
| Templates | EN + AR copy for 14 message types, WhatsApp (to submit to Meta; `{name}` → `{{n}}` in `variables` order) and SMS. The customer's locale is used when its WhatsApp template is approved, else English; with no approved WhatsApp template, critical messages go by SMS | Part 5 §6 edge cases |
| Receipts & fallback | WhatsApp / Twilio status callbacks update deliveries (never backwards, e.g. delivered → sent). A critical WhatsApp message that fails after being accepted (e.g. not a WhatsApp number) is retried once by SMS. OTP receipts keep working (unknown ids pass through to the M4 table) | Part 5 §6 |
| WhatsApp buttons | **Confirm** → `customer_confirm_attendance`: only when the sender's number is the booking customer's; sets `customer_confirmed_at`, logs `customer_confirmed` (shows in the booking timeline). **Cancel** → replies with the booking link; never cancels directly (policy first). Replies are sent in the customer's open 24 h session, in their language. Idempotent per WhatsApp message id | Part 5 §6 |
| Preferences & inbox | `get/set_notification_preference` (at least one of WhatsApp / SMS / app must stay on — `LAST_CHANNEL`); `get_my_notifications`, `mark_notifications_read` | Part 5 §6 |
| B12 Settings › Notifications | Team alerts on WhatsApp per member and type (default owners + managers; members without a phone flagged), what customers receive, last-7-days delivery numbers | Phase 2 B12 |
| B2 Overview | "N customer messages couldn't be delivered this week" attention item | Plan M7 frontend |
| Customer preference component | `NotificationPreferences` (used on `/account/notifications` now; the app later) | Plan M7 frontend |
| Ops report | `admin_notification_stats(days)`: per type total / sent / delivered / failed / SMS fallbacks / success rate / **confirmed by button** (DoD: ≥ 95 % delivery; Confirm usage measured) | Plan M7 DoD |

## Migrations created

| File | Contents |
|---|---|
| `20261003100000_m7_notifications.sql` | Tables, RLS, routing, enqueue trigger, reminders, dispatch RPCs (service_role only), receipts + fallback, buttons, preferences, inbox, business settings, health, ops report, cron job |
| `20261003100100_m7_templates.sql` | EN + AR templates (WhatsApp draft until Meta approval, SMS approved) |

## Tests executed

| Layer | Result | What it proves |
|---|---|---|
| pgTAP | **610/610** (49 new in `260_notifications`) | Confirmation + link queued only with "Send confirmation"; reminder times; no reminders when booked < 2 h ahead; only the 2 h one when < 24 h; reschedule cancels and re-creates reminders and tells the customer the old time; business cancellation with reason; **Undo sends nothing**; customer cancellation alerts owners (not reception) by default; alert settings (reception only their own; staff refused); dispatcher RPCs **service_role only**; claim returns only due rows with WhatsApp → SMS order and the template; **a second claim returns nothing**; failed WhatsApp receipt → one SMS retry (SMS only); receipts never go backwards; backoff then failure after 4 attempts; **Confirm from another number refused**, from the customer's number confirms, duplicate webhook handled once, Cancel never cancels; Arabic → approved English template; preferences (last channel kept); inbox only your own; ops-only report |
| Edge unit (Vitest) | **45** (13 new) | Beirut-time rendering per locale, tidy text with missing values, non-empty WhatsApp parameters, Confirm/Cancel payloads; dispatcher: WhatsApp send, **SMS fallback**, unapproved template → SMS in live / sent in log mode, retry vs fail, no channel, **double run sends once**; Meta template + quick-reply request body; Twilio mapping; config; signed webhook button → database + session reply; unsigned ignored |
| E2E web (local stack) | **14 passed** (1 new) | Reception books a regular customer with "Send confirmation" → confirmation + 24 h + 2 h reminders queued; **the real `notify-dispatch` function** sends the due confirmation (log provider) and refuses calls without the secret; a **signed WhatsApp Confirm webhook** from the customer's number confirms attendance and the timeline shows it; manager changes team alerts (persisted); overview flags failing customer messages |
| Also verified locally | ✅ | pg_cron → Vault → pg_net → `notify-dispatch` sends a queued message within a minute |
| E2E admin, harness, lint, typecheck, format, DB lint, builds | ✅ | |

## Deviations for your approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | Part 5 §6 | Enqueueing is a trigger on `booking_events` rather than code in each booking RPC | One place; uses the notify choices the RPCs already record; no booking write path changed |
| D2 | Part 5 §6 table | `notifications.channel_override` added | Receipt-driven SMS fallback for a WhatsApp message that fails after being accepted |
| D3 | Dispatch config | Dispatcher URL + shared secret in **Vault**; the cron job is inline SQL; web base URL for links in `private.app_settings` | The app-owned definer role can't read Vault; secrets stay out of migrations |
| D4 | Links | Links open `/m/{token}` (booking summary + claim, M4). Cancel / reschedule from the link arrive with the booking pages in M8 | M8 owns C12/C13 |
| D5 | Buttons | Confirm / Cancel on the 24 h and 2 h reminders; reschedule is the link in the message, not a third button | WhatsApp quick replies; Cancel/reschedule both go through the booking page |
| D6 | Routing | "Marked no-show" is critical (SMS fallback) | The customer must be able to contest it |
| D7 | Business alerts | WhatsApp only (push once the app exists; `push_tokens` ready); default owners + managers; first change for a type keeps the defaults explicitly | No app yet; nobody silently loses alerts |
| D8 | Scope | In-app inbox: RPCs only (UI with the app / M8); customer preferences page minimal at `/account/notifications`; inbound WhatsApp text (not buttons) not handled yet | Customer surfaces are M8 |
| D9 | Tooling | Local-only secrets in `config.toml` (dispatch secret, Meta app secret, verify token) and seed Vault entries; test number `70 000 011`; the e2e DB pool is recreated per spec file | Lets e2e call the real functions with signed requests |

## Known gaps / notes

- **DoD is external**: pilot customers receiving messages and ≥ 95 % delivery over a week need the
  Meta number with approved templates (submit the copy in `20261003100100_m7_templates.sql`) and
  a Twilio account; then set `status = 'approved'` per template. `admin_notification_stats`
  measures delivery and Confirm-button usage.
- Hosted setup (deferred with M4–M6): deploy `notify-dispatch` + updated `whatsapp-webhook`, set
  `NOTIFY_DISPATCH_SECRET`, create the two Vault secrets, set `web_base_url`
  (`supabase/functions/.env.example`).
- Review requests (M9), waitlist offers and the business daily summary come later.
- No quiet hours (not in the spec): a 2 h reminder for an 8:00 appointment goes out at 6:00.

## Suggested manual checks

1. Read the EN / AR message copy in the templates migration — tone and length OK for WhatsApp?
2. Should reception get new-booking alerts by default, or only owners and managers (current)?
3. Do you want quiet hours (e.g. no messages 22:00–08:00, reminders moved earlier)?

## Approval follow-ups (before merge)

- **Reception gets the operational alerts by default** (new online booking, new request, customer
  cancellation), with owners and managers; staff don't. Changeable in Settings › Notifications.
- **Quiet hours** (business setting, default 22:00–08:00, location time zone; Settings ›
  Notifications): confirmations, request outcomes, cancellations, reschedules, staff changes and
  no-shows send immediately; a 24 h reminder that falls inside quiet hours moves to their end (if
  still ≥ 2 h before the visit); a **2 h reminder inside quiet hours is skipped** (8:00 visit → no
  6:00 message, the 24 h one remains). Team alerts wait for the end of quiet hours unless the
  appointment starts, or a request expires, within 2 h after that.
- **Copy for review**: `docs/notifications/templates.md` (every EN + AR WhatsApp and SMS message
  rendered with sample values, buttons and links as the customer sees them). To meet Meta's rules
  the WhatsApp bodies no longer start/end with a variable and carry no links: links are URL
  buttons (**View booking** → `/m/{token}`, **Book another time** → `/{slug}`, **Open bookings**
  for the team); SMS keeps the link written out. Copy source: `scripts/notification-templates.py`.
- Tests: pgTAP +5 (8:00 visit keeps only the 24 h reminder; 23:30 visit's 24 h reminder moves to
  08:00; team alert at 23:00 waits; a request expiring early is surfaced now; daytime immediate;
  reception default), edge unit tests for URL buttons and the reason sentence.
- **Final copy changes (approved)**: reminder quick reply renamed **Change / Cancel** (تعديل / إلغاء)
  — tapping it replies with the booking-page link (policy shown before confirming); 2 h reminder
  asks "Please confirm that you're still coming."; expired requests say "Your request expired.";
  new **customer cancellation acknowledgement** (`booking_cancelled_by_customer`, sent only after
  the cancellation succeeds, not for account deletions, with **Book another time**); Arabic dates
  use Latin digits with Levantine month names ("الثلاثاء، 13 تشرين الأول الساعة 4:30 م").
  Final rendering: `docs/notifications/templates.md`.
