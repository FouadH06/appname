-- Phase 3 Part 3 §4, Part 7 §5–6 — holds, confirm, manual bookings, requests, cancel, reschedule,
-- reassign, complete/no-show, access control
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(46);

-- ─── fixtures ───
select tests.new_user('owner_a');  select tests.new_user('recep_a');  select tests.new_user('staff_user');
select tests.new_user('owner_b');
select tests.new_user('moe', '96170111111');   select tests.new_user('rita', '96170222222');
select tests.new_user('sami', '96170333333');  select tests.new_user('nour', '96170444444');
select tests.new_user('lara', '96170555555');
select tests.new_user('visitor');                                          -- anonymous-auth visitor (no phone)
select tests.new_business('biz_a', 'owner_a');
select tests.new_business('biz_b', 'owner_b');
select tests.add_member('biz_a', 'recep_a', 'reception');
select tests.add_member('biz_a', 'staff_user', 'staff');
select tests.open_every_day('biz_a', 0, 1440);                             -- open all day (tests use any hour)
select tests.new_staff('biz_a', 'Karim', 'staff_user');
select tests.new_staff('biz_a', 'Maya', null, true, false);                -- senior: specific only
select tests.new_staff('biz_a', 'Owner Only', null, false, false);         -- internal-only
select tests.new_service('biz_a', 'Haircut');
select tests.link('biz_a', 'Karim', 'Haircut');
select tests.link('biz_a', 'Maya', 'Haircut');
select tests.link('biz_a', 'Owner Only', 'Haircut');
-- Karim and Maya work around the clock so time-relative tests don't depend on when they run;
-- "Owner Only" keeps 08:00–21:00 for the outside-hours checks.
select tests.staff_every_day('biz_a', 'Karim', 0, 1440);
select tests.staff_every_day('biz_a', 'Maya', 0, 1440);
select tests.staff_every_day('biz_a', 'Owner Only', 480, 1260);

create table tests.h (name text primary key, booking_id uuid, token text, staff_id uuid);
grant select, insert, update on tests.h to authenticated;
create function tests.hold(p_name text, p_start timestamptz, p_staff text default null,
                           p_mode public.staff_selection_mode default null) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.create_hold(tests.id('biz_a_loc'), tests.id('Haircut'), p_start,
                                          case when p_staff is not null then tests.id(p_staff) end, p_mode);
  insert into tests.h values (p_name, r.booking_id, r.hold_token, r.staff_id)
  on conflict (name) do update set booking_id = excluded.booking_id, token = excluded.token, staff_id = excluded.staff_id;
end $$;
grant execute on all functions in schema tests to authenticated;

-- ═══ holds ═══
select tests.act_as('visitor', 'aal1', true);                              -- anonymous-auth visitor holds a slot
select lives_ok($$ select tests.hold('v1', tests.at(tests.day(2), '10:00')) $$, 'anonymous visitor can hold a slot');
select is((select staff_id from tests.h where name = 'v1'), tests.id('Karim'),
  '"Any" assigns the eligible staff member (senior and internal-only are skipped)');
select lives_ok($$ select tests.hold('v2', tests.at(tests.day(2), '12:00')) $$, 'a second hold...');
select tests.as_postgres();
select is((select count(*)::int from public.bookings where status = 'held' and hold_owner_user_id = tests.id('visitor')), 1,
  '...replaces the first (one active hold per user)');
select tests.act_as('visitor', 'aal1', true);
select throws_ok($$ select tests.hold('v3', tests.at(tests.day(2), '10:07')) $$, 'P0001', 'INVALID_SLOT', 'off-grid time rejected');
select throws_ok($$ select tests.hold('v3', tests.at(tests.day(2), '10:00'), 'Owner Only') $$, 'P0001', 'NOT_BOOKABLE',
  'internal-only staff cannot be held online');
select throws_ok($$ select public.confirm_booking((select booking_id from tests.h where name = 'v2'), (select token from tests.h where name = 'v2')) $$,
  'P0001', 'PHONE_NOT_VERIFIED', 'an anonymous visitor cannot confirm');
select tests.as_postgres();

-- ═══ confirm ═══
select tests.act_as('moe');                                                -- the visitor signed in as Moe
select throws_ok($$ select public.confirm_booking((select booking_id from tests.h where name = 'v2'), 'wrong-token') $$,
  'P0001', 'HOLD_NOT_FOUND', 'a wrong hold token is rejected');
select lives_ok($$ select public.confirm_booking((select booking_id from tests.h where name = 'v2'), (select token from tests.h where name = 'v2'),
                                                 'Moe', null, null, 'idem-1') $$,
  'the hold token lets the signed-in customer confirm');
select is((select public.confirm_booking((select booking_id from tests.h where name = 'v2'), 'ignored', null, null, null, 'idem-1')).id,
          (select booking_id from tests.h where name = 'v2'), 'confirm is idempotent (same key → same booking)');
select tests.as_postgres();
select results_eq(
  $$ select b.status::text, b.customer_user_id, bc.acquired_via::text
     from public.bookings b join public.business_customers bc on bc.id = b.business_customer_id
     where b.id = (select booking_id from tests.h where name = 'v2') $$,
  $$ values ('confirmed', tests.id('moe'), 'business_link') $$,
  'confirmed, linked to Moe, attributed to the business link');
select ok(exists (select 1 from public.booking_events where booking_id = (select booking_id from tests.h where name = 'v2') and event = 'confirmed'),
  'confirmation event written');

-- the same time again: Karim is taken, Maya isn't eligible for "Any"
select tests.act_as('rita');
select throws_ok($$ select tests.hold('r1', tests.at(tests.day(2), '12:00')) $$, 'P0001', 'SLOT_TAKEN',
  'no eligible staff left for "Any"');
select lives_ok($$ select tests.hold('r1', tests.at(tests.day(2), '12:00'), 'Maya') $$, 'Maya can still be chosen specifically');
select lives_ok($$ select public.confirm_booking((select booking_id from tests.h where name = 'r1'), (select token from tests.h where name = 'r1')) $$,
  'Rita confirms with Maya');
-- change the assigned person on a hold (C10 "Change")
select lives_ok($$ select tests.hold('r2', tests.at(tests.day(2), '14:00')) $$, 'hold with Any (Karim)');
select is((select staff_id from public.change_hold_staff((select booking_id from tests.h where name = 'r2'),
                                                         (select token from tests.h where name = 'r2'), tests.id('Maya'))),
  tests.id('Maya'), 'hold moved to Maya at the same time');
select public.confirm_booking((select booking_id from tests.h where name = 'r2'), (select token from tests.h where name = 'r2'));
select tests.as_postgres();
select is((select selection_mode::text || ':' || requested_staff_id::text from public.booking_items
           where booking_id = (select booking_id from tests.h where name = 'r2')),
  'specific:' || tests.id('Maya')::text, 'the change is recorded as a specific choice');

-- ═══ request mode: expiry never beyond the start (review requirement) ═══
update public.business_settings set booking_mode = 'request' where business_id = tests.id('biz_a');
select tests.act_as('sami');
select tests.hold('s1', date_trunc('hour', now()) + interval '2 hours');   -- starts in ~1–2 h, before 4 h request expiry
select lives_ok($$ select public.confirm_booking((select booking_id from tests.h where name = 's1'), (select token from tests.h where name = 's1')) $$,
  'request confirmed');
select tests.as_postgres();
select results_eq(
  $$ select status::text, expires_at = starts_at from public.bookings where id = (select booking_id from tests.h where name = 's1') $$,
  $$ values ('pending', true) $$, 'pending request expires at the appointment start, not 4 h later');
select tests.act_as('recep_a');
select lives_ok($$ select public.accept_request((select booking_id from tests.h where name = 's1')) $$, 'reception accepts the request');
select tests.as_postgres();
update public.business_settings set booking_mode = 'instant' where business_id = tests.id('biz_a');

-- ═══ reliability gates ═══
insert into private.reliability_events (user_id, kind, weight, occurred_at)
select tests.id('nour'), 'no_show', 1.0, now() - interval '1 day' from generate_series(1, 3);
select private.recompute_reliability(tests.id('nour'));
select tests.act_as('nour');
select tests.hold('n1', tests.at(tests.day(3), '09:00'));
select is((select public.confirm_booking((select booking_id from tests.h where name = 'n1'), (select token from tests.h where name = 'n1'))).status::text,
  'pending', 'a "restricted" customer''s booking becomes a request even in instant mode');
select tests.as_postgres();
insert into private.reliability_events (user_id, kind, weight, occurred_at)
select tests.id('nour'), 'no_show', 1.0, now() from generate_series(1, 2);            -- score ≈ 4.97 → blocked
select private.recompute_reliability(tests.id('nour'));
select tests.act_as('nour');
select tests.hold('n2', tests.at(tests.day(3), '11:00'));
select throws_ok($$ select public.confirm_booking((select booking_id from tests.h where name = 'n2'), (select token from tests.h where name = 'n2')) $$,
  'P0001', 'CUSTOMER_BLOCKED', 'a "blocked" customer cannot book online');
select tests.as_postgres();

-- ═══ manual bookings ═══
select tests.act_as('recep_a');
select lives_ok($$ select public.create_manual_booking(tests.id('biz_a_loc'), '{"phone":"03 555 666","name":"Walk-in Ali"}',
                                                      tests.id('Haircut'), null, tests.at(tests.day(4), '10:00')) $$,
  'reception books a phone customer with "Any"');
select tests.as_postgres();
select results_eq(
  $$ select bc.user_id is null, bc.acquired_via::text, b.customer_user_id is null, bi.selection_mode::text
     from public.bookings b join public.business_customers bc on bc.id = b.business_customer_id
     join public.booking_items bi on bi.booking_id = b.id where bc.phone_e164 = '+9613555666' $$,
  $$ values (true, 'manual', true, 'any') $$,
  'shadow customer created (manual attribution); booking not linked to any account');
select tests.act_as('recep_a');
select lives_ok($$ select public.create_manual_booking(tests.id('biz_a_loc'), '{"phone":"03 555 666"}',
                                                      tests.id('Haircut'), tests.id('Owner Only'), tests.at(tests.day(4), '10:00')) $$,
  'internal-only staff can be booked from the dashboard');
select throws_ok($$ select public.create_manual_booking(tests.id('biz_a_loc'), '{"phone":"03 555 666"}',
                                                       tests.id('Haircut'), tests.id('Owner Only'), tests.at(tests.day(4), '06:00')) $$,
  'P0001', 'OUTSIDE_HOURS', 'outside the staff member''s hours needs an explicit override');
select lives_ok($$ select public.create_manual_booking(tests.id('biz_a_loc'), '{"phone":"03 555 666"}',
                                                      tests.id('Haircut'), tests.id('Owner Only'), tests.at(tests.day(4), '06:00'),
                                                      null, null, null, true, true) $$,
  '... which reception can give');
select tests.as_postgres();

-- claimed relationship → new manual bookings link to the account automatically
select tests.act_as('recep_a');
select lives_ok($$ select public.create_manual_booking(tests.id('biz_a_loc'), '{"phone":"+96170111111"}',
                                                      tests.id('Haircut'), tests.id('Karim'), tests.at(tests.day(5), '10:00')) $$,
  'manual booking for Moe''s phone');
select tests.as_postgres();
select is((select customer_user_id from public.bookings where starts_at = tests.at(tests.day(5), '10:00')), tests.id('moe'),
  'Moe already has a record here (claimed relationship) → linked to his account');

-- an unclaimed shadow is never merged by an online booking; attribution is inherited
-- Lara has been a walk-in (shadow, entered by phone) but never booked online before
insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
values (tests.id('biz_a'), '+96170555555', 'Lara (walk-in)', 'manual');
select tests.act_as('lara');
select tests.hold('l1', tests.at(tests.day(5), '12:00'));
select public.confirm_booking((select booking_id from tests.h where name = 'l1'), (select token from tests.h where name = 'l1'));
select tests.as_postgres();
select results_eq(
  $$ select count(*)::int, count(*) filter (where user_id is null)::int, bool_and(acquired_via = 'manual')
     from public.business_customers where business_id = tests.id('biz_a') and phone_e164 = '+96170555555' $$,
  $$ values (2, 1, true) $$,
  'shadow left untouched; Lara''s new record inherits "manual" (no marketplace fee on an existing customer)');
select ok(exists (select 1 from private.possible_duplicates where business_id = tests.id('biz_a')),
  'the pair is flagged for a business-side merge');

-- ═══ reassign: a customer who chose someone is always notified ═══
select tests.act_as('recep_a');
select public.reassign_booking_item((select id from public.booking_items where booking_id = (select booking_id from tests.h where name = 'r1')),
                                    tests.id('Owner Only'), false);
select tests.as_postgres();
select is((select (data ->> 'notify')::boolean from public.booking_events
           where booking_id = (select booking_id from tests.h where name = 'r1') and event = 'staff_changed'),
  true, 'reassigning a specifically-chosen booking forces notification');

-- ═══ cancel ═══
select tests.act_as('recep_a');
insert into tests.h (name, booking_id)
select 'late', (public.create_manual_booking(tests.id('biz_a_loc'), '{"phone":"+96170111111"}', tests.id('Haircut'), tests.id('Maya'),
                                             date_trunc('hour', now()) + interval '2 hours')).id;
select tests.as_postgres();
select tests.act_as('moe');
select is((select is_late_cancel from public.cancel_my_booking((select booking_id from tests.h where name = 'late'))),
  true, 'cancelling inside the 2 h window is a late cancel');
select tests.as_postgres();
select ok(exists (select 1 from private.reliability_events where user_id = tests.id('moe') and kind = 'late_cancel'),
  'late cancel recorded for reliability');
select tests.act_as('recep_a');
select throws_ok($$ select public.biz_cancel_booking((select booking_id from tests.h where name = 'v2')) $$,
  'P0001', 'REASON_REQUIRED', 'cancelling a customer''s own booking needs a reason');
select tests.as_postgres();

-- ═══ reschedule (atomic; old slot freed) ═══
select tests.act_as('moe');
select lives_ok($$ select public.reschedule_my_booking((select booking_id from tests.h where name = 'v2'), tests.at(tests.day(6), '15:00')) $$,
  'customer reschedules');
select tests.as_postgres();
select tests.act_as('sami');
select lives_ok($$ select tests.hold('s2', tests.at(tests.day(2), '12:00')) $$, 'the old slot is free again');
select tests.as_postgres();
select tests.act_as('recep_a');
select throws_ok($$ select public.biz_reschedule_booking((select booking_id from tests.h where name = 'r2'), tests.at(tests.day(6), '15:00'), tests.id('Karim')) $$,
  'P0001', 'STAFF_NOT_FREE', 'moving onto a busy staff member is rejected');
select tests.as_postgres();

-- ═══ complete / no-show ═══
select tests.act_as('recep_a');
select throws_ok($$ select public.mark_completed((select booking_id from tests.h where name = 'r2')) $$,
  'P0001', 'OUTSIDE_WINDOW', 'cannot complete before the start');
select tests.as_postgres();
-- a booking that started 30 minutes ago (written directly), belonging to Moe, served by Karim
insert into tests.ids select 'past', tests.raw_booking('biz_a', 'Karim', 'Haircut', now() - interval '30 minutes');
update public.bookings set customer_user_id = tests.id('moe'),
       business_customer_id = (select id from public.business_customers where business_id = tests.id('biz_a') and user_id = tests.id('moe'))
 where id = tests.id('past');
select tests.act_as('staff_user');                                         -- Karim's own booking
select is((select status::text from public.mark_no_show(tests.id('past'))),
  'no_show', 'the staff member marks their own booking as a no-show');
select is((select status::text from public.undo_no_show(tests.id('past'))),
  'completed', '... and can correct it within 24 h');
select throws_ok($$ select public.mark_completed((select booking_id from tests.h where name = 'r1')) $$,
  'P0001', 'FORBIDDEN', 'staff cannot act on a colleague''s booking');
select tests.as_postgres();
select ok(exists (select 1 from private.reliability_events where user_id = tests.id('moe') and kind = 'forgiven'),
  'undo records an exact reversal for reliability');

-- ═══ access control ═══
select tests.act_as('owner_b');
select throws_ok($$ select public.mark_completed((select booking_id from tests.h where name = 'v2')) $$,
  'P0001', 'FORBIDDEN', 'another business''s owner cannot touch this booking');
select tests.as_postgres();
select tests.act_as('moe');
select throws_ok($$ select public.biz_cancel_booking((select booking_id from tests.h where name = 'v2'), 'x') $$,
  'P0001', 'FORBIDDEN', 'a customer cannot use business RPCs');
select tests.as_postgres();

select * from finish();
rollback;
