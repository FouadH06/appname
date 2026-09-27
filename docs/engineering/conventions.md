# Conventions

## Repo layout

```
apps/
  web/        Next.js — public pages, web booking, customer account, business dashboard (/biz)
  admin/      Next.js — admin console (separate deploy + domain)
  mobile/     Expo — customer app
packages/
  core/       framework-free domain code: zod schemas, types, pure logic
  api/        typed Supabase client + RPC wrappers (shared web/mobile)
  db/         generated database types
  i18n/       locales, message catalogs, direction (RTL) helpers
  ui-web/     design tokens + web components
  tsconfig/   shared TypeScript configs
  eslint-config/ shared ESLint flat configs
supabase/
  migrations/ ordered SQL migrations (forward-only)
  tests/      pgTAP suites
  functions/  Edge Functions (Deno)
  seed.sql    local fixtures only
docs/         specs, engineering docs, milestone reports
```

Workspace packages are imported by name (`@app/core`) and ship TypeScript source.

## Migrations

- One concern per file: `supabase/migrations/<timestamp>_<milestone>_<topic>.sql`
  (e.g. `20261005120000_m1_enums.sql`). Create with `pnpm exec supabase migration new m1_enums`.
- **Never edit a merged migration.** Fix forward with a new one.
- Every migration that adds a table also adds: RLS enable, grants, policies, audit trigger (if
  listed in Phase 3 Part 5 §8), and pgTAP tests in the same change.
- Reference data production needs (catalog, areas) is seeded **in migrations**; `seed.sql` is
  for local fixtures.

## Database rules learned in M1

- End every migration that creates objects with `select private.assign_app_ownership();`.
- SECURITY DEFINER functions use `private.uid()` / `private.jwt()`, **never** `auth.uid()` / `auth.jwt()` (app_owner has no access to the `auth` schema). A hygiene test enforces it.
- New functions get no PUBLIC execute by default. Grant `anon`/`authenticated` explicitly when clients or RLS policies need them.
- Extensions added in later migrations must explicitly grant what clients need (global default privileges strip PUBLIC execute).
- Cast literals to enums in `UNION`/`VALUES` inserts (`'en'::public.synonym_lang`).

## Code review checklist (every change, AI-generated or not)

- [ ] Matches the spec section it implements (link it in the PR description).
- [ ] RLS enabled + policies + explicit grants on every new table.
- [ ] SECURITY DEFINER functions: `set search_path = ''`, caller validated first, business derived
      from the row, `revoke execute from public`.
- [ ] Stable error codes, mapped in `@app/i18n`.
- [ ] Audit rows for admin/business mutations.
- [ ] No `publicly_bookable = false` staff can leak into public responses.
- [ ] Tests included (pgTAP for DB, Vitest for logic, Playwright for flows).
- [ ] Deviation from the spec? Stop and write a decision-log entry first.

## Naming

TypeScript: `camelCase` values, `PascalCase` types/components, files `kebab-case.ts`.
SQL: see Phase 3 Part 1 §2.
