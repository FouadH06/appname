-- Phase 3 Part 5 §8, Part 7 §1 #5 and §10 #60 — audit capture and immutability
begin;
create extension if not exists pgtap with schema extensions;
-- Hosted sessions (CLI login role) do not have extensions on search_path; be explicit.
set local search_path = extensions, public;
-- Run as postgres everywhere (hosted CLI connects as a temporary login role).
set local role postgres;
select plan(10);

-- ─── test helpers (rolled back with the transaction) ───
create schema tests;
grant usage on schema tests to anon, authenticated;
create table tests.ids (name text primary key, id uuid not null);
grant select on tests.ids to anon, authenticated;
create function tests.id(p_name text) returns uuid language sql stable as
  $$ select id from tests.ids where name = p_name $$;
create function tests.new_user(p_name text, p_phone text default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', p_phone, case when p_phone is not null then now() end, now(), now());
  insert into tests.ids values (p_name, v);
  return v;
end $$;
create function tests.act_as(p_name text, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.id(p_name), 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.new_user('ops_admin');
select tests.new_user('super');

-- 1. INSERT by the system (no JWT) is captured with actor_kind = system
insert into public.admin_users (user_id, role) values (tests.id('ops_admin'), 'moderator');
select results_eq(
  $$ select op, actor_kind::text from audit.entity_changes
     where table_name = 'public.admin_users' and row_id = tests.id('ops_admin') order by id $$,
  $$ values ('INSERT', 'system') $$,
  'insert captured as system');

-- 2. UPDATE records only the changed columns as [old, new]
update public.admin_users set role = 'ops' where user_id = tests.id('ops_admin');
select is(
  (select changed from audit.entity_changes
   where table_name = 'public.admin_users' and row_id = tests.id('ops_admin') and op = 'UPDATE'),
  '{"role": ["moderator", "ops"]}'::jsonb,
  'update diff contains only role');

-- 3. A no-op update writes nothing
update public.admin_users set role = 'ops' where user_id = tests.id('ops_admin');
select is(
  (select count(*)::int from audit.entity_changes
   where table_name = 'public.admin_users' and row_id = tests.id('ops_admin')),
  2, 'no-op update not recorded');

-- 4. A change made by an admin session is recorded as actor_kind = admin
insert into public.admin_users (user_id, role) values (tests.id('super'), 'superadmin');
select tests.act_as('super', 'aal2');
update public.admin_users set is_active = false where user_id = tests.id('ops_admin');
set local role postgres;
select is(
  (select actor_kind::text || ':' || actor_user_id::text from audit.entity_changes
   where table_name = 'public.admin_users' and row_id = tests.id('ops_admin') and op = 'UPDATE'
   order by id desc limit 1),
  'admin:' || tests.id('super')::text,
  'admin session recorded with actor id');

-- 5–8. Immutability for every role, including the table owner
-- (row triggers only fire on existing rows, so make sure admin_actions has one)
insert into audit.admin_actions (actor_user_id, actor_role, action, subject_type, reason_code)
values (tests.id('super'), 'superadmin', 'test.fixture', 'test', 'fixture');
select throws_ok($$ update audit.entity_changes set op = 'DELETE' $$, 'P0001', null, 'entity_changes UPDATE rejected');
select throws_ok($$ delete from audit.entity_changes $$,               'P0001', null, 'entity_changes DELETE rejected');
select throws_ok($$ truncate audit.entity_changes $$,                  'P0001', null, 'entity_changes TRUNCATE rejected');
select throws_ok($$ delete from audit.admin_actions $$,                'P0001', null, 'admin_actions DELETE rejected');

-- 9–10. Client roles can't read audit tables at all
select tests.act_as('super', 'aal2');
select throws_ok($$ select * from audit.entity_changes $$, '42501', null, 'authenticated cannot read audit');
set local role postgres;
select set_config('role', 'anon', true);
select throws_ok($$ select * from audit.admin_actions $$, '42501', null, 'anon cannot read audit');
set local role postgres;

select * from finish();
rollback;
