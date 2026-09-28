-- Phase 3 Part 6 §3.4, Part 7 §8 #46, #48–49 — who can read bookings, items and events
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(11);

select tests.new_user('owner_a'); select tests.new_user('recep_a'); select tests.new_user('karim_user');
select tests.new_user('owner_b'); select tests.new_user('moe', '96170111111');
select tests.new_business('biz_a', 'owner_a'); select tests.new_business('biz_b', 'owner_b');
select tests.add_member('biz_a', 'recep_a', 'reception');
select tests.add_member('biz_a', 'karim_user', 'staff');
select tests.new_staff('biz_a', 'Karim', 'karim_user');
select tests.new_staff('biz_a', 'Joe');
select tests.new_service('biz_a', 'Haircut');

insert into tests.ids select 'b_karim', tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(3), '10:00'));
insert into tests.ids select 'b_joe',   tests.raw_booking('biz_a', 'Joe',   'Haircut', tests.at(tests.day(3), '10:00'));
update public.bookings set customer_user_id = tests.id('moe') where id = tests.id('b_karim');
select private.log_booking_event(tests.id('b_karim'), 'note_changed', 'business', 'confirmed', 'confirmed');
select private.log_booking_event(tests.id('b_joe'),   'note_changed', 'business', 'confirmed', 'confirmed');

select tests.act_as('recep_a');
select is((select count(*)::int from public.bookings), 2, 'reception sees all bookings of the business');
select is((select count(*)::int from public.booking_events), 2, 'reception sees their events');
select throws_ok($$ update public.bookings set internal_note = 'x' $$, '42501', null, 'no direct writes, even for reception');
select tests.as_postgres();

select tests.act_as('karim_user');
select results_eq($$ select id from public.bookings $$, $$ values (tests.id('b_karim')) $$, 'staff see only bookings they serve');
select is((select count(*)::int from public.booking_items), 1, 'staff see only their own items');
select is((select count(*)::int from public.booking_events), 1, 'staff see only events of their bookings');
select tests.as_postgres();

select tests.act_as('owner_b');
select is((select count(*)::int from public.bookings) + (select count(*)::int from public.booking_items), 0,
  'another business sees nothing');
select tests.as_postgres();

select tests.act_as('moe');
select is((select count(*)::int from public.bookings), 0, 'customers read their bookings through RPCs, not the table');
select throws_ok($$ insert into public.bookings (business_id, location_id, status, source, starts_at, ends_at, created_by_kind)
                    values (tests.id('biz_a'), tests.id('biz_a_loc'), 'confirmed', 'business_link', now(), now() + interval '1 hour', 'customer') $$,
  '42501', null, 'customers cannot insert bookings directly');
select tests.as_postgres();

select tests.as_anon();
select throws_ok($$ select * from public.bookings $$, '42501', null, 'anon cannot read bookings');
select throws_ok($$ select public.create_hold(tests.id('biz_a_loc'), tests.id('Haircut'), now()) $$, '42501', null,
  'anon (no session) cannot create holds; visitors use anonymous auth');
select tests.as_postgres();

select * from finish();
rollback;
