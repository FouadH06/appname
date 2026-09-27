# Testing

| Layer | Tool | Location | Runs in |
|---|---|---|---|
| Database (schema, RLS, RPCs, invariants) | pgTAP | `supabase/tests/database/*.test.sql` | `pnpm db:test`, CI `database` job |
| Concurrency / property tests (parallel connections) | Vitest + `pg` | `supabase/tests/concurrency/` (from M3) | CI `database` job (M3+) |
| Unit (pure logic, packages) | Vitest | `packages/*/src/**/*.test.ts` | `pnpm test`, CI `quality` job |
| End-to-end (web flows) | Playwright (mobile + desktop projects) | `apps/web/e2e/` | `pnpm test:e2e`, CI `e2e` job |
| Mobile flows | Maestro (from M13) | `apps/mobile/e2e/` | M13+ |

## CI jobs (`.github/workflows/ci.yml`)

1. **quality**: `format:check`, `lint`, `typecheck`, `test`
2. **database**: `supabase db start` → `db reset` (migrations + seed from zero) → `test db` → `db lint`
3. **build**: web + admin production builds
4. **e2e**: Playwright against the production build of web

A milestone isn't done until all four are green (Phase 4 §1, global DoD).

## Conventions

- pgTAP files: `NNN_<area>.test.sql`, one `plan()` per file, wrapped in `begin … rollback`.
- Role-based tests set `role` and JWT claims explicitly (`set local role authenticated;`
  `set local request.jwt.claims = '{…}'`). Helpers arrive in M1.
- Tests never depend on execution order across files.
