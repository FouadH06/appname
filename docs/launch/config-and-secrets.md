# Configuration & secrets review (M14)

Every setting the product reads, where it lives, and the **production value that must be verified before
real users**. Secrets live only in the hosting provider / Supabase secrets / Vault — never in Git (the
M14 scan of all tracked files found none; `.env.example` files hold names only).

Legend: **S** = secret · **P** = public (ships to browsers/apps) · **C** = config

## Web app (`apps/web`, Next.js)

| Variable | Kind | Production value / check |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | P | production project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | P | production **publishable** key (never the secret key) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | P | real site key for the production domain (default is Cloudflare's *test* key — **must be replaced**) |
| `NEXT_PUBLIC_SITE_URL` | C | `https://<domain>` (sitemap, canonical links) |
| `NEXT_PUBLIC_WEB_URL` | C | `https://<domain>` |
| `NEXT_PUBLIC_ENABLE_LAB` | C | **`false`** (lab pages are test tooling) |
| `SUPABASE_SERVICE_ROLE_KEY` | S | **not needed**: no web code path uses it (`getServerEnv` is unused) — don't set it on the web host |
| `APPLE_TEAM_ID` | C | Apple team id → iOS universal links (`/.well-known/apple-app-site-association`) |
| `ANDROID_CERT_SHA256` | C | Play signing key fingerprint(s) → Android App Links (`/.well-known/assetlinks.json`) |

## Admin app (`apps/admin`)

| Variable | Kind | Production value / check |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | P | production project (admin actions are gated in the database by role + aal2 MFA) |
| Hosting | C | separate origin, not indexed; access restricted to admins (MFA enforced by the database regardless) |

## Customer app (`apps/mobile`, Expo)

| Variable | Kind | Production value / check |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | P | production project, publishable key |
| `EXPO_PUBLIC_WEB_URL` | C | `https://<domain>` (captcha bridge `/captcha`, share links, universal-link domain) |
| `EXPO_PUBLIC_SUPPORT_URL` | C | `https://wa.me/961…` or `mailto:` — Profile → Contact Support (shows "not configured yet" when empty) |
| `app.json` → `extra.eas.projectId` | C | set by `eas init` (enables push) |
| `app.json` → `ios.associatedDomains`, `android.intentFilters` | C | `platform.com` placeholder → **real domain** |
| `app.json` → bundle id / package | C | `com.appname.customer` placeholder → final ids before the first store upload (cannot change later) |

## Supabase — Edge Function secrets (`supabase secrets set`, template `supabase/functions/.env.example`)

| Secret | Kind | Check |
|---|---|---|
| `SEND_SMS_HOOK_SECRETS` | S | same value as Auth → Hooks → Send SMS |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | S | Meta-approved number + templates |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_STATUS_CALLBACK_URL` | S | SMS fallback; `SMS_ALLOWED_PREFIXES=+961` |
| `NOTIFY_PROVIDER_MODE` / `OTP_PROVIDER_MODE` | C | leave **unset** (= live). `log` prints instead of sending and is refused on hosted projects |
| `NOTIFY_DISPATCH_SECRET`, `MODERATE_SECRET`, `MEDIA_ORCHESTRATOR_SECRET` | S | random, each also in Vault (below) |
| `ANTHROPIC_API_KEY` | S | set by the PO only (never in chat/Git); without it moderation routes everything to humans |
| `LLM_MODEL`, `MEDIA_LLM_MODEL`, `MODERATION_MODE` | C | defaults (Sonnet 5) unless the eval says otherwise |
| `MODERATION_AUTO_PUBLISH`, `MEDIA_AUTO_PUBLISH` | C | **`false`** until the respective eval gates pass (locked decisions) |
| `EXPO_ACCESS_TOKEN` | S | optional (Expo enhanced push security) |

## Supabase — Vault (SQL editor) and database settings

| Item | Check |
|---|---|
| Vault `notify_dispatch_url` / `notify_dispatch_secret` | pg_cron → notify-dispatch |
| Vault `moderate_url` / `moderate_secret` | pg_cron → moderate |
| Vault `media_orchestrator_url` / `media_orchestrator_secret` | pg_cron → media-orchestrator |
| `private.app_settings.web_base_url` | **real domain** (links in WhatsApp/SMS). Admin → Launch flags a localhost value |
| Auth: phone sign-in, anonymous sign-ins, Send SMS hook, TOTP MFA, Turnstile secret | production values (`docs/engineering/environments.md`) |
| Auth rate limits | review for launch traffic (local: 30 anonymous sign-ins / hour / IP) |
| Backups | **PITR enabled** (paid plan) + daily backups retained |

## Media worker host (`apps/media-worker`, Docker)

| Variable | Kind | Check |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | S | host env only |
| `CONCURRENCY` | C | ≤ 2 per 4-vCPU worker (capped; M10 Option A) |

## Monitoring (external accounts)

| Item | Check |
|---|---|
| Uptime monitor | `GET https://<domain>/api/health?deep=1` every 1–5 min (503 = database unreachable) |
| Admin → System | daily look; alerts on failing/late jobs, backlogs, delivery < 90 % |
| Error tracking (Sentry or similar) | not integrated — optional, needs an account (decision) |

## Findings of the review

- No secrets in tracked files; no service key in any client bundle (only publishable keys are `NEXT_PUBLIC_` / `EXPO_PUBLIC_`).
- Dependency audit: 0 high/critical; 2 moderate, both in the Expo toolchain (`uuid` via `xcode` at build time;
  `decode-uri-component` via `expo-router` → a crafted deep link could slow the customer's own app). Accepted for
  now; re-check at the EAS build. CI now fails on any high/critical advisory.
- Defaults that are unsafe for production and must be changed: Turnstile test site key, `NEXT_PUBLIC_ENABLE_LAB`,
  `web_base_url` (localhost), app domain / bundle id placeholders.
- The web host needs no secret at all (publishable key only) — smaller blast radius if the host is compromised.
- `IP_HASH_SECRET` is unused: IP events are not collected (fraud checks use the device hash). No raw IPs are stored.
