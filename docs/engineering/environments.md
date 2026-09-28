# Environments

| Environment | Database | Apps | Purpose |
|---|---|---|---|
| **local** | Supabase CLI stack in Docker (`pnpm db:start`) | `pnpm dev` | Development, pgTAP, e2e |
| **staging** | Supabase project `oplwsnpyavnqnhlzyhxr` ("Newapp", eu-central-1) | Preview/staging deploys of web + admin (hosting TBD) | Migrations verified here before each milestone closes; smoke tests; pilot rehearsal |
| **production** | Supabase project `app-name-prod` (PITR on before launch) | Production deploys | Real users |

Local stack used by CI and e2e (Realtime is needed from M6 for the live calendar):
`supabase start -x studio,imgproxy,logflare,vector,inbucket,postgres-meta,supavisor`.
Local test phone numbers `+961 70 000 001`–`70 000 011` accept code `123456` (`supabase/config.toml`).

### Staging verification routine (run before closing a milestone that adds migrations)

```bash
pnpm exec supabase db push --linked --dry-run      # review
pnpm exec supabase db push --linked                # apply
pnpm exec supabase test db --linked                # full pgTAP on hosted
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable> bash scripts/hosted-smoke.sh
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable> python scripts/hosted-booking-smoke.py   # races, non-leak, latency, residue (M3+)
# after an interrupted run: same env + --cleanup-orphans
pnpm exec supabase test db --linked supabase/diagnostics/schema-fingerprint.sql   # compare with local run
pnpm exec supabase test db --linked supabase/diagnostics/data-residue.sql         # must be all zeros
```

Run linked CLI commands **one at a time**: each call rotates the temporary login role's password, so parallel calls fail authentication and can trip the pooler's circuit breaker for a few minutes. The booking smoke gets parallel sessions from one-shot `pg_cron` jobs instead.

The CLI connects as a temporary login role (`supabase login` once per machine), so no DB password is needed. `db dump --linked` doesn't work with that role through the pooler; use the fingerprint script.

Rules:
- Migrations reach staging and production **only through CI**, never from a laptop.
- Production keys never exist on developer machines.
- Each app validates its env at the point of use with `parseEnv` (`@app/core`). A missing key fails loudly.

## Variables

| Variable | Where | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web, admin | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web, admin | Public (publishable key; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | web server-side only | **Secret**, never in client bundles |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile | Public |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | web, admin (one key per origin) | Public. Local/CI: Cloudflare test key `1x00000000000000000000AA` |
| `NEXT_PUBLIC_ENABLE_LAB` | web | `true` only on local/staging test deployments (`/lab/*` pages) |
| Edge Function secrets (WhatsApp, SMS, hook secret, AI providers, IP-hash salt) | `supabase secrets set` (template: `supabase/functions/.env.example`) | **Secret** |

Every app has a committed `.env.example`; real `.env*` files are git-ignored.

## Hosting (decided when staging is created)

Web and admin are standard Next.js apps (Vercel or equivalent). Admin gets its own domain
(`admin.platform.com`). This choice doesn't affect code and is recorded here when made.

## Auth setup per hosted environment (M4)

Local and CI get all of this from `supabase/config.toml`. Staging/production are configured once
in the dashboard, then verified with the M4 checks. Nothing here uses the service-role key or DB
password from a laptop.

**Dashboard → Authentication**
- Sign-in providers: **Phone** on (no SMS provider needed, the hook sends); **Anonymous sign-ins** on; phone confirmations on.
- SMS OTP expiry: 300 s (WhatsApp delivery can take longer than SMS); resend interval: 30 s (drives "Send by SMS instead").
- Hooks → **Send SMS**: HTTPS `https://<ref>.supabase.co/functions/v1/auth-send-sms`; generate the secret and store the same value as the `SEND_SMS_HOOK_SECRETS` function secret.
- Attack protection → **CAPTCHA**: Cloudflare Turnstile with the secret for that environment's site keys.
- Multi-factor → **TOTP** enabled (admins must reach aal2).

**Edge Functions**
- `supabase functions deploy auth-send-sms whatsapp-webhook twilio-status` (JWT verification is off per `config.toml`; each function checks its caller's signature).
- `supabase secrets set --env-file <file>` using `supabase/functions/.env.example`. Leave `WHATSAPP_*` unset until Meta approves the number: codes then go by SMS.

**Providers**
- Twilio: Messaging Service; status callback `https://<ref>.supabase.co/functions/v1/twilio-status`.
- Meta (WhatsApp Cloud API): webhook `https://<ref>.supabase.co/functions/v1/whatsapp-webhook` with `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; subscribe to `messages`; approved AUTHENTICATION templates (EN/AR) with a copy-code button.

**Admin accounts (provisioning runbook, superadmin)**
Admins sign in by phone and must add TOTP. Supabase Auth labels a TOTP factor with the account's
email, so a phone-only account can't enroll (M4 deviation D2). Provisioning an admin therefore sets
both the role and an email, in the SQL editor:

```sql
insert into public.admin_users (user_id, role, created_by)
select id, 'ops', '<superadmin user id>' from auth.users where phone = '9617XXXXXXX';
update auth.users set email = 'name@company.example', email_confirmed_at = now() where phone = '9617XXXXXXX';
```

## Manual phone testing

- **Round 1: local network, no provider accounts.** Phones on the same Wi-Fi as the dev machine
  use fixed test numbers (`70 000 001`–`70 000 011`, code `123456`). Start the stack, create the lab
  business (`docker exec -i supabase_db_app-name psql -U postgres -At < scripts/lab-demo-business.sql`),
  and run web with `NEXT_PUBLIC_SUPABASE_URL=http://<LAN-IP>:54321`, `DEV_ORIGINS=<LAN-IP>`,
  `NEXT_PUBLIC_ENABLE_LAB=true`, `pnpm --filter @app/web dev -- -H 0.0.0.0`.
- **Round 2: staging with real WhatsApp/SMS.** Needs the auth setup above, a staging web deployment
  (HTTPS, `NEXT_PUBLIC_ENABLE_LAB=true`), a fake demo business on staging, and real phone numbers.
