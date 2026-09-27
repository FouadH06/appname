# Getting started

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **24 LTS** recommended (CI uses 24; ≥ 22.12 supported). Odd releases (e.g. 25) work with engine warnings | All JS tooling |
| pnpm | 10.x (`npm i -g pnpm@10`) | Package manager (workspace) |
| Docker Desktop | current | Local Supabase stack (`pnpm db:start`) and pgTAP tests |
| Git | current | — |

The Supabase CLI is a dev dependency of the repo (`pnpm exec supabase …`); no global install needed.

## First run

```bash
pnpm install
pnpm db:start          # needs Docker; prints local URLs and keys
cp apps/web/.env.example apps/web/.env.local     # paste the anon key from db:start
pnpm dev               # web on :3000, admin on :3001
```

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run all apps in dev mode |
| `pnpm check` | Format check + lint + typecheck + unit tests (what CI's quality job runs) |
| `pnpm build` | Production builds |
| `pnpm test:e2e` | Playwright (web) |
| `pnpm db:reset` | Recreate the local DB from migrations + seed |
| `pnpm db:test` | pgTAP tests (`supabase/tests`) |
| `pnpm db:types` | Regenerate `packages/db/src/database.types.ts` |
| `pnpm format` | Prettier write |

## Windows notes

- The repo enforces LF line endings (`.gitattributes`). Configure `git config core.autocrlf false`.
- Docker Desktop must use the WSL 2 backend for Supabase.
