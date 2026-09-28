-- Read-only schema fingerprint for public/private/audit. Run with:
--   supabase test db supabase/diagnostics/schema-fingerprint.sql            (local)
--   supabase test db --linked supabase/diagnostics/schema-fingerprint.sql   (hosted)
-- and compare the FP lines. Not part of the test suite (lives outside supabase/tests).
set role postgres;
-- Fixed search_path so pg_get_*def() renders identically everywhere (e.g. operator classes
-- print schema-qualified regardless of the connecting role's default search_path).
set search_path = pg_catalog, public;
do $$
declare
  r record;
  schemas text[] := array['public', 'private', 'audit'];
begin
  for r in
    select 'tables+columns' as k, count(*) as n, md5(string_agg(x, '|' order by x)) as h from (
      select format('%s.%s.%s:%s:%s:%s', table_schema, table_name, column_name, data_type,
                    is_nullable, coalesce(column_default, '')) x
      from information_schema.columns where table_schema = any (schemas)) s
    union all
    select 'constraints', count(*), md5(string_agg(x, '|' order by x)) from (
      select c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid) x
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = any (schemas)) s
    union all
    select 'indexes', count(*), md5(string_agg(x, '|' order by x)) from (
      select pg_get_indexdef(i.indexrelid) x
      from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any (schemas)) s
    union all
    select 'functions', count(*), md5(string_agg(x, '|' order by x)) from (
      select p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || p.prosecdef
             || ':' || coalesce(array_to_string(p.proconfig, ','), '') || ':' || pg_get_userbyid(p.proowner)
             || ':' || coalesce((select string_agg(a.grantee::regrole::text || '=' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
                                 from aclexplode(p.proacl) a where a.grantee <> 0), '') x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any (schemas)
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) s
    union all
    select 'policies', count(*), md5(string_agg(x, '|' order by x)) from (
      select schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || roles::text
             || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') x
      from pg_policies where schemaname = any (schemas)) s
    union all
    select 'triggers', count(*), md5(string_agg(x, '|' order by x)) from (
      select pg_get_triggerdef(t.oid) x
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and (n.nspname = any (schemas) or t.tgname = 'on_auth_user_synced')) s
    union all
    select 'enums', count(*), md5(string_agg(x, '|' order by x)) from (
      select t.typname || ':' || string_agg(e.enumlabel, ',' order by e.enumsortorder) x
      from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = any (schemas) group by t.typname) s
    union all
    select 'table_grants', count(*), md5(string_agg(x, '|' order by x)) from (
      select table_schema || '.' || table_name || ':' || grantee || ':' || privilege_type x
      from information_schema.role_table_grants
      where table_schema = any (schemas) and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) s
    union all
    select 'column_grants', count(*), md5(string_agg(x, '|' order by x)) from (
      select table_schema || '.' || table_name || '.' || column_name || ':' || grantee || ':' || privilege_type x
      from information_schema.column_privileges
      where table_schema = any (schemas) and grantee in ('anon', 'authenticated')) s
    union all
    select 'ownership', count(*), md5(string_agg(x, '|' order by x)) from (
      select n.nspname || '.' || c.relname || ':' || pg_get_userbyid(c.relowner) x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any (schemas) and c.relkind in ('r', 'v', 'm', 'S')) s
    union all
    select 'seed_rows', 0, md5(concat_ws(',',
      (select count(*) from public.areas), (select count(*) from public.area_aliases),
      (select count(*) from public.clusters), (select count(*) from public.cluster_areas),
      (select count(*) from public.categories), (select count(*) from public.rating_dimensions),
      (select count(*) from public.canonical_services), (select count(*) from public.service_synonyms)))
  loop
    raise notice 'FP % n=% %', rpad(r.k, 15), r.n, r.h;
  end loop;
end $$;
