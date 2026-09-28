# Testing

| Layer | Tool | Location | Runs in |
|---|---|---|---|
| Database (schema, RLS, RPCs, invariants) | pgTAP | `supabase/tests/database/*.test.sql` | `pnpm db:test`, CI `database` job |
| Concurrency / fuzz / performance (parallel connections) | Vitest + `pg` | `packages/db-tests/src/` | `pnpm --filter @app/db-tests test:db` (local DB); CI `database` job at reduced sizes |
| Unit (pure logic, packages) | Vitest | `packages/*/src/**/*.test.ts` | `pnpm test`, CI `quality` job |
| End-to-end (web flows) | Playwright (mobile + desktop projects) | `apps/web/e2e/` | `pnpm test:e2e`, CI `e2e` job |
| Mobile flows | Maestro (from M13) | `apps/mobile/e2e/` | M13+ |

## CI jobs (`.github/workflows/ci.yml`)

1. **quality**: `format:check`, `lint`, `typecheck`, `test`
2. **database**: `supabase db start` → `db reset` (migrations + seed from zero) → `test db` → `db lint`
3. **build**: web + admin production builds
4. **e2e**: Playwright against the production build of web

A milestone isn't done until all four are green (Phase 4 §1, global DoD).

## Booking-engine harness (`packages/db-tests`)

These tests **commit data**, so they refuse to run against anything but `localhost`/`127.0.0.1`. Run them on the local stack or in CI, never on staging.

| Suite | What | Knobs (env) | Gate A size |
|---|---|---|---|
| `concurrency.test.ts` | Part 7 §4 #21–24, #26: parallel holds on one staff, "Any" with N staff, manual vs online, parallel reschedules, idempotent confirm | `CONCURRENCY_RUNS` (default 100) | 100/100 runs |
| `fuzz.test.ts` | Random RPC operations from 4 workers; after every 250 ops: zero overlapping blocking items, no raw constraint errors | `FUZZ_OPS` (10000), `FUZZ_SEEDS` (1,2,3,4,5) | 10k × 5 seeds |
| `perf.test.ts` | p50/p95 of `get_available_slots` (14 days, Any) and `create_hold` with 8 staff and ~1,900 bookings | `PERF_SAMPLES` (50) | p95 recorded in the milestone report |

```bash
pnpm db:reset                                   # fresh local database
pnpm --filter @app/db-tests test:db             # full sizes
```

## Conventions

- pgTAP files: `NNN_<area>.test.sql`, one `plan()` per file, wrapped in `begin … rollback`.
- Role-based tests set `role` and JWT claims explicitly (`set local role authenticated;`
  `set local request.jwt.claims = '{…}'`). Helpers arrive in M1.
- Tests never depend on execution order across files.
