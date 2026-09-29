-- M6 · calendar & daily operations: role-projected calendar, block time, reassign options,
--      affected bookings, bookings list, booking timeline, customer detail, undo, today, Realtime
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(52);

create table tests.v (k text primary key, j jsonb);
grant select, insert, update on tests.v to authenticated;

select tests.new_user('owner');  select tests.new_user('recep');  select tests.new_user('staff_user');
select tests.new_user('other_owner');
select tests.new_user('moe', '96170111111');
update public.profiles set first_name = 'Nadia' where id = tests.id('owner');
select tests.new_business('biz', 'owner');
select tests.new_business('other', 'other_owner');
select tests.add_member('biz', 'recep', 'reception');
select tests.add_member('biz', 'staff_user', 'staff');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim', 'staff_user');
select tests.new_staff('biz', 'Maya');
select tests.new_staff('biz', 'Omar');
select tests.staff_every_day('biz', 'Karim', 540, 1140);
select tests.staff_every_day('biz', 'Maya', 540, 1140);
select tests.staff_every_day('biz', 'Omar', 540, 1140);
select tests.new_service('biz', 'Cut');
select tests.new_service('biz', 'Color', 'mens-haircut', 60, 90);
select tests.link('biz', 'Karim', 'Cut');  select tests.link('biz', 'Maya', 'Cut');  select tests.link('biz', 'Omar', 'Color');

select tests.customer_record('mohammad', 'biz', 'Mohammad Haddad', '+96170111111', 'moe');
select tests.customer_record('lina', 'biz', 'Lina Khoury', '+96103123456');
select tests.customer_record('stranger', 'other', 'Someone Else', '+96171999999');
select tests.visit('m1', 'biz', 'Maya', 'Cut', 'mohammad', tests.at(tests.day(-5), '10:00'));
select tests.visit('k_up', 'biz', 'Karim', 'Cut', 'lina', tests.at(tests.day(1), '10:00'), 'confirmed');
select tests.visit('m_up', 'biz', 'Maya', 'Cut', 'mohammad', tests.at(tests.day(1), '11:00'), 'confirmed');
select tests.visit('m_cx', 'biz', 'Maya', 'Cut', 'mohammad', tests.at(tests.day(1), '15:00'), 'confirmed');
update public.bookings set status = 'cancelled', cancelled_by_kind = 'business', cancel_reason = 'Closed'
 where id = tests.id('m_cx');
update public.booking_items set selection_mode = 'specific', requested_staff_id = tests.id('Maya')
 where booking_id = tests.id('m_up');
insert into public.customer_notes (business_id, business_customer_id, author_user_id, body, is_pinned)
values (tests.id('biz'), tests.id('lina'), tests.id('owner'), 'Allergic to ammonia dyes', true);
insert into public.staff_time_off (staff_id, business_id, period, kind, reason, created_by)
values (tests.id('Karim'), tests.id('biz'), tstzrange(tests.at(tests.day(1), '14:00'), tests.at(tests.day(1), '15:00')),
        'personal', 'Dentist', tests.id('owner'));
select private.recompute_business_customer_stats(tests.id('mohammad'));
select private.recompute_business_customer_stats(tests.id('lina'));

create function tests.cal(p_staff uuid[] default null, p_cancelled boolean default false, p_days int default 0)
returns jsonb language sql as $$
  select public.biz_get_calendar(tests.id('biz_loc'), tests.day(1), tests.day(1 + p_days), p_staff, p_cancelled)
$$;
create function tests.item(p_cal jsonb, p_booking text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p_cal -> 'items') e where e ->> 'booking_id' = tests.id(p_booking)::text
$$;
grant execute on all functions in schema tests to authenticated;

-- ═══ B3 calendar: scope and projection ═══
select tests.act_as('owner');
select is(jsonb_array_length(tests.cal() -> 'staff'), 3, 'owner: every active staff column');
select is(jsonb_array_length(tests.cal() -> 'items'), 2, 'cancelled bookings hidden by default');
select is(jsonb_array_length(tests.cal(null, true) -> 'items'), 3, '"Show cancelled" includes them');
select is((select jsonb_agg(s ->> 'display_name') from jsonb_array_elements(tests.cal(array[tests.id('Maya')]) -> 'staff') s),
          '["Maya"]'::jsonb, 'selected staff only');
select is((tests.cal() #>> '{staff,0,time_off,0,reason}'), 'Dentist', 'owner sees the time-off reason');
select is(((tests.cal() #>> '{staff,0,working,0,0}'))::timestamptz, tests.at(tests.day(1), '09:00'), 'working time per staff (Beirut hours)');
select is(tests.item(tests.cal(), 'k_up') #>> '{customer,pinned_note}', 'Allergic to ammonia dyes', 'pinned note on the block');
select ok((tests.item(tests.cal(), 'm_up') ->> 'requested')::boolean, '"★ Requested" when the customer chose that person');
select ok(not (tests.item(tests.cal(), 'k_up') ->> 'requested')::boolean, 'not requested for a business-assigned booking');
select is(tests.item(tests.cal(), 'm_up') #>> '{customer,reliability}', 'new_customer', 'coarse reliability label only');

select tests.act_as('recep');
select ok((tests.cal() #> '{staff,0,time_off,0}') ? 'kind' and (tests.cal() #>> '{staff,0,time_off,0,reason}') is null,
  'reception sees time off without the reason');
select results_eq($$ select tests.item(tests.cal(), 'k_up') #>> '{customer,phone}', tests.item(tests.cal(), 'k_up') ->> 'price_min' $$,
                  $$ values ('+96103123456', '20.00') $$, 'reception: phone and price');

select tests.act_as('staff_user');
select is((select jsonb_agg(s ->> 'display_name') from jsonb_array_elements(tests.cal(array[tests.id('Maya')]) -> 'staff') s),
          '["Karim"]'::jsonb, 'staff: only their own column, whatever scope is asked for');
select is((select jsonb_agg(e ->> 'booking_id') from jsonb_array_elements(tests.cal() -> 'items') e),
          jsonb_build_array(tests.id('k_up')), 'staff: only their own bookings');
select results_eq($$ select tests.item(tests.cal(), 'k_up') #>> '{customer,phone}', tests.item(tests.cal(), 'k_up') ->> 'price_min',
                            tests.item(tests.cal(), 'k_up') #>> '{customer,pinned_note}' $$,
                  $$ values (null::text, null::text, null::text) $$, 'staff: no phone, price or staff-hidden note');
select is((tests.cal() #>> '{staff,0,time_off,0,reason}'), 'Dentist', 'staff sees the reason on their own time off');
select tests.as_postgres();
update public.business_settings set staff_see_customer_phone = true where business_id = tests.id('biz');
select tests.act_as('staff_user');
select is(tests.item(tests.cal(), 'k_up') #>> '{customer,phone}', '+96103123456', 'staff sees phones when the business allows it');

select tests.act_as('other_owner');
select throws_ok($$ select tests.cal() $$, 'P0001', 'FORBIDDEN', 'another business is refused');
select tests.act_as('owner');
select throws_ok($$ select tests.cal(null, false, 60) $$, 'P0001', 'INVALID_RANGE', 'range capped at 6 weeks');

-- ═══ block time ═══
select tests.act_as('recep');
insert into tests.v values ('block', to_jsonb(public.biz_block_time(tests.id('Maya'), tests.at(tests.day(2), '12:00'),
                                                                  tests.at(tests.day(2), '13:00'), 'training')));
select ok(not exists (select 1 from public.biz_get_available_slots(tests.id('biz_loc'), tests.id('Cut'), tests.id('Maya'), tests.day(2))
                      where slot_start in (tests.at(tests.day(2), '12:00'), tests.at(tests.day(2), '12:30'))),
  'blocked time is not bookable');
select tests.act_as('staff_user');
select throws_ok($$ select public.biz_block_time(tests.id('Maya'), now() + interval '1 day', now() + interval '25 hours') $$,
  'P0001', 'FORBIDDEN', 'staff cannot block a colleague''s time');
select lives_ok($$ select public.biz_block_time(tests.id('Karim'), tests.at(tests.day(3), '16:00'), tests.at(tests.day(3), '17:00'), 'personal') $$,
  'staff block their own time');
select throws_ok($$ select public.biz_block_time(tests.id('Karim'), now() + interval '2 hours', now() + interval '1 hour') $$,
  'P0001', 'INVALID_RANGE', 'end after start');
select tests.act_as('recep');
select lives_ok($$ select public.biz_remove_block((select (j #>> '{}')::uuid from tests.v where k = 'block')) $$, 'reception removes a block');
select tests.as_postgres();
select is((select count(*)::int from public.staff_time_off where id = (select (j #>> '{}')::uuid from tests.v where k = 'block')), 0, 'block removed');

-- ═══ affected bookings + reassign options ═══
select tests.act_as('owner');
select is(jsonb_array_length(public.biz_affected_bookings(tests.id('Karim'))), 1, 'Karim''s upcoming bookings');
select is(jsonb_array_length(public.biz_affected_bookings(tests.id('Karim'), tests.at(tests.day(1), '12:00'), tests.at(tests.day(1), '18:00'))),
  0, 'only the bookings inside the window');
select results_eq($$ select display_name, is_free, in_hours from public.biz_reassign_options(
                       (select id from public.booking_items where booking_id = tests.id('k_up'))) $$,
                  $$ values ('Maya', true, true) $$, 'who can take it: performs the service, free, in hours (Omar doesn''t do cuts)');
select tests.as_postgres();
select tests.visit('m_busy', 'biz', 'Maya', 'Cut', 'lina', tests.at(tests.day(1), '10:00'), 'confirmed');
select tests.act_as('owner');
select is((select is_free from public.biz_reassign_options((select id from public.booking_items where booking_id = tests.id('k_up')))),
  false, 'a busy colleague is marked busy');
select tests.act_as('staff_user');
select throws_ok($$ select * from public.biz_reassign_options((select id from public.booking_items where booking_id = tests.id('k_up'))) $$,
  'P0001', 'FORBIDDEN', 'staff cannot reassign');
select throws_ok($$ select public.biz_affected_bookings(tests.id('Karim')) $$, 'P0001', 'FORBIDDEN', 'staff cannot list affected bookings');

-- ═══ B5 bookings list ═══
select tests.act_as('owner');
select is((public.biz_list_bookings(tests.id('biz'), 'upcoming') ->> 'total')::int, 3, 'upcoming');
select is((public.biz_list_bookings(tests.id('biz'), 'cancelled') #>> '{rows,0,booking_id}')::uuid, tests.id('m_cx'), 'cancelled tab');
select is((public.biz_list_bookings(tests.id('biz'), 'past') #>> '{rows,0,booking_id}')::uuid, tests.id('m1'), 'past tab');
select is((public.biz_list_bookings(tests.id('biz'), 'all', p_q => 'lina') ->> 'total')::int, 2, 'search by customer name');
select is((public.biz_list_bookings(tests.id('biz'), 'all', p_q => (select lower(ref) from public.bookings where id = tests.id('k_up'))) ->> 'total')::int,
  1, 'search by booking reference');
select is((public.biz_list_bookings(tests.id('biz'), 'all', p_staff_id => tests.id('Maya')) ->> 'total')::int, 4, 'staff filter (booking history)');
select tests.act_as('staff_user');
select is((public.biz_list_bookings(tests.id('biz'), 'all', p_staff_id => tests.id('Maya')) ->> 'total')::int, 1,
  'staff: only their own bookings, whatever filter is asked for');

-- ═══ booking drawer timeline ═══
select tests.act_as('recep');
select lives_ok($$ select public.biz_reschedule_booking(tests.id('k_up'), tests.at(tests.day(1), '12:00'), null, false) $$, 'reception moves a booking');
select tests.act_as('owner');
select results_eq($$ select e ->> 'event', e ->> 'actor_name' from jsonb_array_elements(public.biz_get_booking(tests.id('k_up')) -> 'events') e $$,
                  $$ values ('rescheduled', 'Team member') $$, 'timeline shows who did it (reception has no name yet)');
select tests.act_as('staff_user');
select throws_ok($$ select public.biz_get_booking(tests.id('m_up')) $$, 'P0001', 'FORBIDDEN', 'staff cannot open a colleague''s booking');

-- ═══ B7 customer detail ═══
select tests.act_as('owner');
select results_eq($$ select (c #>> '{stats,visits}')::int, (c #>> '{stats,lifetime_spend}')::numeric, c #>> '{stats,preferred_staff}',
                            jsonb_array_length(c -> 'upcoming'), jsonb_array_length(c -> 'history'), (c #>> '{stats,cancellations}')::int
                     from public.biz_get_customer(tests.id('biz'), tests.id('mohammad')) c $$,
                  $$ values (1, 20.00::numeric, 'Maya', 1, 2, 0) $$,
  'stats, upcoming and history; a business-side cancellation doesn''t count against the customer');
select tests.act_as('recep');
select is(public.biz_get_customer(tests.id('biz'), tests.id('mohammad')) #>> '{stats,lifetime_spend}', null, 'reception: no spend by default');
select tests.act_as('staff_user');
select results_eq($$ select c -> 'stats', jsonb_array_length(c -> 'history'), jsonb_array_length(c -> 'notes')
                     from public.biz_get_customer(tests.id('biz'), tests.id('lina')) c $$,
                  $$ values ('null'::jsonb, 0, 0) $$, 'staff: name + upcoming only; notes not marked for staff are hidden');
select throws_ok($$ select public.biz_get_customer(tests.id('biz'), tests.id('mohammad')) $$, 'P0001', 'NOT_FOUND',
  'staff: a customer with no upcoming booking with them doesn''t exist for them');
select tests.act_as('owner');
select throws_ok($$ select public.biz_get_customer(tests.id('biz'), tests.id('stranger')) $$, 'P0001', 'NOT_FOUND',
  'another business''s customer: NOT_FOUND, never FORBIDDEN');

-- ═══ B4 helpers: smart field, undo ═══
select tests.act_as('recep');
select results_eq($$ select display_name, preferred_staff_name from public.biz_find_customers(tests.id('biz'), '70 111') $$,
                  $$ values ('Mohammad Haddad', 'Maya') $$, 'smart field by phone, with the usual staff member');
insert into tests.v values ('manual', to_jsonb((public.create_manual_booking(tests.id('biz_loc'), '{"phone":"76 123 456","name":"Walk"}',
  tests.id('Cut'), tests.id('Karim'), tests.at(tests.day(3), '10:00'))).id));
select tests.act_as('owner');
select throws_ok($$ select public.biz_undo_manual_booking((select (j #>> '{}')::uuid from tests.v where k = 'manual')) $$,
  'P0001', 'FORBIDDEN', 'only the person who saved it can undo');
select tests.act_as('recep');
select lives_ok($$ select public.biz_undo_manual_booking((select (j #>> '{}')::uuid from tests.v where k = 'manual')) $$, 'undo right after saving');
select tests.as_postgres();
select results_eq($$ select b.status::text, bc.cancel_count from public.bookings b join public.business_customers bc on bc.id = b.business_customer_id
                     where b.id = (select (j #>> '{}')::uuid from tests.v where k = 'manual') $$,
                  $$ values ('cancelled', 0) $$, 'undone: time released, not counted as the customer''s cancellation');

-- ═══ B2 today + Realtime ═══
select tests.act_as('staff_user');
select ok(public.biz_today(tests.id('biz')) -> 'expected_revenue' = 'null'::jsonb, 'staff: "My day" without revenue');
select tests.as_postgres();
select ok(not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
          or exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'booking_items'),
  'booking_items is published to Realtime');

select * from finish();
rollback;
