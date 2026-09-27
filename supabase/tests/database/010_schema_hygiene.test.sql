-- Phase 3 Part 7 §1 — schema hygiene (runs on every migration)
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- 1. RLS on every table in public
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every public table has RLS enabled');

-- 2. anon: only SELECT, only on catalog / location reference tables
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'
     and (privilege_type <> 'SELECT'
          or table_name not in ('areas', 'area_aliases', 'clusters', 'cluster_areas', 'categories',
                                'rating_dimensions', 'canonical_services', 'service_synonyms'))),
  0, 'anon has SELECT on reference tables only');

-- 3. client roles have no table privileges in private or audit
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated', 'PUBLIC') and table_schema in ('private', 'audit')),
  0, 'no client table privileges in private/audit');

-- 4. service_role cannot modify audit tables
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'audit'
     and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'service_role has no UPDATE/DELETE/TRUNCATE on audit');

-- 5. every SECURITY DEFINER function pins search_path
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'audit') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  0, 'SECURITY DEFINER functions set search_path');

-- 5b. definer functions (owned by app_owner) must not call the auth schema directly;
--     they use private.uid()/private.jwt() (decision log 2026-09-27, M1)
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'audit') and p.prosecdef
     and p.prosrc ~* 'auth\.(uid|jwt|role|email)\s*\('),
  0, 'SECURITY DEFINER functions do not call auth.*()');

-- 6. no application function is executable by PUBLIC
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'audit')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))),
  0, 'no function executable by PUBLIC');

-- 7–9. everything in the application schemas is owned by app_owner (Part 1 §2)
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private', 'audit') and c.relkind in ('r', 'p', 'v', 'm')
     and pg_get_userbyid(c.relowner) <> 'app_owner'),
  0, 'tables/views owned by app_owner');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'audit')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and pg_get_userbyid(p.proowner) <> 'app_owner'),
  0, 'functions owned by app_owner');
select is(
  (select count(*)::int from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname in ('public', 'private', 'audit') and t.typtype = 'e'
     and pg_get_userbyid(t.typowner) <> 'app_owner'),
  0, 'enums owned by app_owner');

select * from finish();
rollback;
