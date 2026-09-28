-- M6 · Gate B booking-creation timing: creator-only logging, server-stamped times, no customer
--      data, ops-only report
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(11);

create table tests.v (k text primary key, j jsonb);
grant select, insert on tests.v to authenticated;

select tests.new_user('owner');  select tests.new_user('recep');  select tests.new_user('ops');
select tests.new_business('biz', 'owner');
select tests.add_member('biz', 'recep', 'reception');
insert into public.admin_users (user_id, role) values (tests.id('ops'), 'ops');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim');
select tests.staff_every_day('biz', 'Karim', 0, 1440);
select tests.new_service('biz', 'Cut');
select tests.link('biz', 'Karim', 'Cut');
select tests.customer_record('lina', 'biz', 'Lina Khoury', '+96103123456');
select tests.visit('online', 'biz', 'Karim', 'Cut', 'lina', tests.at(tests.day(2), '09:00'), 'confirmed');

create function tests.bk() returns uuid language sql as $$ select (j #>> '{}')::uuid from tests.v where k = 'b' $$;
grant execute on function tests.bk() to authenticated;

select tests.act_as('recep');
insert into tests.v values ('b', to_jsonb((public.create_manual_booking(tests.id('biz_loc'),
  jsonb_build_object('business_customer_id', tests.id('lina')), tests.id('Cut'), tests.id('Karim'),
  tests.at(tests.day(1), '10:00'))).id));

select lives_ok($$ select public.biz_log_booking_timing(tests.bk(), 8400, 'existing', 'slot') $$, 'the creator logs the timing');
select lives_ok($$ select public.biz_log_booking_timing(tests.bk(), 99999, 'new', 'button') $$, 'a retry is harmless');
select throws_ok($$ select public.biz_log_booking_timing(tests.bk(), 5000, 'vip', 'slot') $$, 'P0001', 'INVALID_INPUT', 'only known kinds');
select throws_ok($$ select * from private.booking_creation_timings $$, '42501', null, 'members cannot read the raw table');
select tests.act_as('owner');
select throws_ok($$ select public.biz_log_booking_timing(tests.bk(), 5000, 'existing', 'slot') $$, 'P0001', 'FORBIDDEN',
  'only the person who saved it');
select throws_ok($$ select public.biz_log_booking_timing(tests.id('online'), 5000, 'existing', 'slot') $$, 'P0001', 'FORBIDDEN',
  'not for bookings someone else created (online / other users)');

select tests.as_postgres();
select results_eq(
  $$ select actor_role::text, customer_kind, flow, source::text, duration_ms,
            saved_at = (select created_at from public.bookings where id = tests.bk()),
            saved_at - opened_at = interval '8.4 seconds'
     from private.booking_creation_timings where booking_id = tests.bk() $$,
  $$ values ('reception', 'existing', 'slot', 'manual', 8400, true, true) $$,
  'first report kept; saved_at from the booking, opened_at derived from the device duration');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
           where table_schema = 'private' and table_name = 'booking_creation_timings'),
          array['booking_id', 'business_id', 'actor_role', 'customer_kind', 'flow', 'source',
                'opened_at', 'saved_at', 'duration_ms', 'created_at'],
  'operational fields only: no customer name, phone, notes or free text');

select tests.act_as('owner');
select throws_ok($$ select * from public.admin_booking_timing_stats() $$, 'P0001', 'FORBIDDEN', 'the report is for APP_NAME ops');
select tests.act_as('ops', 'aal2');
select results_eq($$ select bookings, median_seconds from public.admin_booking_timing_stats(p_business_id => tests.id('biz'))
                     where actor_role is null $$,
                  $$ values (1, 8.4::numeric) $$, 'ops: median per business (Gate B: < 15 s)');
select results_eq($$ select actor_role::text, customer_kind from public.admin_booking_timing_stats(p_business_id => tests.id('biz'))
                     where actor_role is not null $$,
                  $$ values ('reception', 'existing') $$, 'split by role and customer kind');
select tests.as_postgres();

select * from finish();
rollback;
