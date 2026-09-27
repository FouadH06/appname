-- M0 harness check: proves pgTAP runs in `supabase test db` (locally and in CI).
-- Real suites start in M1 (Phase 3 Part 7). Naming: NNN_<area>.test.sql, one plan per file.
begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(true, 'pgTAP harness is running');
select has_schema('public', 'public schema exists');
select cmp_ok(
  current_setting('server_version_num')::int, '>=', 150000,
  'Postgres >= 15 (multiranges required by the availability engine)'
);

select * from finish();
rollback;
