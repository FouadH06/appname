# M0 — Project foundation: report

Status: **complete, awaiting approval** · Date: 2026-09-27

## What was built

| Area | Result |
|---|---|
| Monorepo | pnpm 10 workspaces + Turborepo 2 (`apps/*`, `packages/*`), tasks: dev, build, lint, typecheck, test, test:e2e |
| Apps | `apps/web` (Next.js 16, App Router, Tailwind 4), `apps/admin` (Next.js 16, noindex/deny-frame headers), `apps/mobile` (Expo SDK 57 shell) |
| Packages | `core` (zod `parseEnv`), `api` (typed Supabase client factory), `db` (generated-types placeholder), `i18n` (locales, RTL direction, EN/AR catalogs), `ui-web` (Phase 2 design tokens, light/dark, Tailwind theme), `tsconfig`, `eslint-config` |
| Supabase | CLI 2.118 as a dev dependency; `supabase/config.toml` (Postgres 17, `max_rows = 200`, `auto_expose_new_tables = false`); `migrations/` (empty), `tests/database/000_harness.test.sql` (pgTAP), `functions/` (README + `.env.example`), `seed.sql` |
| Environments | `.env.example` per app + Edge Functions; `parseEnv` validation helpers in apps; environments doc (local / staging / production) |
| Quality | ESLint 10 flat configs (typescript-eslint, Next core-web-vitals, react-hooks, prettier-compat), Prettier 3, strict TypeScript 6.0 (`noUncheckedIndexedAccess`), EditorConfig, LF line endings |
| Tests | Vitest 5 unit tests in packages; Playwright (mobile + desktop projects) smoke e2e; pgTAP harness |
| CI | `.github/workflows/ci.yml`: quality · database (db start → reset → pgTAP → db lint) · build · e2e |
| Docs | Specs moved into `docs/`; `docs/README.md` index; `docs/engineering/{getting-started, environments, conventions, testing}.md`; this report |

No product features were implemented. The web home page is a token/RTL/theme check page that M5/M8 replace.

## Decisions and deviations

None of these change a Phase 1–3 decision. All are logged in `docs/00-locked-decisions.md`.

1. **Node 24 LTS** is the target runtime (`.nvmrc`, CI). Vitest 5 excludes odd Node releases, so `engine-strict=false` lets the local Node 25 install with warnings.
2. **TypeScript pinned to 6.0.x** (pnpm override). `latest` is 7.0 (native compiler), which typescript-eslint doesn't support (`<6.1`).
3. **`@app/tsconfig` is self-contained** (`base.json` inside the package). A root-relative `extends` broke under Vite, which resolves through pnpm symlinks.
4. **Supabase local config:** `auto_expose_new_tables = false` (default-deny, Phase 3 Part 6 §2) and `max_rows = 200` (Part 6 §7). Auth settings (anonymous sign-ins, SMS hook, MFA) are deferred to M4.
5. **Playwright local browser:** `PW_CHANNEL=msedge` reuses the installed Edge locally. CI installs bundled Chromium.
6. **Git:** repository initialized on `main`; **nothing committed** and no remote configured (awaiting your instruction).

## Test results (local, Windows, Node 25.2.1)

| Check | Command | Result |
|---|---|---|
| Frozen install (what CI runs) | `pnpm install --frozen-lockfile` | ✅ |
| Formatting | `pnpm format:check` | ✅ all files |
| Lint | `pnpm lint` | ✅ 8/8 projects, 0 warnings |
| Typecheck | `pnpm typecheck` | ✅ 8/8 projects (TypeScript 6.0.3) |
| Unit tests | `pnpm test` | ✅ **22 passed** (ui-web 14 · i18n 4 · core 2 · api 2); apps have no unit tests yet |
| Production build | `turbo run build --filter=@app/web --filter=@app/admin` | ✅ both compiled |
| E2E (production build) | `CI=1 PW_CHANNEL=msedge playwright test` | ✅ **4 passed** (health + tokens/RTL flip × mobile & desktop) |
| Mobile bundle | `expo export --platform android` | ✅ Metro bundled 580 modules (1.4 MB Hermes bytecode) |
| Mobile typecheck + lint | `turbo run typecheck lint --filter=@app/mobile` | ✅ |

## Not verified locally (and why)

| Item | Why | How it gets verified |
|---|---|---|
| pgTAP harness (`pnpm db:test`) and `supabase db lint` | **Docker Desktop isn't installed** on this machine; the local Supabase stack needs it | Install Docker Desktop (WSL 2 backend) → `pnpm db:start && pnpm db:test`. Also runs in CI's `database` job |
| GitHub Actions CI run | No remote repository and nothing committed yet | Create the GitHub repo, commit, push → all 4 jobs must pass |
| Playwright with bundled Chromium | Local downloads are ~30–50 KB/s; Edge was used instead | CI installs Chromium |

**Local network note:** package downloads ran at ~30–50 KB/s during M0 (Next.js/Expo installs took 7+ minutes each). Worth fixing before M1, because the Supabase Docker images are ~2–3 GB.

## Next

M1: database foundations (after approval).
