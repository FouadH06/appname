-- M14 · analytics rollups + B11 RPC (role-aware, live today, idempotent rebuild), system health for ops,
--       uptime ping, schedules.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(25);

select tests.new_user('owner', '96170330100');
select tests.new_user('mgr', '96170330101');
select tests.new_user('recep', '96170330102');
select tests.new_user('stf', '96170330103');
select tests.new_user('outsider', '96170330104');
select tests.new_user('ops');
select tests.new_user('mod');
insert into public.admin_users (user_id, role) values (tests.id('ops'), 'ops'), (tests.id('mod'), 'moderator');
select tests.new_business('biz', 'owner');
select tests.add_member('biz', 'mgr', 'manager');
select tests.add_member('biz', 'recep', 'reception');
select tests.add_member('biz', 'stf', 'staff');
select tests.open_every_day('biz');                                  -- 09:00–19:00
select tests.new_staff('biz', 'Karim Haddad');
select tests.new_staff('biz', 'Maya Test');
select tests.staff_every_day('biz', 'Karim Haddad', 540, 1140);
select tests.staff_every_day('biz', 'Maya Test', 540, 1140);
update public.staff_weekly_hours set effective_from = current_date - 60 where business_id = tests.id('biz');
select tests.new_service('biz', 'Cut');
select tests.new_service('biz', 'Beard', 'beard-trim');
select tests.link('biz', 'Karim Haddad', 'Cut');
select tests.link('biz', 'Maya Test', 'Cut');
select tests.customer_record('r1', 'biz', 'Rana', '+96170330001');
select tests.customer_record('r2', 'biz', 'Sami', '+96170330002');
select tests.visit('v1', 'biz', 'Karim Haddad', 'Cut', 'r1', tests.at(tests.day(-3), '10:00'));                  -- r1's first
select tests.visit('v2', 'biz', 'Karim Haddad', 'Cut', 'r1', tests.at(tests.day(-2), '11:00'));                  -- returning
select tests.visit('v3', 'biz', 'Maya Test', 'Cut', 'r2', tests.at(tests.day(-2), '12:00'), 'no_show');
select tests.visit('v4', 'biz', 'Karim Haddad', 'Cut', 'r2', tests.at(tests.day(-2), '15:00'), 'confirmed');
update public.bookings set status = 'cancelled', cancelled_by_kind = 'customer', is_late_cancel = true, cancelled_at = now()
 where id = tests.id('v4');
select tests.visit('v5', 'biz', 'Maya Test', 'Cut', 'r2', tests.at(tests.day(0), '18:00'), 'confirmed');          -- today, live

-- ═══ rollups ═══
select private.refresh_daily_metrics(tests.day(-7), tests.day(-1));
create temp table m on commit drop as
  select * from public.business_daily_metrics where business_id = tests.id('biz') and day = tests.day(-2);
select results_eq($$ select bookings_completed, no_shows, cancellations_customer, late_cancels, revenue_min::int, booked_minutes from m $$,
                  $$ values (1, 1, 1, 1, 20, 30) $$,
                  'day rollup: completed, no-show, late customer cancel, revenue, booked minutes (completed only)');
select results_eq($$ select new_customers, returning_customers from m $$, $$ values (0, 1) $$,
                  'returning customer on their second visit');
select is((select new_customers from public.business_daily_metrics where business_id = tests.id('biz') and day = tests.day(-3)), 1,
          'first completed visit counts as a new customer');
select is((select available_minutes from m), 1200, 'available minutes = both staff''s working time (2 × 10 h)');
select is((select src_manual from m), 1, 'source mix: manual');
select results_eq($$ select bookings_completed, no_shows, booked_minutes, available_minutes from public.staff_daily_metrics
                     where staff_id = tests.id('Karim Haddad') and day = tests.day(-2) $$,
                  $$ values (1, 0, 30, 600) $$, 'staff rollup: Karim');
select is((select count(*)::int from public.business_daily_metrics where business_id = tests.id('biz')), 7, 'one row per location and day');
select private.refresh_daily_metrics(tests.day(-7), tests.day(-1));
select is((select count(*)::int from public.business_daily_metrics where business_id = tests.id('biz')), 7, 'rebuild is idempotent');

-- ═══ biz_get_analytics ═══
create temp table a (who text, j jsonb) on commit drop;
grant all on a to authenticated;
select tests.act_as('owner');
insert into a select 'owner', public.biz_get_analytics(tests.id('biz'), tests.day(-6), tests.day(0));
select tests.act_as('recep');
insert into a select 'recep', public.biz_get_analytics(tests.id('biz'), tests.day(-6), tests.day(0));
select tests.as_postgres();
select results_eq($$ select (j -> 'kpis' -> 'cur' ->> 'completed')::int, (j -> 'kpis' -> 'cur' ->> 'revenue_min')::numeric::int,
                            (j -> 'kpis' -> 'cur' ->> 'customers')::int, (j -> 'kpis' -> 'cur' ->> 'new_customers')::int
                     from a where who = 'owner' $$,
                  $$ values (2, 40, 1, 1) $$, 'owner: completed, revenue, unique customers, new');
select is((select (j -> 'kpis' -> 'cur' ->> 'no_show_rate')::numeric from a where who = 'owner'), 0.333, 'no-show rate = no-shows / (completed + no-shows)');
select is((select (j -> 'kpis' -> 'cur' ->> 'created')::int from a where who = 'owner'), 5,
          'today is computed live (every fixture booking was created today)');
select is((select jsonb_array_length(j -> 'series') from a where who = 'owner'), 7, 'daily series for the period');
select is((select j -> 'services' -> 0 ->> 'name' from a where who = 'owner'), 'Cut', 'top services');
select is((select (j -> 'kpis' -> 'prev' ->> 'completed')::int from a where who = 'owner'), 0, 'previous period for comparison');
select results_eq($$ select (j ->> 'show_revenue')::boolean, j -> 'kpis' -> 'cur' -> 'revenue_min', j -> 'staff' -> 0 -> 'revenue' from a where who = 'recep' $$,
                  $$ values (false, 'null'::jsonb, 'null'::jsonb) $$, 'reception sees counts, never revenue');
select tests.act_as('stf');
select throws_ok($$ select public.biz_get_analytics(tests.id('biz'), tests.day(-6), tests.day(0)) $$, 'P0001', 'FORBIDDEN', 'staff role has no analytics');
select tests.act_as('outsider');
select throws_ok($$ select public.biz_get_analytics(tests.id('biz'), tests.day(-6), tests.day(0)) $$, 'P0001', 'FORBIDDEN', 'another account: forbidden');
select tests.act_as('owner');
select throws_ok($$ select public.biz_get_analytics(tests.id('biz'), tests.day(0), tests.day(-6)) $$, 'P0001', 'INVALID_INPUT', 'period checked');
select throws_ok($$ select * from public.business_daily_metrics $$, '42501', null, 'rollup tables are RPC-only');

-- ═══ schedules, system health, ping ═══
select tests.as_postgres();
select is((select count(*)::int from cron.job where jobname in ('app_daily_metrics', 'app_cron_health', 'app_cron_cleanup')), 3,
          'M14 jobs scheduled');
select results_eq($$ select private.cron_interval_minutes('* * * * *'), private.cron_interval_minutes('*/10 * * * *'),
                            private.cron_interval_minutes('45 1 * * *') $$,
                  $$ values (1, 10, 1440) $$, 'expected run interval from the schedule');
select tests.act_as('mod', 'aal2');
select throws_ok($$ select public.admin_system_health() $$, 'P0001', 'FORBIDDEN', 'moderators cannot see system health');
select tests.act_as('ops', 'aal2');
select ok(public.admin_system_health() -> 'alerts' ? 'no_health_snapshot', 'no snapshot yet → alert');
select tests.as_postgres();
insert into private.cron_health (jobname, schedule, active, last_run_at, last_status, captured_at) values
  ('app_notify_dispatch', '* * * * *', true, now() - interval '1 hour', 'succeeded', now()),
  ('app_nightly', '0 1 * * *', true, now() - interval '2 hours', 'failed', now());
select tests.act_as('ops', 'aal2');
select results_eq($$ select (j ->> 'stale')::boolean, (j ->> 'failing')::boolean
                     from jsonb_array_elements(public.admin_system_health() -> 'jobs') j order by j ->> 'job' $$,
                  $$ values (false, true), (true, false) $$,
                  'a daily job that failed is flagged; a per-minute job silent for an hour is stale');
select tests.as_anon();
select isnt(public.health_ping(), null, 'uptime ping works anonymously');

select * from finish();
rollback;
