-- Phase 3 Part 2 §1, Part 1 §6–7, Part 7 §6 #34 (phone sync only) and §8 #50 (aal2)
begin;
create extension if not exists pgtap with schema extensions;
-- Hosted sessions (CLI login role) do not have extensions on search_path; be explicit.
set local search_path = extensions, public;
-- Run as postgres everywhere (hosted CLI connects as a temporary login role).
set local role postgres;
select plan(20);

-- ─── test helpers ───
create schema tests;
grant usage on schema tests to anon, authenticated;
create table tests.ids (name text primary key, id uuid not null);
grant select on tests.ids to anon, authenticated;
create function tests.id(p_name text) returns uuid language sql stable as
  $$ select id from tests.ids where name = p_name $$;
create function tests.new_user(p_name text, p_phone text default null, p_confirmed boolean default true)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
  values (v, 'authenticated', 'authenticated', p_phone,
          case when p_confirmed and p_phone is not null then now() end, now(), now());
  insert into tests.ids values (p_name, v);
  return v;
end $$;
create function tests.act_as(p_name text, p_aal text default 'aal1', p_anonymous boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.id(p_name), 'role', 'authenticated', 'aal', p_aal,
                      'is_anonymous', p_anonymous)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.new_user('moe', '96170123456');                 -- GoTrue stores phones without '+'
select tests.new_user('rita', '9613123456');
select tests.new_user('unverified', '96171999999', false);
select tests.new_user('anon_visitor');                       -- anonymous auth user: no phone
select tests.new_user('mod', '96176000001');
select tests.new_user('boss', '96176000002');
insert into public.admin_users (user_id, role) values (tests.id('mod'), 'moderator'), (tests.id('boss'), 'superadmin');

-- ─── auth → profile sync ───
select is((select phone_e164 from public.profiles where id = tests.id('moe')), '+96170123456',
  'profile created with E.164 phone');
select isnt((select phone_verified_at from public.profiles where id = tests.id('moe')), null,
  'confirmed phone → phone_verified_at set');
select is((select phone_verified_at from public.profiles where id = tests.id('unverified')), null,
  'unconfirmed phone → not verified');
select ok(exists (select 1 from public.profiles where id = tests.id('anon_visitor') and phone_e164 is null),
  'user without phone still gets a profile');

update auth.users set phone_confirmed_at = now() where id = tests.id('unverified');
select isnt((select phone_verified_at from public.profiles where id = tests.id('unverified')), null,
  'confirming the phone later updates the profile');

-- ─── is_active_customer ───
select tests.act_as('moe');
select ok(private.is_active_customer(), 'verified active user is a customer');
set local role postgres;
select tests.act_as('anon_visitor', 'aal1', true);
select ok(not private.is_active_customer(), 'anonymous user is not a customer');
set local role postgres;
update public.profiles set status = 'suspended', status_reason = 'test' where id = tests.id('rita');
select tests.act_as('rita');
select ok(not private.is_active_customer(), 'suspended user is not a customer');
set local role postgres;

-- ─── is_admin requires aal2 ───
select tests.act_as('mod', 'aal1');
select ok(not private.is_admin(), 'admin with aal1 → not admin');
set local role postgres;
select tests.act_as('mod', 'aal2');
select ok(private.is_admin('{moderator}'), 'moderator with aal2 → moderator');
select ok(not private.is_admin('{ops}'), 'moderator is not ops');
set local role postgres;
select tests.act_as('boss', 'aal2');
select ok(private.is_admin('{ops}'), 'superadmin satisfies any role');
set local role postgres;
select tests.act_as('moe', 'aal2');
select ok(not private.is_admin(), 'non-admin with aal2 → not admin');
set local role postgres;

-- ─── profiles RLS ───
select tests.act_as('moe');
select is((select count(*)::int from public.profiles), 1, 'user sees only their own profile');
select lives_ok($$ update public.profiles set first_name = 'Moe' where id = auth.uid() $$,
  'user can edit their name');
select throws_ok($$ update public.profiles set status = 'active' where id = auth.uid() $$,
  '42501', null, 'user cannot change status');
select throws_ok($$ update public.profiles set phone_e164 = '+96170000000' where id = auth.uid() $$,
  '42501', null, 'user cannot change phone (comes from Auth)');
update public.profiles set first_name = 'Hacked' where id = tests.id('rita');
set local role postgres;
select is((select first_name from public.profiles where id = tests.id('rita')), null,
  'user cannot edit someone else''s profile');

-- ─── admin_users RLS ───
select tests.act_as('moe', 'aal2');
select is((select count(*)::int from public.admin_users), 0, 'non-admin sees no admin rows');
select throws_ok($$ insert into public.admin_users (user_id, role) values (auth.uid(), 'superadmin') $$,
  '42501', null, 'non-admin cannot grant themselves admin');
set local role postgres;

select * from finish();
rollback;
