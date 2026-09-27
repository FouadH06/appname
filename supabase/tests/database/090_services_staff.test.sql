-- Phase 3 Part 2 §6–8, Part 7 §2 #6–10 — services, staff, schedules integrity + demo fixture (M2 DoD)
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(32);

select tests.new_user('owner_a');
select tests.new_user('owner_b');
select tests.new_business('biz_a', 'owner_a');
select tests.new_business('biz_b', 'owner_b');

-- ─── service price rules (Part 7 #7) ───
create function tests.try_service(p_type public.price_type, p_min numeric, p_max numeric, p_online boolean)
returns void language sql as $$
  insert into public.services (business_id, canonical_service_id, name, price_type, price_min, price_max,
                               duration_min, is_online_bookable)
  select tests.id('biz_a'), id, 'Test', p_type, p_min, p_max, 30, p_online
  from public.canonical_services where slug = 'mens-haircut'
$$;
select lives_ok($$ select tests.try_service('fixed', 15, null, true) $$,  'fixed price ok');
select lives_ok($$ select tests.try_service('from', 65, null, true) $$,   '"from" price ok');
select lives_ok($$ select tests.try_service('range', 40, 60, true) $$,    'range ok');
select lives_ok($$ select tests.try_service('on_consultation', null, null, false) $$, 'consultation (offline) ok');
select throws_ok($$ select tests.try_service('fixed', 15, 20, true) $$,    '23514', null, 'fixed with a max rejected');
select throws_ok($$ select tests.try_service('range', 40, null, true) $$,  '23514', null, 'range without max rejected');
select throws_ok($$ select tests.try_service('range', 60, 40, true) $$,    '23514', null, 'range max <= min rejected');
select throws_ok($$ select tests.try_service('on_consultation', null, null, true) $$,
  '23514', null, 'consultation cannot be booked online');
select throws_ok($$ select tests.try_service('fixed', -1, null, true) $$,  '23514', null, 'negative price rejected');

-- ─── staff flags ───
select throws_ok($$ select tests.new_staff('biz_a', 'Bad Flags', null, false, true) $$,
  '23514', null, 'internal-only staff cannot accept automatic "Any" assignment');
select lives_ok($$ select tests.new_staff('biz_a', 'Owner Only', null, false, false) $$,
  'internal-only worker (not bookable, no auto-assign) allowed');
select lives_ok($$ select tests.new_staff('biz_a', 'Senior Maya', null, true, false) $$,
  'senior stylist (bookable, no auto-assign) allowed');
select ok(exists (select 1 from public.staff_stats where staff_id = tests.id('Senior Maya')),
  'staff_stats row created with the staff member');

-- ─── cross-tenant integrity (Part 7 #6) ───
select tests.new_staff('biz_a', 'Karim');
select tests.new_staff('biz_b', 'Joe');
select tests.new_service('biz_a', 'Haircut A');
select tests.new_service('biz_b', 'Haircut B');

select throws_ok($$ insert into public.staff_services (staff_id, service_id, business_id)
                    values (tests.id('Karim'), tests.id('Haircut B'), tests.id('biz_a')) $$,
  '23503', null, 'staff of A cannot perform a service of B');
select throws_ok($$ insert into public.staff_services (staff_id, service_id, business_id)
                    values (tests.id('Karim'), tests.id('Haircut B'), tests.id('biz_b')) $$,
  '23503', null, '... even when the row claims business B');
select throws_ok($$ insert into public.staff_locations (staff_id, location_id, business_id)
                    values (tests.id('Karim'), tests.id('biz_b_loc'), tests.id('biz_a')) $$,
  '23503', null, 'staff of A cannot be placed at a location of B');
select throws_ok($$ insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute)
                    values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_b'), 1, 540, 1080) $$,
  '23503', null, 'weekly hours cannot carry another business''s id');
select throws_ok($$ insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute)
                    values (tests.id('Joe'), tests.id('biz_a_loc'), tests.id('biz_b'), 1, 540, 1080) $$,
  '23503', null, 'weekly hours need the staff member to be linked to that location');

-- ─── specialties cap ───
insert into public.staff_services (staff_id, service_id, business_id, is_specialty)
select tests.id('Karim'), s.id, s.business_id, true
from public.services s where s.business_id = tests.id('biz_a') and s.status = 'active'
  and s.id <> tests.id('Haircut A') order by s.created_at, s.id limit 3;
select throws_ok($$ insert into public.staff_services (staff_id, service_id, business_id, is_specialty)
                    values (tests.id('Karim'), tests.id('Haircut A'), tests.id('biz_a'), true) $$,
  'P0001', 'SPECIALTY_LIMIT', 'a 4th specialty is rejected');

-- ─── staff service overrides ───
select throws_ok($$ update public.staff_services set price_type_override = 'on_consultation', price_min_override = null
                    where staff_id = tests.id('Karim') and service_id = (select service_id from public.staff_services where staff_id = tests.id('Karim') limit 1) $$,
  '23514', null, 'staff override cannot be "on consultation"');
select throws_ok($$ update public.staff_services set price_type_override = 'range', price_min_override = 20, price_max_override = null
                    where staff_id = tests.id('Karim') and service_id = (select service_id from public.staff_services where staff_id = tests.id('Karim') limit 1) $$,
  '23514', null, 'range override needs a max');
select throws_ok($$ update public.staff_services set price_max_override = 50
                    where staff_id = tests.id('Karim') and service_id = (select service_id from public.staff_services where staff_id = tests.id('Karim') limit 1) $$,
  '23514', null, 'a max override without a range type is rejected');

-- ─── schedules ───
insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute)
values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), 2, 540, 780),
       (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), 2, 840, 1140);
select is((select count(*)::int from public.staff_weekly_hours where staff_id = tests.id('Karim') and iso_weekday = 2), 2,
  'split shift (break 13:00–14:00) allowed');
select throws_ok($$ insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute)
                    values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), 2, 1100, 1200) $$,
  '23P01', null, 'overlapping weekly hours rejected');
select lives_ok($$ insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
                   values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), 3, 540, 1080, current_date + 30) $$,
  'future effective-dated hours allowed');
select throws_ok($$ insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from, effective_to)
                    values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), 3, 600, 700, current_date + 40, current_date + 50) $$,
  '23P01', null, 'effective-dated hours that overlap in time are rejected');

insert into public.staff_schedule_overrides (staff_id, location_id, business_id, on_date, is_working)
values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), current_date + 7, false);
select throws_ok($$ insert into public.staff_schedule_overrides (staff_id, location_id, business_id, on_date, is_working, start_minute, end_minute)
                    values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), current_date + 7, true, 600, 900) $$,
  '23P01', null, 'a day off cannot also have working hours');
select throws_ok($$ insert into public.staff_schedule_overrides (staff_id, location_id, business_id, on_date, is_working, start_minute)
                    values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), current_date + 8, true, 600) $$,
  '23514', null, 'a working override needs start and end');

select throws_ok($$ insert into public.staff_time_off (staff_id, business_id, period, created_by)
                    values (tests.id('Karim'), tests.id('biz_a'), tstzrange(now(), null), tests.id('owner_a')) $$,
  '23514', null, 'open-ended time off rejected');

-- ─── M2 DoD: a full demo business built purely from SQL ───
-- 2 staff with different overrides, split shifts, a closure.
select tests.new_service('biz_a', 'Hair + Beard', 'haircut-beard', 22, 45);
insert into public.staff_services (staff_id, service_id, business_id, duration_min_override, price_type_override, price_min_override)
values (tests.id('Senior Maya'), tests.id('Hair + Beard'), tests.id('biz_a'), 60, 'fixed', 30),     -- slower, pricier
       (tests.id('Karim'),       tests.id('Hair + Beard'), tests.id('biz_a'), null, null, null);    -- service defaults
insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute)
values (tests.id('Senior Maya'), tests.id('biz_a_loc'), tests.id('biz_a'), 2, 600, 840),
       (tests.id('Senior Maya'), tests.id('biz_a_loc'), tests.id('biz_a'), 2, 900, 1200);
insert into public.location_closures (location_id, business_id, period, label)
values (tests.id('biz_a_loc'), tests.id('biz_a'), daterange(current_date + 60, current_date + 63), 'Holiday');

select results_eq(
  $$ select s.display_name, coalesce(ss.duration_min_override, sv.duration_min), coalesce(ss.price_min_override, sv.price_min)
     from public.staff_services ss join public.staff_members s on s.id = ss.staff_id join public.services sv on sv.id = ss.service_id
     where ss.service_id = tests.id('Hair + Beard') order by s.display_name $$,
  $$ values ('Karim'::text, 45, 22.00::numeric), ('Senior Maya'::text, 60, 30.00::numeric) $$,
  'demo business: two staff with different effective duration and price');
select is((select count(*)::int from public.staff_weekly_hours where business_id = tests.id('biz_a') and iso_weekday = 2), 4,
  'demo business: both staff have split Tuesday shifts');
select is((select count(*)::int from public.location_closures where business_id = tests.id('biz_a')), 1,
  'demo business: closure recorded');

select * from finish();
rollback;
