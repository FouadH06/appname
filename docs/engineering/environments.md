# Environments

| Environment | Database | Apps | Purpose |
|---|---|---|---|
| **local** | Supabase CLI stack in Docker (`pnpm db:start`) | `pnpm dev` | Development, pgTAP, e2e |
| **staging** | Supabase project `oplwsnpyavnqnhlzyhxr` ("Newapp", eu-central-1) | Preview/staging deploys of web + admin (hosting TBD) | Migrations verified here before each milestone closes; smoke tests; pilot rehearsal |
| **production** | Supabase project `app-name-prod` (PITR on before launch) | Production deploys | Real users |

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
| Edge Function secrets (WhatsApp, SMS, AI providers, IP-hash salt) | `supabase secrets set` | **Secret** |

Every app has a committed `.env.example`; real `.env*` files are git-ignored.

## Hosting (decided when staging is created)

Web and admin are standard Next.js apps (Vercel or equivalent). Admin gets its own domain
(`admin.platform.com`). This choice doesn't affect code and is recorded here when made.
