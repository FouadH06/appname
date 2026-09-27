-- Phase 3 Part 6 §3.3–3.4, Part 1 §6.3, Part 7 §8 #46–49 — business RLS per role
-- Roles: owner, manager, reception, staff (A) · owner of another business (B) · customer · anon · admin
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(33);

-- ─── fixtures ───
select tests.new_user('owner_a');  select tests.new_user('manager_a');
select tests.new_user('recep_a');  select tests.new_user('staff_user_a');
select tests.new_user('owner_b');  select tests.new_user('customer');
select tests.new_user('support_admin');
select tests.new_business('biz_a', 'owner_a');
select tests.new_business('biz_b', 'owner_b');
select tests.add_member('biz_a', 'manager_a', 'manager');
select tests.add_member('biz_a', 'recep_a', 'reception');
select tests.add_member('biz_a', 'staff_user_a', 'staff');
insert into public.admin_users (user_id, role) values (tests.id('support_admin'), 'support');

select tests.new_staff('biz_a', 'Karim', 'staff_user_a');      -- the staff member with a login
select tests.new_staff('biz_a', 'Joe');                          -- a colleague without a login
select tests.new_service('biz_a', 'Haircut A');
select tests.new_service('biz_b', 'Haircut B');
insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute)
values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), 1, 540, 1080),
       (tests.id('Joe'),   tests.id('biz_a_loc'), tests.id('biz_a'), 1, 540, 1080);
insert into public.staff_time_off (staff_id, business_id, period, reason, created_by)
values (tests.id('Karim'), tests.id('biz_a'), tstzrange(now() + interval '1 day', now() + interval '2 days'), 'dentist', tests.id('owner_a')),
       (tests.id('Joe'),   tests.id('biz_a'), tstzrange(now() + interval '3 days', now() + interval '4 days'), 'family', tests.id('owner_a'));
insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
values (tests.id('biz_a'), '+96170111111', 'Rita', 'manual');
insert into tests.ids select 'rita', id from public.business_customers where display_name = 'Rita';
insert into public.customer_notes (business_id, business_customer_id, author_user_id, body)
values (tests.id('biz_a'), tests.id('rita'), tests.id('owner_a'), 'Prefers short fades');

-- ─── owner of ANOTHER business sees nothing of A (Part 7 #46) ───
select tests.act_as('owner_b');
select is((select count(*)::int from public.businesses), 1, 'B owner sees only their own business');
select is((select count(*)::int from public.services where business_id = tests.id('biz_a')), 0, 'B owner sees no A services');
select is((select count(*)::int from public.staff_members where business_id = tests.id('biz_a')), 0, 'B owner sees no A staff');
select is((select count(*)::int from public.staff_weekly_hours where business_id = tests.id('biz_a')), 0, 'B owner sees no A schedules');
select is((select count(*)::int from public.business_customers where business_id = tests.id('biz_a')), 0, 'B owner sees no A customers');
select is((select count(*)::int from public.customer_notes where business_id = tests.id('biz_a')), 0, 'B owner sees no A notes');
update public.services set price_min = 1 where business_id = tests.id('biz_a');
select tests.as_postgres();
select is((select price_min from public.services where id = tests.id('Haircut A')), 15.00::numeric,
  'B owner cannot modify A services');

-- ─── owner ───
select tests.act_as('owner_a');
select is((select count(*)::int from public.business_members where business_id = tests.id('biz_a')), 4, 'owner sees the whole team');
select lives_ok($$ update public.businesses set name = 'Fade District' where id = tests.id('biz_a') $$, 'owner edits the profile');
select throws_ok($$ update public.businesses set status = 'suspended' where id = tests.id('biz_a') $$,
  '42501', null, 'owner cannot change status directly (RPC only)');
select is((select count(*)::int from public.staff_time_off where business_id = tests.id('biz_a')), 2, 'owner sees all time off');
select tests.as_postgres();
select is((select actor_kind::text || ':' || actor_user_id::text from audit.entity_changes
           where table_name = 'public.businesses' and row_id = tests.id('biz_a') and op = 'UPDATE' order by id desc limit 1),
  'business:' || tests.id('owner_a')::text, 'profile edit audited with the owner as actor');

-- ─── manager ───
select tests.act_as('manager_a');
select lives_ok($$ update public.services set price_min = 18 where id = tests.id('Haircut A') $$, 'manager edits prices');
select lives_ok($$ update public.business_settings set min_notice_minutes = 120 where business_id = tests.id('biz_a') $$,
  'manager edits booking rules');
select lives_ok($$ insert into public.staff_members (business_id, display_name, slug) values (tests.id('biz_a'), 'Nour', 'nour') $$,
  'manager adds staff');
select throws_ok($$ insert into public.staff_members (business_id, user_id, display_name, slug)
                    values (tests.id('biz_a'), auth.uid(), 'Me', 'me') $$,
  '42501', null, 'linking a login to staff is RPC-only (column not insertable)');
select throws_ok($$ insert into public.business_members (business_id, user_id, role) values (tests.id('biz_a'), tests.id('customer'), 'manager') $$,
  '42501', null, 'members are managed via RPC only');

-- ─── reception (Part 7 #47) ───
select tests.act_as('recep_a');
select cmp_ok((select count(*)::int from public.services where business_id = tests.id('biz_a')), '>', 0, 'reception reads services');
update public.services set price_min = 1 where id = tests.id('Haircut A');
select tests.as_postgres();
select is((select price_min from public.services where id = tests.id('Haircut A')), 18.00::numeric, 'reception cannot change prices');
select tests.act_as('recep_a');
select throws_ok($$ insert into public.staff_members (business_id, display_name, slug) values (tests.id('biz_a'), 'X', 'x') $$,
  '42501', null, 'reception cannot add staff');
select is((select count(*)::int from public.staff_time_off), 0, 'reception has no direct access to time off (reasons are private)');
select is((select count(*)::int from public.business_customers), 0, 'reception reads customers only via the CRM RPC');
select lives_ok($$ insert into public.customer_notes (business_id, business_customer_id, author_user_id, body)
                   values (tests.id('biz_a'), tests.id('rita'), auth.uid(), 'Called to confirm') $$,
  'reception writes notes on a customer');
select is((select count(*)::int from public.business_members), 1, 'reception sees only their own membership row');
select tests.as_postgres();

-- ─── staff role (Part 7 #48) ───
select tests.act_as('staff_user_a');
select results_eq($$ select staff_id from public.staff_weekly_hours $$, $$ values (tests.id('Karim')) $$,
  'staff sees only their own schedule');
select results_eq($$ select reason from public.staff_time_off $$, $$ values ('dentist'::text) $$,
  'staff sees only their own time off');
select is((select count(*)::int from public.business_customers), 0, 'staff cannot read the customer list');
select is((select count(*)::int from public.customer_notes), 0, 'staff cannot read notes directly');
select is((select count(*)::int from public.staff_stats), 1, 'staff sees only their own stats');
select tests.as_postgres();

-- ─── customer (no membership) and anon ───
select tests.act_as('customer');
select is((select count(*)::int from public.businesses) + (select count(*)::int from public.services)
        + (select count(*)::int from public.staff_members), 0, 'customer reads no business tables directly (public RPCs later)');
select tests.as_postgres();
select tests.as_anon();
select throws_ok($$ select * from public.businesses $$, '42501', null, 'anon has no table access to businesses');
select throws_ok($$ select * from public.staff_members $$, '42501', null, 'anon has no table access to staff');
select tests.as_postgres();

-- ─── admin (support, MFA) ───
select tests.act_as('support_admin', 'aal2');
select is((select count(*)::int from public.businesses), 2, 'admin reads all businesses');
select tests.as_postgres();

select * from finish();
rollback;
