# M4 — Auth, identity & claim model: report

Status: **closed (local + CI verified); hosted staging verification DEFERRED** · Branch `m4-auth-identity` → `main`

> **Deferred, not cancelled (decision 2026-09-28).** M4 was approved (D1–D9) and merged on the
> strength of local and CI coverage. Hosted staging verification was blocked by a tooling issue
> (the session's command-safety layer) and is an **open integration task that must be completed
> before any real users or launch**. Staging still runs the M3 schema until then. Checklist:
>
> - [ ] Apply the 3 M4 migrations to staging; hosted pgTAP (429); logged-out/API/RLS smoke incl. M4 checks
> - [ ] Hosted Auth configuration: phone sign-in, anonymous sign-ins, phone confirmations, Send SMS hook + secret, TOTP, staging test numbers (`docs/engineering/environments.md`)
> - [ ] Hosted Edge Function deployment (`auth-send-sms`, `whatsapp-webhook`, `twilio-status`) + non-provider secrets: signed hook requests accepted, unsigned rejected, clean `OTP_DELIVERY_FAILED` with no provider configured
> - [ ] Hosted Turnstile with Cloudflare's official test secret (decision 2026-09-28): no token → rejected, official test token → accepted; replace with real staging keys once the staging web app has a domain
> - [ ] Hosted admin MFA/TOTP: enroll, challenge, admin RPCs only at aal2
> - [ ] Hosted claims/invitations smoke: claim link, offers, phone-bound invite accept, wrong number refused
> - [ ] Real WhatsApp Cloud API / Twilio SMS delivery and timing (external: Meta approval, Twilio account); does not block M5
> - [ ] Real-phone checks: iPhone Safari, Android Chrome, Instagram and TikTok in-app browsers (Round 1 local, Round 2 staging)
> - [ ] Staging schema fingerprint = local; zero test residue (users, claims, invitations, OTP rows, audit rows)
> - [ ] Also apply and verify the M5 migrations (business setup, media bucket + storage policies, CRM, team) on staging
> - [ ] Also apply and verify the M6 migration (calendar read models, block time, Realtime publication) on staging; hosted Realtime: a booking change reaches a second signed-in tab, staff only receive their own items
> - [ ] Also apply and verify the M7 migrations; deploy `notify-dispatch` and the updated `whatsapp-webhook`; set `NOTIFY_DISPATCH_SECRET`, the two Vault secrets and `web_base_url`; hosted smoke: a queued message is dispatched by pg_cron, a signed Confirm webhook confirms attendance, receipts update deliveries
> - [ ] Also apply and verify the M8 migration; deploy the web app to staging; Lighthouse on a pilot business page (LCP < 2.5 s on slow 4G, CLS < 0.1); in-app browser matrix for the full funnel (Instagram / TikTok / WhatsApp × iOS / Android): page, phone code, confirm, WhatsApp link → manage
> - [ ] Also apply and verify the M9 migrations (reviews, review notifications/templates, moderation worker, page rating); deploy `moderate`; set `MODERATE_SECRET`, the Vault secrets `moderate_url` / `moderate_secret` and (decision pending) `ANTHROPIC_API_KEY`; hosted smoke: a submitted review's comment is moderated by pg_cron → `moderate`, a rejected comment sends the edit message, the review request is queued 2 h after a completed visit; run the LLM moderation eval gate (Sonnet 5 first; 0 harmful blind held-out comments published) and set `MODERATION_AUTO_PUBLISH=true` only if it passes; submit the 3 review WhatsApp templates to Meta
> - [ ] Also apply and verify the M10 migrations (media pipeline, media reports, result templates); deploy `media-orchestrator`; set `MEDIA_ORCHESTRATOR_SECRET` and the Vault secrets `media_orchestrator_url` / `media_orchestrator_secret`; **deploy the transform worker** (`apps/media-worker` Docker image, 4 vCPU / ≥ 1.5 GB RAM, `CONCURRENCY` ≤ 2 (capped), env `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set on the host only); check the three buckets and their policies (nothing public before approval); hosted smoke: upload → transform → moderator approves → public derivative served, metadata stripped; delete → public objects removed; run the labelled image eval (≥ 90 % automatic decisions correct, 0 falsely public) and set `MEDIA_AUTO_PUBLISH=true` only if it passes; record the cost per 1,000 images from the chosen instance price (method in the M10 benchmark report); submit the 2 result WhatsApp templates to Meta
> - [ ] Also apply and verify the M11 migrations (admin console, disputes, dispute templates, catalog/ranking); confirm pg_cron `app_dispute_default_rules`; create the pilot admin accounts (roles: moderator / support / ops / superadmin, TOTP enrolled); hosted smoke: resolve a no-show dispute end to end (customer + business messages), suspend a test business with upcoming bookings (cancel path), read the unified audit log; submit the 2 dispute WhatsApp templates to Meta
> - [ ] Also apply and verify the M12 migration (search documents, quality scores, search RPCs); confirm pg_cron `app_search_refresh`, `app_search_availability`, `app_quality_scores`; run `select private.compute_quality_scores()` once after real businesses go live; hosted smoke: home rails, suggest, a service search with filters, an SEO landing page, sitemap.xml; set `NEXT_PUBLIC_SITE_URL` for the sitemap; measure search p95 on staging against the 300 ms target; review the top 30 real pilot queries (M12 DoD)

Provider decisions from the M3 review are applied: WhatsApp Cloud API is the primary OTP channel and
Twilio the SMS fallback, both behind one provider interface; Cloudflare Turnstile protects OTP send
and anonymous sign-in (official test keys locally and in CI). Staging setup, real-provider delivery
measurement and phone/in-app-browser testing come after your review (see the end of this report).

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| Phone auth | Supabase phone OTP through the **Send SMS hook** (`auth-send-sms` Edge Function); anonymous sign-ins; Turnstile on OTP send and anonymous sign-in; phone confirmations on; 30 s resend interval | Part 6 §7 |
| OTP delivery | `OtpChannel` providers: `WhatsAppChannel` (authentication template with copy-code button), `TwilioSmsChannel` (localized EN/AR/FR text + Web OTP line for Android autofill), `LogChannel` (local only, refused on hosted). Routing in `public.otp_route`: WhatsApp first; resend after 30 s → SMS; WhatsApp error or not configured → SMS in the same request; SMS only for allowed prefixes; 5 codes / 15 min, 10 / day per number. Receipts via `whatsapp-webhook` and `twilio-status` (signatures checked); `private.otp_deliveries` (30-day retention); `admin_otp_delivery_stats` (median/p90 per channel) | M4 plan, Phase 2 C10 |
| Anonymous → phone | An anonymous visitor's phone is **linked to the same user** (keeps the hold). A number that already has an account **signs into it** instead; the hold is still confirmable by its token | Part 1 §6.1, Part 3 §4.3 |
| Claim model | `private.issue_access_token`, `resolve_access_token` (summary only, never claims), `claim_booking(token)`, `get_claimable_visits`, `claim_visits`, `dismiss_claimable_visits`, `private.link_business_customer` (safe merge) | Part 2 §2.3, Part 3 §4.2 |
| Team | `invite_member` (phone-bound, 7-day token), `get_invitation` (logged-out preview), `accept_invitation` (verified phone must match; links a staff profile), `list_invitations`, `revoke_invitation`, `change_member_role`, `revoke_member`, `transfer_ownership`; managers can't touch owners/managers; ops (aal2) can invite a business's first owner; all audited | Part 2 §5.2, Part 1 §6.3 |
| Admin MFA | Admin login: phone code, then TOTP enrollment (first time) or challenge; `is_admin()` stays aal2-only; `get_my_access()` tells an aal1 admin that MFA is still needed | Part 6 §7 |
| Account | `delete_my_account` + `job_process_account_deletions` skeleton (anonymizes profile, cancels future bookings, detaches business records, revokes memberships; owners → support) | Part 2 §1.1 |
| UI (`@app/ui-web`) | `PhoneInput` (+961 rules, LTR in Arabic UI), `OtpInput` (one field, `one-time-code` autofill, paste, Arabic digits, Web OTP on Android Chrome), `Turnstile`, `PhoneOtpFlow` (phone → code → done, "Send by SMS instead" after 30 s) | Phase 2 §5, C10 |
| Pages | Web: `/biz/login`, `/biz` (memberships; dashboard is M5), `/invite/[token]`, `/m/[token]` (claim link + "previous visits" offers), `/lab/booking` (test page, off unless `NEXT_PUBLIC_ENABLE_LAB=true`). Admin: `/login` (phone + TOTP), `/` gated to aal2 admins | Phase 2 B1, C10, §8.1 |
| Shared code | `@app/core` phone parsing (mirrors `normalize_phone`; mobile/landline/international); `@app/api` auth helpers + typed RPC wrappers + error codes; `@app/i18n` auth copy and code messages (EN, AR kept in sync) | |

## Migrations created

| File | Contents |
|---|---|
| `20260930100000_m4_access_tokens_claims.sql` | Token helpers, `resolve_access_token`, claim RPCs, safe merge, system notes, phone index |
| `20260930100100_m4_members_invitations.sql` | Invitation and member RPCs, invitation audit |
| `20260930100200_m4_otp_access_account.sql` | OTP routing/receipts/stats, `get_my_access`, account deletion, 2 cron jobs |

## Tests executed

| Layer | Result | What it proves |
|---|---|---|
| pgTAP (local, transactional) | **429/429** (114 new) | `180_claims` (41): Part 7 §6 tests 34–40 (verification links nothing; token/phone match; expired/used/wrong-purpose/>12 months; only that booking; offers reveal only name/area/count/month; dismissal; confirmed businesses only; safe merge with re-pointed bookings and notes, alias note, stats, duplicate flag; manual booking on a claimed relationship), recycled number, phone change. `190_members` (39): who may invite whom, phone-bound accept, replacement, expiry, revoke, role changes, transfer, ops first-owner with aal2 only. `200_otp_access_account` (34): hook functions server-only, WhatsApp → SMS routing, foreign numbers, limits, receipts never move backwards, access summary, what anonymous sessions can't do, deletion job, retention |
| Edge Function unit tests | **32/32** | Standard Webhooks / Twilio / Meta signatures (cross-checked with node:crypto), WhatsApp and Twilio request shapes and error handling, routing and fallbacks, config, hook/receipt handlers |
| Package unit tests | api 21, core 20, ui-web 23, i18n 5 | Phone parsing, auth flow (link vs sign-in), error mapping, MFA steps, OTP input sanitizing, flow state |
| Live local checks (real Auth + hook) | ✅ | Auth → hook (signature) → routing → log channel → verify; anonymous link keeps the user; resend after 30 s → SMS; Turnstile required on OTP and anonymous sign-in |
| E2E, web (local stack) | **5 auth + 4 foundation** | Business login (landline rejected); invite join; invite with the wrong number; claim link + offers + used link; lab: anonymous hold → code → confirmed booking |
| E2E, admin | **1** | Not admin → provisioned → TOTP enrollment → admin home; sign-out; challenge with wrong then right code |
| Lint, typecheck, format, builds | ✅ | Web + admin production builds without env |

CI now runs the auth e2e suites against a local Supabase stack started in the job.

## Found while implementing (fixed)

| # | Finding | Fix |
|---|---|---|
| F1 | Local phone auth stayed disabled with only the hook configured (`phone_provider_disabled`) | Placeholder SMS provider locally (the hook takes precedence); documented |
| F2 | The hook payload carries the destination in `sms.phone`; for a phone change `user.phone` is empty | Hook reads `sms.phone`, then `user.new_phone`, then `user.phone` |
| F3 | Recording the local log provider overwrote the routed channel, so "resend → SMS" never triggered | Channel kept; provider stored separately (test added) |
| F4 | Auth's 30 s resend error shares a code with the hourly SMS limit, so users saw "Too many codes" | Mapped by message to "Please wait a moment" |
| F5 | TOTP enrollment fails for phone-only accounts ("AccountName must be set") | D2 below |
| F6 | A slow Turnstile token left the Send button silently disabled | Button stays enabled and explains; the check restarts |

## Deviations for your approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | Part 2 §2.3 step 3 (alias note on merge) | `customer_notes.author_user_id` nullable only for `is_system` notes | The merge note has no human author |
| D2 | Part 6 §7 (admin TOTP) | **Admin accounts must have an email** (set at provisioning); admins still sign in by phone, then TOTP. Missing email shows a clear message | Supabase Auth labels TOTP factors with the email; phone-only accounts cannot enroll (Auth v2.197, same as hosted) |
| D3 | Phase 2 C10 (SMS after 30 s) | **SMS fallback only for allowed prefixes** (default `+961`); foreign numbers resend by WhatsApp | International SMS cost/abuse control; WhatsApp works for the diaspora. Configurable per environment |
| D4 | OTP limits (unspecified) | 5 codes / 15 min, 10 / day per number (plus Auth's per-IP limits and Turnstile) | Abuse protection with room for honest retries |
| D5 | Part 2 §5.2 | Invitations: `revoked_at`, replacement of pending invites, owner invites only from ops for ownerless businesses, preview/list/revoke RPCs | Needed by the invite link page and team screen |
| D6 | New | `get_my_access()` | App routing and the admin MFA gate without weakening `is_admin()` |
| D7 | Part 2 §1.1 | Deletion job skeleton: owners → support; auth user deleted by a service worker later | App-owned code can't touch the `auth` schema (M1 D-note) |
| D8 | Claims vs reliability/reviews | Claiming adds no reliability events; review eligibility of claimed visits is decided in M9 (reviews) | Keeps M4 to identity; reviews own eligibility |
| D9 | Helper | `private.raise_code` is STABLE | It only raises; STABLE readers can use it |

## Not done yet (needs your accounts or phones)

| DoD item | Status |
|---|---|
| OTP median delivery (< 15 s WhatsApp, < 30 s SMS) | Needs staging with real WhatsApp/Twilio; measured with `admin_otp_delivery_stats` |
| Hold → OTP → confirm inside the Instagram in-app browser (iOS, Android) | Test page ready (`/lab/booking`); needs your phones |
| Spike S2 findings (autofill, storage, deep links in webviews) | Collected from the manual tests (the lab page shows browser diagnostics) |

## Manual testing plan

**Round 1: now, no accounts (phones on the same Wi-Fi as this PC).** Use test numbers `70 000 001`–`70 000 006`, code `123456`.

| Where | URL | Actions |
|---|---|---|
| iPhone Safari, Android Chrome | `http://192.168.1.118:3000/lab/booking?…` (demo business link I'll generate) | Start → pick a slot → phone `70 000 004` → code → name → Confirm → "Booked" |
| Instagram in-app (both phones) | Send yourself the same link in an Instagram DM and open it | Same steps; then open "Browser diagnostics" and screenshot it |
| TikTok in-app | Paste the link in a TikTok message/bio preview and open it | Same steps + diagnostics |
| All | `http://192.168.1.118:3000/biz/login` | Sign in with `70 000 001`; check the code field, paste, and the "Send by SMS instead" countdown |

**Round 2: after the staging setup (real WhatsApp/SMS on your own numbers).** Same pages on the staging web URL; plus measure delivery time and try "Send by SMS instead" and WhatsApp-not-installed.

## After approval

1. Apply M4 migrations to staging; hosted pgTAP; logged-out/API smoke; fingerprint; residue.
2. Configure staging Auth + Edge Functions per `docs/engineering/environments.md` (hook, Turnstile, TOTP, secrets). Real provider credentials are yours to set.
3. Round 2 phone tests and delivery measurement; record S2 findings.
4. Merge to `main`, confirm CI, close M4.
