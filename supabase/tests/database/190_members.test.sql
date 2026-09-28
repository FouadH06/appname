-- Phase 3 Part 2 §5.2, Part 1 §6.3 — invitations bound to a phone, role rules, transfer, revoke
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(39);

-- ─── fixtures ───
select tests.new_user('owner', '96170100100');
select tests.new_user('mgr',   '96170200200');
select tests.new_user('recep', '96170300300');
select tests.new_user('stylist', '96170400400');
select tests.new_user('stranger', '96170500500');
select tests.new_user('ops', '96170600600');
select tests.new_user('newowner', '96170700700');
select tests.new_user('visitor');
select tests.new_business('biz', 'owner');
select tests.new_staff('biz', 'Nadine');                              -- staff profile without a login yet
insert into public.businesses (slug, name, primary_category_id, status)
select 'ownerless-test', 'Ownerless', id, 'draft' from public.categories where slug = 'barber';
insert into tests.ids select 'ownerless', id from public.businesses where slug = 'ownerless-test';
insert into public.admin_users (user_id, role) values (tests.id('ops'), 'ops');

create table tests.inv (name text primary key, token text, id uuid);
grant select, insert on tests.inv to anon, authenticated;
create function tests.invite(p_name text, p_biz text, p_phone text, p_role public.business_role, p_staff text default null)
returns void language plpgsql as $$
declare r jsonb;
begin
  r := public.invite_member(tests.id(p_biz), p_phone, p_role, case when p_staff is not null then tests.id(p_staff) end);
  insert into tests.inv values (p_name, r ->> 'token', (r ->> 'invitation_id')::uuid);
end $$;
grant execute on all functions in schema tests to anon, authenticated;

-- ═══ who may invite whom ═══
select tests.act_as('owner');
select lives_ok($$ select tests.invite('mgr', 'biz', '70 200 200', 'manager') $$, 'owner invites a manager (local number format)');
select throws_ok($$ select tests.invite('x', 'biz', '70 100 999', 'owner') $$, 'P0001', 'FORBIDDEN',
  'nobody invites an owner through the team screen');
select throws_ok($$ select tests.invite('x', 'biz', 'hello', 'staff') $$, 'P0001', 'INVALID_PHONE', 'invalid phone rejected');
select tests.as_postgres();
select is((select phone_e164 from private.business_invitations where id = (select id from tests.inv where name = 'mgr')),
  '+96170200200', 'phone stored in E.164');

-- ═══ preview & accept ═══
select tests.as_anon();
select results_eq(
  $$ select r ->> 'business_name', r ->> 'role', r ->> 'phone_hint', r ->> 'state'
     from public.get_invitation((select token from tests.inv where name = 'mgr')) r $$,
  $$ values ('Business biz', 'manager', '+961 70 ••• 200', 'valid') $$,
  'logged-out preview: business, role, masked phone, state');
select tests.act_as('visitor', 'aal1', true);
select throws_ok($$ select public.accept_invitation((select token from tests.inv where name = 'mgr')) $$,
  'P0001', 'AUTH_REQUIRED', 'anonymous session cannot accept');
select tests.act_as('stranger');
select throws_ok($$ select public.accept_invitation((select token from tests.inv where name = 'mgr')) $$,
  'P0001', 'INVITE_PHONE_MISMATCH', 'only the invited number can accept');
select tests.act_as('mgr');
select lives_ok($$ select public.accept_invitation((select token from tests.inv where name = 'mgr')) $$, 'invited manager accepts');
select is((select role::text from public.business_members where business_id = tests.id('biz') and user_id = tests.id('mgr') and status = 'active'),
  'manager', 'membership created with the invited role');
select is((public.accept_invitation((select token from tests.inv where name = 'mgr')) ->> 'already_accepted')::boolean, true,
  'accepting again is idempotent');

-- ═══ manager limits ═══
select throws_ok($$ select tests.invite('x', 'biz', '70 999 111', 'manager') $$, 'P0001', 'FORBIDDEN',
  'a manager cannot invite managers');
select lives_ok($$ select tests.invite('recep', 'biz', '+96170300300', 'reception') $$, 'a manager invites reception');
select lives_ok($$ select tests.invite('stylist', 'biz', '0096170400400', 'staff', 'Nadine') $$,
  'a manager invites a stylist linked to her staff profile');
select throws_ok($$ select tests.invite('x', 'biz', '70 100 100', 'staff') $$, 'P0001', 'MEMBER_EXISTS',
  'inviting an existing member''s number is rejected');

-- re-inviting a number replaces the pending invite
select lives_ok($$ select tests.invite('recep2', 'biz', '70300300', 'reception') $$, 're-invite the same number');
select tests.act_as('recep');
select throws_ok($$ select public.accept_invitation((select token from tests.inv where name = 'recep')) $$,
  'P0001', 'INVITE_INVALID', 'the replaced invite no longer works');
select lives_ok($$ select public.accept_invitation((select token from tests.inv where name = 'recep2')) $$, 'the new one does');
select throws_ok($$ select tests.invite('x', 'biz', '70 111 222', 'staff') $$, 'P0001', 'FORBIDDEN', 'reception cannot invite');
select throws_ok($$ select * from public.list_invitations(tests.id('biz')) $$, 'P0001', 'FORBIDDEN', 'reception cannot list invitations');

select tests.act_as('stylist');
select lives_ok($$ select public.accept_invitation((select token from tests.inv where name = 'stylist')) $$, 'stylist accepts');
select tests.as_postgres();
select is((select user_id from public.staff_members where id = tests.id('Nadine')), tests.id('stylist'),
  'her staff profile is linked to her login');
select tests.act_as('stylist');
select is(private.my_staff_id(tests.id('biz')), tests.id('Nadine'), 'she now acts as that staff member');

-- ═══ expiry and revoke ═══
select tests.act_as('owner');
select lives_ok($$ select tests.invite('late', 'biz', '70 555 000', 'staff') $$, 'another invite');
select lives_ok($$ select tests.invite('revoked', 'biz', '70 555 111', 'staff') $$, 'and another');
select is((select count(*)::int from public.list_invitations(tests.id('biz'))), 2, 'owner sees the pending invites');
select lives_ok($$ select public.revoke_invitation((select id from tests.inv where name = 'revoked')) $$, 'owner revokes one');
select tests.as_postgres();
update private.business_invitations set expires_at = now() - interval '1 minute' where id = (select id from tests.inv where name = 'late');
update auth.users set phone = '96170555000', phone_confirmed_at = now() where id = tests.id('stranger');
select tests.act_as('stranger');
select throws_ok($$ select public.accept_invitation((select token from tests.inv where name = 'late')) $$,
  'P0001', 'INVITE_EXPIRED', 'expired invite rejected');

-- ═══ role changes, revoke, transfer ═══
select tests.act_as('mgr');
select throws_ok($$ select public.change_member_role(tests.id('biz'), tests.id('owner'), 'staff') $$, 'P0001', 'FORBIDDEN',
  'a manager cannot touch the owner');
select lives_ok($$ select public.change_member_role(tests.id('biz'), tests.id('recep'), 'staff') $$, 'a manager changes reception → staff');
select throws_ok($$ select public.change_member_role(tests.id('biz'), tests.id('recep'), 'manager') $$, 'P0001', 'FORBIDDEN',
  'a manager cannot promote to manager');
select lives_ok($$ select public.revoke_member(tests.id('biz'), tests.id('stylist')) $$, 'a manager revokes a stylist');
select tests.as_postgres();
select results_eq(
  $$ select (select status::text from public.business_members where business_id = tests.id('biz') and user_id = tests.id('stylist')),
            (select user_id from public.staff_members where id = tests.id('Nadine')) $$,
  $$ values ('revoked', null::uuid) $$,
  'revoked: membership off and the staff profile unlinked (profile and history stay)');
select tests.act_as('mgr');
select throws_ok($$ select public.transfer_ownership(tests.id('biz'), tests.id('mgr')) $$, 'P0001', 'FORBIDDEN',
  'only the owner transfers ownership');
select tests.act_as('owner');
select lives_ok($$ select public.transfer_ownership(tests.id('biz'), tests.id('mgr')) $$, 'owner transfers to the manager');
select tests.as_postgres();
select results_eq(
  $$ select user_id, role::text from public.business_members
     where business_id = tests.id('biz') and user_id in (tests.id('owner'), tests.id('mgr')) order by role $$,
  $$ values (tests.id('owner'), 'manager'), (tests.id('mgr'), 'owner') $$,
  'roles swapped; still exactly one owner');

-- ═══ ops onboarding: first owner of an ownerless business (admin needs MFA) ═══
select tests.act_as('ops', 'aal1');
select throws_ok($$ select tests.invite('first_owner', 'ownerless', '70 700 700', 'owner') $$, 'P0001', 'FORBIDDEN',
  'ops without MFA (aal1) cannot invite');
select tests.act_as('ops', 'aal2');
select lives_ok($$ select tests.invite('first_owner', 'ownerless', '70 700 700', 'owner') $$, 'ops (aal2) invites the first owner');
select tests.act_as('newowner');
select lives_ok($$ select public.accept_invitation((select token from tests.inv where name = 'first_owner')) $$,
  'the owner accepts the WhatsApp invite');
select tests.act_as('ops', 'aal2');
select throws_ok($$ select tests.invite('second_owner', 'ownerless', '70 100 100', 'owner') $$, 'P0001', 'OWNER_EXISTS',
  'a business never gets a second owner by invite');
select tests.as_postgres();

select * from finish();
rollback;
