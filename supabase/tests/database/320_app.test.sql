-- M13 · customer app backend: favorite places, rebook suggestions, push tokens, push vs WhatsApp routing
--       in the dispatcher claim, inbox (customer messages only, 90 days, unread count).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(33);

select tests.new_user('owner', '96170320100');
select tests.new_user('c1', '96170320001');
select tests.new_user('c2', '96170320002');
select tests.new_user('apponly');                        -- app account without a phone on file
select tests.new_business('biz', 'owner');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim Haddad');
select tests.staff_every_day('biz', 'Karim Haddad', 0, 1440);
select tests.new_service('biz', 'Cut');
select tests.new_service('biz', 'Beard', 'beard-trim');
select tests.link('biz', 'Karim Haddad', 'Cut');
select tests.link('biz', 'Karim Haddad', 'Beard');
select tests.new_business('biz2', 'owner');
select tests.open_every_day('biz2', 0, 1440);
select tests.new_staff('biz2', 'Maya Test');
select tests.staff_every_day('biz2', 'Maya Test', 0, 1440);
select tests.new_service('biz2', 'Nails', 'manicure');
select tests.link('biz2', 'Maya Test', 'Nails');
select tests.customer_record('r1', 'biz', 'Customer 1', '+96170320001', 'c1');
select tests.customer_record('r1b', 'biz2', 'Customer 1', '+96170320001', 'c1');
select tests.visit('v_cut', 'biz', 'Karim Haddad', 'Cut', 'r1', tests.at(tests.day(-10), '10:00'));
select tests.visit('v_cut_old', 'biz', 'Karim Haddad', 'Cut', 'r1', tests.at(tests.day(-40), '10:00'));
select tests.visit('v_beard', 'biz', 'Karim Haddad', 'Beard', 'r1', tests.at(tests.day(-5), '10:00'));
select tests.visit('v_nails', 'biz2', 'Maya Test', 'Nails', 'r1b', tests.at(tests.day(-3), '10:00'));
update public.bookings b set customer_user_id = c.user_id from public.business_customers c where c.id = b.business_customer_id;
select private.job_search_refresh(1000);

create table tests.v (k text primary key, j jsonb);
grant select, insert, update on tests.v to authenticated, service_role;
grant usage on schema tests to service_role;
grant select on tests.ids to service_role;
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
create function tests.claimed(p_type text, p_user text) returns jsonb language sql as $$
  select x from tests.v, jsonb_array_elements(tests.v.j) x
  where tests.v.k = 'claim' and x ->> 'type' = p_type
    and (x ->> 'id')::uuid in (select id from public.notifications where recipient_user_id = tests.id(p_user))
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ═══ favorites ═══
select tests.act_as('c1', 'aal1', true);
select throws_ok($$ select public.toggle_favorite_business(tests.id('biz')) $$, 'P0001', 'AUTH_REQUIRED', 'anonymous sessions cannot favorite');
select tests.act_as('c1');
select is(public.toggle_favorite_business(tests.id('biz')) ->> 'favorited', 'true', 'favorite on');
select is(public.toggle_favorite_business(tests.id('biz2')) ->> 'favorited', 'true', 'second favorite');
select tests.as_postgres();
update public.favorite_businesses set created_at = now() - interval '1 minute' where business_id = tests.id('biz');
select tests.act_as('c1');
select results_eq($$ select x ->> 'name', x ->> 'state', (x ->> 'next_available_at') is not null
                     from jsonb_array_elements(public.get_my_favorites()) x order by x ->> 'saved_at' desc, x ->> 'name' $$,
                  $$ values ('Business biz2', 'ok', true), ('Business biz', 'ok', true) $$, 'places with next availability, newest first');
select ok(public.is_favorite_business(tests.id('biz')), 'is_favorite_business');
select is(public.toggle_favorite_business(tests.id('biz2')) ->> 'favorited', 'false', 'toggle again removes it');
select tests.act_as('c2');
select is((select count(*)::int from public.favorite_businesses), 0, 'favorites are private (RLS)');
select tests.as_postgres();
update public.businesses set status = 'suspended' where id = tests.id('biz');
select private.job_search_refresh(1000);
select tests.act_as('c1');
select is(public.get_my_favorites() -> 0 ->> 'state', 'unavailable', 'a favorite that stops being bookable is dimmed, not dropped');
select tests.as_postgres();
update public.businesses set status = 'live' where id = tests.id('biz');
select private.job_search_refresh(1000);

-- ═══ rebook suggestions (C2 "Book again with {staff}") ═══
select tests.act_as('c1');
select results_eq($$ select x ->> 'service', x ->> 'staff', (x ->> 'next_available_at') is not null
                     from jsonb_array_elements(public.get_rebook_suggestions()) x order by x ->> 'last_visit_at' desc $$,
                  $$ values ('Nails', 'Maya', true), ('Beard', 'Karim', true), ('Cut', 'Karim', true) $$,
                  'last visit per business + service, staff-first, with the next slot for that person');
select is((select x ->> 'last_visit_at' from jsonb_array_elements(public.get_rebook_suggestions()) x where x ->> 'service' = 'Cut')::timestamptz,
          tests.at(tests.day(-10), '10:00'), 'the most recent visit of that service');
select tests.as_postgres();
update public.staff_members set publicly_bookable = false, accepts_any_assignment = false where id = tests.id('Maya Test');
update public.services set status = 'archived' where id = tests.id('Beard');
select tests.act_as('c1');
select results_eq($$ select x ->> 'service', x ->> 'staff', x ->> 'last_staff'
                     from jsonb_array_elements(public.get_rebook_suggestions()) x order by x ->> 'last_visit_at' desc $$,
                  $$ values ('Nails', null::text, 'Maya'), ('Cut', 'Karim', 'Karim') $$,
                  'staff no longer public → "Any available" (name kept for the card); archived service dropped');
select tests.as_postgres();
update public.businesses set status = 'suspended' where id = tests.id('biz2');
select tests.act_as('c1');
select is(jsonb_array_length(public.get_rebook_suggestions()), 1, 'a suspended business is never suggested');
select tests.act_as('c1', 'aal1', true);
select is(public.get_rebook_suggestions(), '[]'::jsonb, 'anonymous: no suggestions');
select tests.as_postgres();
update public.businesses set status = 'live' where id = tests.id('biz2');

-- ═══ push tokens ═══
select tests.act_as('c1');
select throws_ok($$ select public.register_push_token('not-a-token', 'ios') $$, 'P0001', 'INVALID_INPUT', 'token format checked');
select throws_ok($$ select public.register_push_token('ExponentPushToken[abcdefghij123]', 'web') $$, 'P0001', 'INVALID_INPUT', 'platform checked');
select lives_ok($$ select public.register_push_token('ExponentPushToken[abcdefghij123]', 'ios') $$, 'c1 registers a device');
select tests.act_as('c2');
select lives_ok($$ select public.register_push_token('ExponentPushToken[abcdefghij123]', 'ios') $$, 'the same device signs into c2');
select tests.as_postgres();
select is((select user_id from public.push_tokens where expo_token = 'ExponentPushToken[abcdefghij123]'), tests.id('c2'),
  'one token per device: it moves to the account now signed in');
select tests.act_as('c1');
select public.unregister_push_token('ExponentPushToken[abcdefghij123]');
select tests.as_postgres();
select is((select disabled_at from public.push_tokens where expo_token = 'ExponentPushToken[abcdefghij123]'), null,
  'unregister only affects the caller''s own tokens');
select tests.act_as('c1');
select public.register_push_token('ExponentPushToken[c1device00001]', 'android');
select tests.act_as('apponly');
select public.register_push_token('ExponentPushToken[apponly000001]', 'ios');
select tests.act_as('c1');
select throws_ok($$ select public.push_tokens_invalid(array['ExponentPushToken[c1device00001]']) $$, '42501', null,
  'only the dispatcher (service role) can disable tokens');

-- ═══ routing: push instead of WhatsApp for review/result messages; disputes WhatsApp + push ═══
select tests.as_postgres();
insert into public.notifications (type, recipient_user_id, recipient_phone, booking_id, payload) values
  ('review_request', tests.id('c1'), '+96170320001', tests.id('v_cut'), '{"business_name":"Business biz"}'),
  ('booking_confirmed', tests.id('c1'), '+96170320001', tests.id('v_cut'), '{"business_name":"Business biz"}'),
  ('review_request', tests.id('c2'), '+96170320002', null, '{}'),
  ('review_request', tests.id('owner'), '+96170320100', null, '{}'),
  ('dispute_update', tests.id('apponly'), null, null, '{}'),
  ('dispute_update', tests.id('c1'), '+96170320001', tests.id('v_cut'), '{}');
select tests.as_service();
insert into tests.v values ('claim', public.notify_claim(50));
select tests.as_postgres();
select results_eq($$ select tests.claimed('review_request', 'c1') -> 'channels', tests.claimed('review_request', 'c1') -> 'push_tokens' $$,
                  $$ values ('["push"]'::jsonb, '["ExponentPushToken[c1device00001]"]'::jsonb) $$,
                  'app user: review request goes by push to their devices');
select is(tests.claimed('booking_confirmed', 'c1') -> 'channels', '["whatsapp", "sms"]'::jsonb,
  'booking messages stay on WhatsApp (+ SMS fallback) even for app users');
select is(tests.claimed('review_request', 'c2') -> 'channels', '["push"]'::jsonb,
  'the device that moved to c2 receives c2''s push (c1''s unregister did not touch it)');
select is(tests.claimed('review_request', 'owner') -> 'channels', '["whatsapp"]'::jsonb, 'web-only customer → WhatsApp');
select results_eq($$ select tests.claimed('dispute_update', 'c1') -> 'channels', tests.claimed('dispute_update', 'c1') -> 'also_push' $$,
                  $$ values ('["whatsapp"]'::jsonb, 'true'::jsonb) $$,
                  'dispute outcome: WhatsApp as usual and a push as well');
select results_eq($$ select tests.claimed('dispute_update', 'apponly') -> 'channels', tests.claimed('dispute_update', 'apponly') -> 'also_push' $$,
                  $$ values ('[]'::jsonb, 'true'::jsonb) $$,
                  'app-only account without a phone: the dispute push still reaches them');
-- push disabled in settings → WhatsApp
select tests.as_postgres();
insert into public.notification_preferences (user_id, channel, enabled) values (tests.id('c1'), 'push', false);
update public.notifications set status = 'queued' where type in ('review_request', 'dispute_update') and recipient_user_id = tests.id('c1');
select tests.as_service();
update tests.v set j = public.notify_claim(50) where k = 'claim';
select tests.as_postgres();
select is(tests.claimed('review_request', 'c1') -> 'channels', '["whatsapp"]'::jsonb, 'push turned off → WhatsApp');
select is(tests.claimed('dispute_update', 'c1') -> 'also_push', 'false'::jsonb, 'push turned off → no dispute push');
select tests.as_service();
select is(public.push_tokens_invalid(array['ExponentPushToken[apponly000001]']), 1, 'dispatcher disables an unregistered device');

-- ═══ inbox ═══
select tests.as_postgres();
insert into public.notifications (type, recipient_user_id, recipient_phone, payload, created_at, scheduled_for, status) values
  ('biz_new_booking', tests.id('c1'), '+96170320001', '{}', now(), now(), 'sent'),
  ('booking_reminder_24h', tests.id('c1'), '+96170320001', '{}', now() - interval '100 days', now() - interval '100 days', 'sent');
select tests.act_as('c1');
select ok(not exists (select 1 from public.get_my_notifications() where type::text like 'biz%'), 'business alerts never show in the customer inbox');
select ok(not exists (select 1 from public.get_my_notifications() where created_at < now() - interval '90 days'), '90-day retention');
select is(public.get_unread_notification_count(), (select count(*)::int from public.get_my_notifications() where read_at is null),
  'unread count matches the inbox');

-- app routes that must never become business slugs
select tests.as_postgres();
select is((select count(*)::int from public.reserved_slugs where slug in ('captcha', 'sign-in')), 2,
  'app route slugs are reserved');

select * from finish();
rollback;
