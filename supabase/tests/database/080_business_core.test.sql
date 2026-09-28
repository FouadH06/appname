-- Phase 3 Part 2 §5, Part 5 §9, Part 7 §2 — businesses, slugs, locations, members, bootstrap
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(25);

select tests.new_user('owner_a');
select tests.new_user('owner_b');
select tests.new_user('owner_a2');
select tests.new_business('biz_a', 'owner_a');
select tests.new_business('biz_b', 'owner_b');

-- ─── bootstrap on insert ───
select ok(exists (select 1 from public.business_settings where business_id = tests.id('biz_a')),
  'settings row created with the business');
select is((select p.key::text from public.business_subscriptions s join public.plans p on p.id = s.plan_id
           where s.business_id = tests.id('biz_a')), 'launch_free', 'business starts on the launch plan');
select ok(exists (select 1 from public.business_categories bc join public.categories c on c.id = bc.category_id
                  where bc.business_id = tests.id('biz_a') and c.slug = 'barber' and bc.is_primary),
  'primary category row created');
update public.businesses set primary_category_id = (select id from public.categories where slug = 'hair-salon')
where id = tests.id('biz_b');
select is((select c.slug::text from public.business_categories bc join public.categories c on c.id = bc.category_id
           where bc.business_id = tests.id('biz_b') and bc.is_primary), 'hair-salon',
  'changing the primary category moves the primary flag');

-- entitlements
select ok(private.has_entitlement(tests.id('biz_a'), 'crm'), 'launch plan grants crm');
select ok(private.has_entitlement(tests.id('biz_a'), 'staff_max'), 'numeric entitlement > 0 counts as granted');
select ok(not private.has_entitlement(tests.id('biz_a'), 'promotions'), 'launch plan does not grant promotions');
select ok(not private.has_entitlement(tests.id('biz_a'), 'nonexistent'), 'unknown entitlement is false');

-- ─── slugs ───
select throws_ok($$ insert into public.businesses (slug, name, primary_category_id)
                    select 'search', 'X', id from public.categories where slug = 'barber' $$,
  'P0001', 'SLUG_UNAVAILABLE', 'reserved route word rejected');
select throws_ok($$ insert into public.businesses (slug, name, primary_category_id)
                    select 'hamra', 'X', id from public.categories where slug = 'barber' $$,
  'P0001', 'SLUG_UNAVAILABLE', 'area slug rejected (SEO paths)');
select is(
  (select count(*)::int from public.reserved_slugs where slug = any (array[
     'app-name', 'pricing', 'partners', 'admin', 'api', 'app', 'login', 'signup', 'search', 'book', 'booking',
     'bookings', 'biz', 'business', 'staff', 'services', 'reviews', 'settings', 'account', 'dashboard',
     'support', 'help', 'terms', 'privacy', 'about', 'contact']::extensions.citext[])),
  26, 'every slug on the approved reserved list is reserved');
select throws_ok($$ insert into public.businesses (slug, name, primary_category_id)
                    select 'Bad Slug!', 'X', id from public.categories where slug = 'barber' $$,
  '23514', null, 'invalid slug format rejected');
select throws_ok($$ insert into public.businesses (slug, name, primary_category_id)
                    select 'Fade-District', 'X', id from public.categories where slug = 'barber' $$,
  '23514', null, 'uppercase business slug rejected (lowercase only, same in every environment)');
select throws_ok($$ insert into public.staff_members (business_id, display_name, slug)
                    values (tests.id('biz_a'), 'Karim', 'Karim') $$,
  '23514', null, 'uppercase staff slug rejected');

update public.businesses set slug = 'fade-district' where id = tests.id('biz_a');
select ok(exists (select 1 from public.business_slug_history where old_slug = 'biz-a-test' and business_id = tests.id('biz_a')),
  'old slug kept for redirects');
select throws_ok($$ update public.businesses set slug = 'biz-a-test' where id = tests.id('biz_b') $$,
  'P0001', 'SLUG_UNAVAILABLE', 'another business cannot take an old slug');
update public.businesses set slug = 'biz-a-test' where id = tests.id('biz_a');
select ok(not exists (select 1 from public.business_slug_history where old_slug = 'biz-a-test')
          and exists (select 1 from public.business_slug_history where old_slug = 'fade-district'),
  'a business can take back its own old slug');

-- ─── members & locations ───
select throws_ok($$ insert into public.business_members (business_id, user_id, role)
                    values (tests.id('biz_a'), tests.id('owner_a2'), 'owner') $$,
  '23505', null, 'only one active owner per business');
select throws_ok($$ insert into public.business_locations (business_id, area_id, geo)
                    select tests.id('biz_a'), id, centroid from public.areas where slug = 'hamra' $$,
  '23505', null, 'only one primary location per business');

insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
values (tests.id('biz_a_loc'), tests.id('biz_a'), 1, 540, 780), (tests.id('biz_a_loc'), tests.id('biz_a'), 1, 840, 1200);
select is((select count(*)::int from public.location_hours where location_id = tests.id('biz_a_loc')), 2,
  'split opening hours (lunch closure) allowed');
select throws_ok($$ insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
                    values (tests.id('biz_a_loc'), tests.id('biz_a'), 1, 700, 900) $$,
  '23P01', null, 'overlapping opening hours rejected');
select throws_ok($$ insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
                    values (tests.id('biz_a_loc'), tests.id('biz_b'), 2, 540, 1200) $$,
  '23503', null, 'hours cannot point at another business''s location');

-- ─── public visibility ───
select ok(private.is_publicly_visible_location(tests.id('biz_a_loc')), 'live business + live location is visible');
update public.businesses set is_test = true where id = tests.id('biz_b');
select ok(not private.is_publicly_visible_location(tests.id('biz_b_loc')), 'test business is never public');
update public.business_locations set status = 'paused' where id = tests.id('biz_a_loc');
select ok(not private.is_publicly_visible_location(tests.id('biz_a_loc')), 'paused location is not public');

select * from finish();
rollback;
