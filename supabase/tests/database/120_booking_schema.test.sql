-- Phase 3 Part 3 §1, Part 7 §2 #11, §5 #27 — booking constraints, concurrency constraint, status guard
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(19);

select tests.new_user('owner_a');
select tests.new_business('biz_a', 'owner_a');
select tests.new_staff('biz_a', 'Karim');
select tests.new_staff('biz_a', 'Joe');
select tests.new_service('biz_a', 'Haircut');

-- ─── THE exclusion constraint ───
select lives_ok($$ select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(3), '10:00')) $$, 'first booking');
select throws_ok($$ select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(3), '10:15')) $$,
  '23P01', null, 'overlapping booking for the same staff member is rejected');
select lives_ok($$ select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(3), '10:30')) $$,
  'back-to-back booking allowed (half-open ranges)');
select lives_ok($$ select tests.raw_booking('biz_a', 'Joe', 'Haircut', tests.at(tests.day(3), '10:15')) $$,
  'another staff member at the same time is fine');
select throws_ok($$ select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(3), '10:15'), 30, 'held') $$,
  '23P01', null, 'a hold is blocked by a confirmed booking too');

-- cancelled / no-show release the time
select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(4), '10:00'));
update public.bookings set status = 'cancelled', cancelled_by_kind = 'business'
 where id = (select booking_id from public.booking_items where staff_id = tests.id('Karim')
             and starts_at = tests.at(tests.day(4), '10:00'));
select lives_ok($$ select tests.raw_booking('biz_a', 'Karim', 'Haircut', tests.at(tests.day(4), '10:00')) $$,
  'a cancelled booking no longer blocks its slot');

-- buffers are part of the occupied range
select tests.raw_booking('biz_a', 'Joe', 'Haircut', tests.at(tests.day(5), '10:00'), 30, 'confirmed', 15);
select throws_ok($$ select tests.raw_booking('biz_a', 'Joe', 'Haircut', tests.at(tests.day(5), '10:40')) $$,
  '23P01', null, 'the buffer after a booking is protected');

-- ─── row-level checks ───
select throws_ok($$ update public.booking_items set occupied = tstzrange(starts_at, ends_at + interval '1 hour')
                    where staff_id = tests.id('Karim') and starts_at = tests.at(tests.day(3), '10:00') $$,
  '23514', null, 'occupied must equal start/end plus buffers');
select throws_ok($$ update public.booking_items set selection_mode = 'specific'
                    where staff_id = tests.id('Karim') and starts_at = tests.at(tests.day(3), '10:00') $$,
  '23514', null, 'specific selection requires requested_staff_id');
select throws_ok($$ update public.booking_items set selection_mode = 'any'
                    where staff_id = tests.id('Karim') and starts_at = tests.at(tests.day(3), '10:00') $$,
  '23514', null, 'any selection requires the assignment rule used');

-- review requirement: a pending request can never outlive the appointment start
select throws_ok($$ insert into public.bookings (business_id, location_id, business_customer_id, status, source, starts_at, ends_at, created_by_kind, expires_at)
                    select tests.id('biz_a'), tests.id('biz_a_loc'), id, 'pending', 'business_link',
                           tests.at(tests.day(6), '10:00'), tests.at(tests.day(6), '10:30'), 'customer', tests.at(tests.day(6), '10:01')
                    from public.business_customers limit 1 $$,
  '23514', null, 'pending expiry after the start time is rejected');
select throws_ok($$ insert into public.bookings (business_id, location_id, business_customer_id, status, source, starts_at, ends_at, created_by_kind, expires_at)
                    select tests.id('biz_a'), tests.id('biz_a_loc'), id, 'held', 'business_link',
                           tests.at(tests.day(6), '10:00'), tests.at(tests.day(6), '10:30'), 'customer', now()
                    from public.business_customers limit 1 $$,
  '23514', null, 'a hold needs its token hash');

-- ─── status guard (safety net for every caller) ───
select throws_ok($$ update public.bookings set status = 'held' where status = 'confirmed' $$,
  'P0001', 'TRANSITION_NOT_ALLOWED', 'confirmed → held is impossible even for the owner role');
select throws_ok($$ update public.bookings set status = 'confirmed', cancelled_at = null, cancelled_by_kind = null where status = 'cancelled' $$,
  'P0001', 'TRANSITION_NOT_ALLOWED', 'a cancelled booking cannot be revived');
update public.bookings set status = 'completed'
 where id = (select booking_id from public.booking_items where staff_id = tests.id('Joe') and starts_at = tests.at(tests.day(5), '10:00'));
select isnt((select completed_at from public.bookings
             where id = (select booking_id from public.booking_items where staff_id = tests.id('Joe') and starts_at = tests.at(tests.day(5), '10:00'))),
  null, 'status guard fills completed_at');

-- ─── immutability / attribution ───
select throws_ok($$ update public.bookings set source = 'marketplace_search' where source = 'manual' $$,
  'P0001', 'IMMUTABLE_FIELD', 'booking source cannot change');
insert into public.booking_events (booking_id, business_id, event, actor_kind)
select id, business_id, 'note_changed', 'business' from public.bookings limit 1;
select throws_ok($$ delete from public.booking_events $$, 'P0001', null, 'booking events cannot be deleted');

-- ─── booking reference ───
select ok((select bool_and(ref ~ '^[0-9A-HJKMNP-TV-Z]{8}$') from public.bookings), 'refs are 8-char Crockford base32');

-- ─── audit composite key (M2 limitation fixed) ───
insert into public.staff_services (staff_id, service_id, business_id) values (tests.id('Karim'), tests.id('Haircut'), tests.id('biz_a'));
update public.staff_services set duration_min_override = 40 where staff_id = tests.id('Karim') and service_id = tests.id('Haircut');
select is((select changed -> '_key' ->> 'service_id' from audit.entity_changes
           where table_name = 'public.staff_services' and op = 'UPDATE' order by id desc limit 1),
  tests.id('Haircut')::text, 'staff_services UPDATE audit carries the full composite key');

select * from finish();
rollback;
