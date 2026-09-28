-- M5 · assisted onboarding, slugs, go-live checklist, publish, pause, staff archive, roles
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(36);

select tests.new_user('ops', '96170600600');
select tests.new_user('owner', '96170100100');
select tests.new_user('recep', '96170300300');
select tests.new_user('stranger');
insert into public.admin_users (user_id, role) values (tests.id('ops'), 'ops');

create table tests.v (k text primary key, j jsonb);
grant select, insert, update on tests.v to authenticated;
create function tests.hazmieh() returns uuid language sql stable as $$ select id from public.areas where slug = 'hazmieh' $$;
grant execute on all functions in schema tests to authenticated;

-- ═══ admin_create_business (ops, MFA) ═══
select tests.act_as('stranger');
select throws_ok($$ select public.admin_create_business('Fade', 'fade-district', 'barber', tests.hazmieh(), 'Main st', 33.85, 35.53) $$,
  'P0001', 'FORBIDDEN', 'non-admins cannot create businesses');
select tests.act_as('ops', 'aal1');
select throws_ok($$ select public.admin_create_business('Fade', 'fade-district', 'barber', tests.hazmieh(), 'Main st', 33.85, 35.53) $$,
  'P0001', 'FORBIDDEN', 'ops without MFA cannot either');
select tests.act_as('ops', 'aal2');
select throws_ok($$ select public.admin_create_business('Fade', 'fade-district', 'barber', tests.hazmieh(), 'Main st', 48.85, 2.35) $$,
  'P0001', 'PIN_OUTSIDE_LEBANON', 'a pin outside Lebanon is refused');
select throws_ok($$ select public.admin_create_business('Search', 'search', 'barber', tests.hazmieh(), 'Main st', 33.85, 35.53) $$,
  'P0001', 'SLUG_UNAVAILABLE', 'reserved slugs are refused');
insert into tests.v values ('biz', public.admin_create_business('Fade District', 'fade-district', 'barber', tests.hazmieh(),
                                                                 'Main st', 33.85, 35.53, '70 111 222'));
select throws_ok($$ select public.admin_create_business('Fade 2', 'fade-district', 'barber', tests.hazmieh(), 'Main st', 33.85, 35.53) $$,
  'P0001', 'SLUG_UNAVAILABLE', 'a taken slug is refused');
select tests.as_postgres();
insert into tests.ids select 'biz', (j ->> 'business_id')::uuid from tests.v where k = 'biz';
insert into tests.ids select 'biz_loc', (j ->> 'location_id')::uuid from tests.v where k = 'biz';
select results_eq(
  $$ select b.status::text, l.status::text, l.phone_e164, m.role::text
     from public.businesses b join public.business_locations l on l.business_id = b.id
     join public.business_members m on m.business_id = b.id and m.user_id = tests.id('ops')
     where b.id = tests.id('biz') $$,
  $$ values ('draft', 'draft', '+96170111222', 'manager') $$,
  'draft business + draft location; ops is a temporary manager so the wizard can write');

-- ops fills the wizard through normal RLS writes
select tests.act_as('ops', 'aal2');
select lives_ok($$ insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
                   select tests.id('biz_loc'), tests.id('biz'), d, 0, 1440 from generate_series(1, 7) d $$,
  'wizard: hours');
select lives_ok($$ insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
                   select tests.id('biz'), id, 'Haircut', 'fixed', 15, 30 from public.canonical_services where slug = 'mens-haircut' $$,
  'wizard: service from a template');
select tests.as_postgres();
insert into tests.ids select 'Haircut', id from public.services where business_id = tests.id('biz');

-- ═══ go-live checklist + publish ═══
select tests.act_as('ops', 'aal2');
select is((select jsonb_agg(e ->> 'key' order by e ->> 'key') from jsonb_array_elements(public.get_go_live_checklist(tests.id('biz'))) e
           where not (e ->> 'ok')::boolean),
          '["cover", "service", "staff_hours"]'::jsonb, 'checklist: still missing staff for the service, staff hours, cover');
select throws_ok($$ select public.publish_business(tests.id('biz')) $$, 'P0001', 'GO_LIVE_BLOCKED', 'publishing is blocked until the checklist is complete');
insert into tests.v values ('staff', to_jsonb(public.create_my_staff_profile(tests.id('biz'), 'Ops Helper')));
select is(public.create_my_staff_profile(tests.id('biz'), 'Ops Helper'), (select (j #>> '{}')::uuid from tests.v where k = 'staff'),
  '"I also take appointments" is idempotent');
select tests.as_postgres();
insert into public.staff_members (business_id, display_name, slug) values (tests.id('biz'), 'Karim', 'karim');
insert into tests.ids select 'Karim', id from public.staff_members where business_id = tests.id('biz') and slug = 'karim';
select tests.act_as('ops', 'aal2');
select lives_ok($$
  insert into public.staff_locations (staff_id, location_id, business_id) values (tests.id('Karim'), tests.id('biz_loc'), tests.id('biz'));
  insert into public.staff_services (staff_id, service_id, business_id) values (tests.id('Karim'), tests.id('Haircut'), tests.id('biz'));
  insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
  select tests.id('Karim'), tests.id('biz_loc'), tests.id('biz'), d, 0, 1440, current_date - 1 from generate_series(1, 7) d $$,
  'wizard: staff member with services and hours');
select lives_ok($$ select public.register_business_media(tests.id('biz'), tests.id('biz')::text || '/cover.jpg', 'cover', 'image/jpeg') $$,
  'wizard: cover photo');
select is((select count(*)::int from jsonb_array_elements(public.get_go_live_checklist(tests.id('biz'))) e where not (e ->> 'ok')::boolean),
  0, 'checklist complete');
select lives_ok($$ select public.publish_business(tests.id('biz')) $$, 'go live');
select tests.as_postgres();
select results_eq($$ select b.status::text, l.status::text, b.published_at is not null
                     from public.businesses b join public.business_locations l on l.business_id = b.id where b.id = tests.id('biz') $$,
                  $$ values ('live', 'live', true) $$, 'business and location are live');
update public.business_settings set min_notice_minutes = 0 where business_id = tests.id('biz');
select tests.as_anon();
select ok((select count(*) > 0 from public.get_available_slots(tests.id('biz_loc'), tests.id('Haircut'), null, tests.day(1), tests.day(1))),
  'customers now see availability');

-- ═══ owner claims: ops helper membership ends ═══
select tests.act_as('ops', 'aal2');
insert into tests.v values ('inv', public.invite_member(tests.id('biz'), '70 100 100', 'owner'));
select tests.act_as('owner');
select lives_ok($$ select public.accept_invitation((select j ->> 'token' from tests.v where k = 'inv')) $$, 'owner accepts the invite');
select tests.as_postgres();
select results_eq(
  $$ select (select claimed_at is not null from public.businesses where id = tests.id('biz')),
            (select status::text from public.business_members where business_id = tests.id('biz') and user_id = tests.id('ops')) $$,
  $$ values (true, 'revoked') $$, 'business claimed; the ops helper membership is revoked');
select tests.add_member('biz', 'recep', 'reception');

-- ═══ slugs ═══
select tests.act_as('owner');
select results_eq($$ select (r ->> 'available')::boolean, r ->> 'reason' from public.check_slug('fade-district') r $$,
                  $$ values (false, 'taken') $$, 'check_slug: taken');
select is((public.check_slug('fade-district') -> 'suggestions' ->> 0), 'fade-district-2', 'with suggestions');
select results_eq($$ select (r ->> 'available')::boolean, r ->> 'reason' from public.check_slug('login') r $$,
                  $$ values (false, 'reserved') $$, 'check_slug: reserved');
select is((public.check_slug('Fade District!') ->> 'reason'), 'invalid', 'check_slug: invalid');
select is((public.check_slug('fade-district', tests.id('biz')) ->> 'available')::boolean, true, 'its own slug is available to itself');
select tests.act_as('recep');
select throws_ok($$ select public.change_business_slug(tests.id('biz'), 'fade-2') $$, 'P0001', 'FORBIDDEN', 'reception cannot change the slug');
select tests.act_as('owner');
select throws_ok($$ select public.change_business_slug(tests.id('biz'), 'Fade!') $$, 'P0001', 'INVALID_SLUG', 'invalid slug refused');
select is(public.change_business_slug(tests.id('biz'), 'fade-hazmieh'), 'fade-hazmieh', 'owner changes the slug');
select tests.as_postgres();
select ok(exists (select 1 from public.business_slug_history where old_slug = 'fade-district' and business_id = tests.id('biz')),
  'old slug kept for redirects');

-- ═══ roles: reception can't edit services ═══
select tests.act_as('recep');
update public.services set price_min = 1 where id = tests.id('Haircut');
select tests.as_postgres();
select is((select price_min from public.services where id = tests.id('Haircut')), 15.00::numeric, 'reception cannot edit services (RLS)');

-- ═══ pause online booking (owner only; profile stays live) ═══
select tests.act_as('recep');
select throws_ok($$ select public.pause_online_booking(tests.id('biz'), true) $$, 'P0001', 'FORBIDDEN', 'only the owner pauses online booking');
select tests.act_as('owner');
select lives_ok($$ select public.pause_online_booking(tests.id('biz'), true) $$, 'owner pauses');
select tests.as_anon();
select is((select count(*)::int from public.get_available_slots(tests.id('biz_loc'), tests.id('Haircut'), null, tests.day(1), tests.day(1))),
  0, 'no online availability while paused');
select tests.as_postgres();
select is((select status::text from public.businesses where id = tests.id('biz')), 'live', 'the profile stays live');

-- ═══ archive staff ═══
select tests.as_postgres();
select tests.raw_booking('biz', 'Karim', 'Haircut', tests.at(tests.day(3), '10:00'));
select tests.act_as('owner');
select throws_ok($$ select public.archive_staff(tests.id('Karim')) $$, 'P0001', 'STAFF_HAS_FUTURE_BOOKINGS',
  'archiving is blocked while future bookings exist');
select tests.as_postgres();
update public.bookings set status = 'cancelled', cancelled_by_kind = 'business'
 where id in (select booking_id from public.booking_items where staff_id = tests.id('Karim'));
select tests.act_as('owner');
select lives_ok($$ select public.archive_staff(tests.id('Karim')) $$, 'archive after the bookings are handled');
select tests.as_postgres();
select results_eq($$ select status::text, publicly_bookable, accepts_any_assignment from public.staff_members where id = tests.id('Karim') $$,
                  $$ values ('archived', false, false) $$, 'archived and hidden from customers');

select * from finish();
rollback;
