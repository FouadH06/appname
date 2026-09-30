# Pre-real-user checklist (M14)

One place for everything deferred since M4 and everything launch needs that CI cannot prove. Nothing
here is done yet unless ticked. **Owner:** PO = needs your accounts, devices or decisions · Eng = engineering
work in a session · Both = Eng runs it, PO supplies access.

Readiness levels (see the M14 report): **code-complete** (merged, CI green) → **staging-verified** (sections
A–C green on staging) → **pilot-ready** (+ D, E, F for the pilot cluster, real messages) → **launch-ready**
(+ G, H, Gate D).

## A. Staging deployment & verification — Owner: Both (staging access by the PO)

Staging (`oplwsnpyavnqnhlzyhxr`) still runs the **M3 schema**. Apply everything once, in order.

- [ ] Apply migrations M4 → M14 to staging (`supabase db push`); schema fingerprint = local; zero test residue
- [ ] Hosted pgTAP: full suite (973 locally) incl. `010_schema_hygiene` and `340_security_review`
- [ ] Hosted logged-out API / RLS smoke (`scripts/hosted-smoke.sh`) + M3 race smoke (`scripts/hosted-booking-smoke.py`)
- [ ] Deploy Edge Functions: `auth-send-sms`, `whatsapp-webhook`, `twilio-status`, `notify-dispatch`, `moderate`, `media-orchestrator`
- [ ] Set function secrets + Vault entries + `web_base_url` (`docs/launch/config-and-secrets.md`)
- [ ] pg_cron on staging: all `app_*` jobs present; Admin → System shows every job **ok** after 15 min
- [ ] Auth configuration: phone, anonymous sign-ins, Send SMS hook, TOTP, Turnstile (test secret until the staging web domain exists)
- [ ] Deploy web + admin to staging hosting; set envs; `/api/health?deep=1` returns ok
- [ ] Deploy the media worker (4 vCPU, `CONCURRENCY` ≤ 2); buckets and policies as in `340_security_review`

**Per-milestone hosted smokes** (details in the M4 report checklist, kept for reference):
- [ ] M4 claims/invitations, signed hook accepted / unsigned rejected, admin MFA (RPCs only at aal2)
- [ ] M5 business setup, media upload bucket policies
- [ ] M6 Realtime: a booking change reaches a second tab; staff only see their own items
- [ ] M7 a queued message dispatched by pg_cron; signed Confirm webhook; delivery receipts
- [ ] M8 public funnel on staging; Lighthouse on a business page (LCP < 2.5 s slow 4G, CLS < 0.1)
- [ ] M9 comment moderated via pg_cron → `moderate`; rejected comment → edit message; review request 2 h after completion
- [ ] M10 upload → transform → moderator approves → public derivative, metadata stripped; delete removes public objects
- [ ] M11 resolve a no-show dispute end to end; suspend a test business (cancel path); audit log
- [ ] M12 search p95 on staging < 300 ms; SEO landing + sitemap; mobile search/suggestions; date/time filter
- [ ] M13 favorites, rebook suggestions, inbox, push token rules (malformed rejected, service-role-only disable)
- [ ] M14 analytics after one nightly run; System and Launch pages; account deletion end to end (review removed, Auth scrubbed)
- [ ] **Restore drill:** restore a staging backup into a scratch project; run `010` + `340` there (ownership and grants must survive); smoke

## B. External providers — Owner: PO

- [ ] WhatsApp Business: Meta verification, number approved, all templates submitted & approved (OTP, booking, review, result, dispute) — Admin → Launch shows approved / active
- [ ] Twilio: account, +961 sender / messaging service, balance; SMS delivery timing measured
- [ ] Real OTP delivery + timing on Lebanese carriers (alfa, touch), WhatsApp and SMS
- [ ] Cloudflare Turnstile: real site + secret keys for the production (and staging) domains
- [ ] Anthropic key as a Supabase secret; moderation eval gate (0 harmful blind held-out published) before `MODERATION_AUTO_PUBLISH=true`; image eval (≥ 90 % correct automatic decisions, 0 falsely public) before `MEDIA_AUTO_PUBLISH=true`
- [ ] Domain chosen; brand name replaces `APP_NAME` / `platform.com` placeholders (web, app, messages)
- [ ] Supabase paid plan with **PITR** enabled
- [ ] Uptime monitor on `/api/health?deep=1`; Sentry (or equivalent) at pilot start (decision 2026-09-30)

## C. Production configuration — Owner: Both

- [ ] Every item in `docs/launch/config-and-secrets.md` set and double-checked; unsafe defaults changed (Turnstile test key, lab pages, `web_base_url`)
- [ ] Admin accounts created (moderator / support / ops / superadmin), TOTP enrolled, email on each account
- [ ] Ranking config active; `select private.compute_quality_scores()` after real businesses go live; daily metrics backfill after import
- [ ] Test businesses flagged `is_test` (hidden from customers) or removed

## D. Native app validation (M13) — Owner: PO (accounts + devices), Eng assists — **launch blockers**

Blocked until the Apple Developer / Google Play accounts and `eas init` exist; none of these can be proven
on the Expo web build.

- [ ] Real iOS build (EAS → TestFlight) and Android build (EAS → Play internal testing) install and open
- [ ] OTP + captcha: Turnstile inside the WebView on iOS and Android; code by WhatsApp and SMS; wrong code / resend
- [ ] Secure session storage: session survives app restart and OS kill; log out clears it; chunked SecureStore works with a real (large) session
- [ ] Push: permission prompt only after the first booking; token registers; review request / result / dispute pushes arrive; tap opens the right screen (cold start and background); push turned off → WhatsApp instead; log out → no more pushes on that device
- [ ] Photo picker + upload: iOS HEIC and Android JPEG from the gallery; resize/re-encode strips EXIF/GPS; upload over a slow connection; retry
- [ ] Universal / app links: `https://<domain>/{slug}`, `/bookings/{id}`, `/review/{token}`, `/m/{token}`, `/r/{id}` open the app when installed and the website when not (needs `APPLE_TEAM_ID` / `ANDROID_CERT_SHA256` set and the association files served)
- [ ] Offline / reconnect: offline banner appears; screens keep loaded data; booking actions fail with a clear message; reconnect recovers without restart
- [ ] Same account on web and app (phone verified once per device); account deletion from the app end to end
- [ ] Store listings, privacy labels / data-safety forms, account-deletion URL, screenshots; submitted to both stores (M13 DoD)

## E. Pilot readiness (Gate B / C) — Owner: PO, Eng supports

- [ ] Pilot businesses onboarded with real menus, staff, hours, cover photos; Admin → Launch shows them **ready**
- [ ] Real-phone checks: iPhone Safari, Android Chrome, Instagram / TikTok / WhatsApp in-app browsers — full funnel
- [ ] Top 30 real pilot search queries reviewed; ranking sanity on real businesses (M12 pre-pilot checks)
- [ ] Gate B evidence: salons use the calendar, manual bookings fast enough, schedules correct, no parallel notebook, no serious booking/availability issues
- [ ] Runbooks read by whoever is on call (`docs/runbooks/README.md`); support channel set (`EXPO_PUBLIC_SUPPORT_URL`)

## F. Legal — Owner: PO (counsel)

- [ ] Terms of use, Privacy policy (Law 81/2018), Review & photo guidelines written and published (placeholders at `/terms`, `/privacy`, `/review-guidelines`)
- [ ] Account deletion policy text matches the implementation (reviews/photos removed; Auth record scrubbed; business keeps its own customer record)
- [ ] Privacy policy describes the approved deletion behaviour: Auth record scrubbed in place (decision 2026-09-30)

## G. Launch performance & security on production-like hosting — Owner: Both

- [ ] Load check against staging with the PO's go-ahead (script is local-only by design; adapt with a staging guard) — p95 targets: search < 300 ms, holds < 500 ms, 0 errors at 5× launch traffic
- [ ] Hosted re-run of `340_security_review`; Supabase security advisor clean
- [ ] Backups restore-tested on hosted (section A drill)

## H. Gate D (marketplace launch) — Owner: PO

- [ ] 50–70 live businesses; each cluster ≥ 15 across the core categories (Admin → Launch)
- [ ] Gate C metrics held 4 weeks in the pilot cluster; ≥ 30 % of pilot bookings online (Admin → Overview / B11 source mix)
- [ ] Both app store builds approved
