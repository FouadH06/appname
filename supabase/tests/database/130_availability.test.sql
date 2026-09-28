-- Phase 3 Part 3 §2–3, Part 7 §3 — availability engine, visibility (non-leak), DST
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(21);

select tests.new_user('owner_a');
select tests.new_user('outsider');
select tests.new_business('biz_a', 'owner_a');
select tests.open_every_day('biz_a');                                  -- 09:00–19:00
select tests.new_staff('biz_a', 'Karim');                              -- public, auto-assign
select tests.new_staff('biz_a', 'Maya', null, true, false);            -- public, no auto-assign (senior)
select tests.new_staff('biz_a', 'Owner Only', null, false, false);     -- internal-only
insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min, buffer_after_min)
select tests.id('biz_a'), id, 'Haircut', 'fixed', 15, 30, 10 from public.canonical_services where slug = 'mens-haircut';
insert into tests.ids select 'Haircut', id from public.services where name = 'Haircut';
select tests.link('biz_a', 'Karim', 'Haircut');
select tests.link('biz_a', 'Maya', 'Haircut');
select tests.link('biz_a', 'Owner Only', 'Haircut');
select tests.staff_every_day('biz_a', 'Karim', 540, 1020, 780, 840);   -- 09–17, break 13–14
select tests.staff_every_day('biz_a', 'Maya', 540, 1020);
select tests.staff_every_day('biz_a', 'Owner Only', 540, 1020);

create function tests.slots(p_staff text, p_day date) returns setof timestamptz language sql as $$
  select slot_start from private.compute_slots(tests.id('biz_a_loc'), tests.id('Haircut'), tests.id(p_staff),
                                               p_day, p_day, 'internal_specific', false) order by 1
$$;
create function tests.local_hhmi(t timestamptz) returns text language sql as
  $$ select to_char(t at time zone 'Asia/Beirut', 'HH24:MI') $$;

-- ─── hours, breaks, buffers (30 min service + 10 min buffer, 15-min grid) ───
select is((select count(*)::int from tests.slots('Karim', tests.day(3))), 24,
  '24 slots: 09:00–12:15 and 14:00–16:15 (break and buffer respected)');
select is((select tests.local_hhmi(min(s)) from tests.slots('Karim', tests.day(3)) s), '09:00', 'first slot 09:00');
select is((select tests.local_hhmi(max(s)) from tests.slots('Karim', tests.day(3)) s), '16:15', 'last slot 16:15 (16:15 + 40 min = 16:55)');
select ok(not exists (select 1 from tests.slots('Karim', tests.day(3)) s where tests.local_hhmi(s) in ('12:30', '13:00', '13:30')),
  'no slot runs into the lunch break');

-- ─── overrides, location hours, time off, closures, busy time, holds ───
insert into public.staff_schedule_overrides (staff_id, location_id, business_id, on_date, is_working, start_minute, end_minute)
values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), tests.day(4), true, 480, 1200);   -- 08:00–20:00
select is((select count(*)::int from tests.slots('Karim', tests.day(4))), 38,
  'override replaces weekly hours, clipped to opening hours 09:00–19:00 (38 slots)');
insert into public.staff_schedule_overrides (staff_id, location_id, business_id, on_date, is_working)
values (tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), tests.day(5), false);
select is((select count(*)::int from tests.slots('Karim', tests.day(5))), 0, 'day-off override → no slots');

insert into public.staff_time_off (staff_id, business_id, period, created_by)
values (tests.id('Karim'), tests.id('biz_a'), tstzrange(tests.at(tests.day(6), '10:00'), tests.at(tests.day(6), '11:00')), tests.id('owner_a'));
select is((select count(*)::int from tests.slots('Karim', tests.day(6))), 18, 'time off 10:00–11:00 removes 6 slots');

insert into public.location_closures (location_id, business_id, period)
values (tests.id('biz_a_loc'), tests.id('biz_a'), daterange(tests.day(7), tests.day(8)));
select is((select count(*)::int from tests.slots('Karim', tests.day(7))), 0, 'closure day → no slots');
select is((select count(*)::int from tests.slots('Karim', tests.day(8))), 24, 'closure end is exclusive');

select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(9), '09:00'), 30, 'confirmed', 10);
select is((select count(*)::int from tests.slots('Karim', tests.day(9))), 21, 'a 09:00 booking (+10 min buffer) removes 3 slots');

select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(10), '09:00'), 30, 'held', 10);
update public.bookings set expires_at = now() - interval '1 minute' where status = 'held';
select is((select count(*)::int from tests.slots('Karim', tests.day(10))), 24, 'an expired hold does not block availability');

update public.staff_weekly_hours set effective_to = tests.day(30)            -- end the old schedule first
 where staff_id = tests.id('Karim') and iso_weekday = extract(isodow from tests.day(30)) and effective_from < tests.day(30);
insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
select tests.id('Karim'), tests.id('biz_a_loc'), tests.id('biz_a'), extract(isodow from tests.day(30))::int, 600, 720, tests.day(30);
select is((select count(*)::int from tests.slots('Karim', tests.day(30))), 6, 'new effective-dated hours (10:00–12:00) apply from their date');

-- ─── public visibility & assignment eligibility (non-leak, Part 7 #18–19) ───
select results_eq(
  $$ select distinct staff_id from private.compute_slots(tests.id('biz_a_loc'), tests.id('Haircut'), null,
                                                         tests.day(3), tests.day(3), 'public_any', false) $$,
  $$ values (tests.id('Karim')) $$,
  'public "Any" only uses staff who are publicly bookable AND accept auto-assignment');
select cmp_ok((select count(*)::int from public.get_available_slots(tests.id('biz_a_loc'), tests.id('Haircut'), tests.id('Maya'),
                                                                  tests.day(3), tests.day(3))), '>', 0,
  'the senior stylist is bookable when chosen specifically');
select is((select count(*)::int from public.get_available_slots(tests.id('biz_a_loc'), tests.id('Haircut'), tests.id('Owner Only'),
                                                              tests.day(1), tests.day(14))), 0,
  'internal-only staff: no public slots at all');
select is(public.get_next_available(tests.id('biz_a_loc'), tests.id('Haircut'), tests.id('Owner Only')), null,
  'internal-only staff: no public next-available');
select ok((select bool_and(slot_start >= now() + interval '60 minutes')
           from public.get_available_slots(tests.id('biz_a_loc'), tests.id('Haircut'), null, tests.day(0), tests.day(1))),
  'public slots respect the 60-minute minimum notice');

update public.business_settings set staff_choice_mode = 'any_only' where business_id = tests.id('biz_a');
select is((select count(*)::int from public.get_available_slots(tests.id('biz_a_loc'), tests.id('Haircut'), tests.id('Maya'), tests.day(3), tests.day(3))), 0,
  '"any_only" businesses reject specific-staff requests');
update public.business_settings set staff_choice_mode = 'any_or_choose' where business_id = tests.id('biz_a');

-- business wrapper: internal staff visible to members only
select tests.act_as('owner_a');
select cmp_ok((select count(*)::int from public.biz_get_available_slots(tests.id('biz_a_loc'), tests.id('Haircut'), tests.id('Owner Only'), tests.day(3))), '>', 0,
  'members see internal-only staff availability');
select tests.as_postgres();
select tests.act_as('outsider');
select throws_ok($$ select * from public.biz_get_available_slots(tests.id('biz_a_loc'), tests.id('Haircut'), null, tests.day(3)) $$,
  'P0001', 'FORBIDDEN', 'non-members cannot use the business availability RPC');
select tests.as_postgres();

-- ─── DST (Asia/Beirut: clocks jump 00:00→01:00 on the last Sunday of March) ───
create function tests.last_sunday(p_year int, p_month int) returns date language sql as $$
  select (d - ((extract(isodow from d)::int) % 7))::date
  from (select (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date as d) x
$$;
insert into public.staff_schedule_overrides (staff_id, location_id, business_id, on_date, is_working, start_minute, end_minute)
values (tests.id('Maya'), tests.id('biz_a_loc'), tests.id('biz_a'), tests.last_sunday(extract(year from now())::int + 1, 3), true, 540, 1020),
       (tests.id('Maya'), tests.id('biz_a_loc'), tests.id('biz_a'), tests.last_sunday(extract(year from now())::int + 1, 3) - 1, true, 540, 1020);
select results_eq(
  $$ select to_char(min(s) at time zone 'UTC', 'HH24:MI'), count(*)::int
     from tests.slots('Maya', tests.last_sunday(extract(year from now())::int + 1, 3) - 1) s
     union all
     select to_char(min(s) at time zone 'UTC', 'HH24:MI'), count(*)::int
     from tests.slots('Maya', tests.last_sunday(extract(year from now())::int + 1, 3)) s $$,
  $$ values ('07:00', 30), ('06:00', 30) $$,
  'DST: 09:00 Beirut is 07:00 UTC the day before and 06:00 UTC on the switch day; same 30 slots');

select * from finish();
rollback;
