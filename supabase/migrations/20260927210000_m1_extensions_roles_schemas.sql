-- M1 · Extensions, owner role, schemas, baseline privileges
-- Spec: Phase 3 Part 1 §2–4, Part 6 §2

-- ─── Extensions (Part 1 §4) ────────────────────────────────────────────────
-- pgtap is installed by the test suite only (never needed at runtime).
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext     with schema extensions;
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists pg_trgm    with schema extensions;
create extension if not exists unaccent   with schema extensions;
create extension if not exists postgis    with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pgmq;
create extension if not exists pg_net;

-- ─── Owner role (Part 1 §2) ────────────────────────────────────────────────
-- Tables and SECURITY DEFINER functions are owned by app_owner, a NOLOGIN non-superuser,
-- so a definer function can only ever touch application objects.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_owner') then
    create role app_owner nologin noinherit;
  end if;
end $$;

grant app_owner to postgres;                          -- lets migrations transfer ownership
grant usage on schema extensions to app_owner;
grant usage on schema auth to app_owner;              -- auth.uid(), auth.jwt()
grant references on auth.users to app_owner;          -- FKs to auth.users
grant usage, create on schema public to app_owner;

-- ─── Schemas (Part 1 §3) ───────────────────────────────────────────────────
create schema if not exists private authorization app_owner;   -- not exposed via the API
create schema if not exists audit   authorization app_owner;   -- not exposed via the API

revoke all on schema private from public;
revoke all on schema audit   from public;
-- RLS helper functions live in private, so client roles need USAGE (never table access).
grant usage on schema private to anon, authenticated;

-- ─── Baseline privileges (Part 6 §2): default deny ─────────────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres, app_owner in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres, app_owner in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres, app_owner in schema public, private, audit
  revoke execute on functions from public;
alter default privileges for role postgres, app_owner in schema public, private, audit
  revoke execute on functions from anon, authenticated;

-- ─── Shared utilities ──────────────────────────────────────────────────────
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Transfers every application object in public/private/audit to app_owner.
-- Called at the end of every migration, so ownership never drifts back to postgres.
create function private.assign_app_ownership() returns void
language plpgsql set search_path = '' as $$
declare
  r record;
begin
  -- tables, views, sequences not owned by a column
  for r in
    select n.nspname, c.relname, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private', 'audit')
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and pg_catalog.pg_get_userbyid(c.relowner) <> 'app_owner'
      and not exists (select 1 from pg_catalog.pg_depend d
                      where d.objid = c.oid and d.deptype in ('e', 'a', 'i'))
  loop
    execute format('alter %s %I.%I owner to app_owner',
      case r.relkind when 'v' then 'view' when 'm' then 'materialized view'
                     when 'S' then 'sequence' when 'f' then 'foreign table' else 'table' end,
      r.nspname, r.relname);
  end loop;

  -- functions / procedures
  for r in
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private', 'audit')
      and pg_catalog.pg_get_userbyid(p.proowner) <> 'app_owner'
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter routine %s owner to app_owner', r.sig);
  end loop;

  -- enums, domains, standalone composite types
  for r in
    select n.nspname, t.typname
    from pg_catalog.pg_type t
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public', 'private', 'audit')
      and t.typtype in ('e', 'd', 'c')
      and (t.typtype <> 'c' or exists (select 1 from pg_catalog.pg_class c
                                      where c.oid = t.typrelid and c.relkind = 'c'))
      and pg_catalog.pg_get_userbyid(t.typowner) <> 'app_owner'
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = t.oid and d.deptype = 'e')
  loop
    execute format('alter type %I.%I owner to app_owner', r.nspname, r.typname);
  end loop;
end $$;

revoke execute on function private.assign_app_ownership() from public;

select private.assign_app_ownership();
