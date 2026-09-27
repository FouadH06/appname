-- M1 · Explicit service_role grants (align local with hosted)
-- Spec: Phase 3 Part 1 §6.1 — service_role (Edge Functions, cron; server-only) bypasses RLS.
-- Hosted Supabase grants service_role DML on new public tables through its platform default
-- privileges; local (auto_expose_new_tables = false) does not. Making it explicit keeps both
-- environments identical. audit/private stay closed to service_role (no grants there).

grant select, insert, update, delete on all tables    in schema public to service_role;
grant usage, select                  on all sequences in schema public to service_role;

alter default privileges for role postgres, app_owner in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres, app_owner in schema public
  grant usage, select on sequences to service_role;
