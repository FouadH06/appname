# Environments

| Environment | Database | Apps | Purpose |
|---|---|---|---|
| **local** | Supabase CLI stack in Docker (`pnpm db:start`) | `pnpm dev` | Development, pgTAP, e2e |
| **staging** | Supabase project `app-name-staging` | Preview/staging deploys of web + admin | Every merge to `main`; smoke tests; pilot rehearsal |
| **production** | Supabase project `app-name-prod` (PITR on before launch) | Production deploys | Real users |

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
