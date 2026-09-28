-- M7 · notifications: enqueue from booking events (notify rules, reminders, reschedule/cancel),
--      business alerts + settings, dispatch claim / finish / retry, receipts + SMS fallback,
--      WhatsApp Confirm button (phone match), preferences, inbox, template fallback, grants
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(47);

create table tests.v (k text primary key, j jsonb);
grant select, insert on tests.v to authenticated;

select tests.new_user('owner', '96170111001');  select tests.new_user('recep', '96170111002');
select tests.new_user('staff_user');  select tests.new_user('ops');  select tests.new_user('moe', '96170111003');
insert into public.admin_users (user_id, role) values (tests.id('ops'), 'ops');
select tests.new_business('biz', 'owner');
select tests.add_member('biz', 'recep', 'reception');
select tests.add_member('biz', 'staff_user', 'staff');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim');
select tests.staff_every_day('biz', 'Karim', 0, 1440);
select tests.new_service('biz', 'Cut');
select tests.link('biz', 'Karim', 'Cut');
select tests.customer_record('moe_rec', 'biz', 'Moe Haddad', '+96170111003', 'moe');
update public.profiles set locale = 'ar' where id = tests.id('moe');

create function tests.n(p_booking uuid, p_type text) returns setof public.notifications language sql as $$
  select * from public.notifications where booking_id = p_booking and type::text = p_type order by created_at
$$;
create function tests.bk(p_key text) returns uuid language sql as $$ select (j #>> '{}')::uuid from tests.v where k = p_key $$;
create function tests.manual(p_key text, p_phone text, p_start timestamptz, p_notify boolean) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.create_manual_booking(tests.id('biz_loc'), jsonb_build_object('phone', p_phone, 'name', 'Lina'),
                                     tests.id('Cut'), tests.id('Karim'), p_start, p_notify => p_notify)).id;
  insert into tests.v values (p_key, to_jsonb(v));
  return v;
end $$;
grant execute on all functions in schema tests to authenticated, service_role;
grant usage on schema tests to service_role;
grant select, insert on tests.v, tests.ids to service_role;

-- ═══ enqueue from booking events ═══
select tests.act_as('recep');
select tests.manual('a', '71 000 111', tests.at(tests.day(3), '14:00'), true);
select tests.manual('quiet', '71 000 112', now() + interval '3 days 2 hours', false);
select tests.manual('soon', '71 000 113', now() + interval '90 minutes', true);
select tests.manual('today', '71 000 114', now() + interval '5 hours', true);
select tests.as_postgres();

select results_eq($$ select recipient_phone, status::text, payload ->> 'link' like 'http://127.0.0.1:3000/m/%' from tests.n(tests.bk('a'), 'booking_confirmed') $$,
                  $$ values ('+96171000111', 'queued', true) $$, 'manual booking with "Send confirmation": confirmation queued with a claim/manage link');
select results_eq($$ select type::text, scheduled_for from public.notifications where booking_id = tests.bk('a') and type::text like 'booking_reminder%' order by type $$,
                  $$ select * from (values ('booking_reminder_24h', (select starts_at - interval '24 hours' from public.bookings where id = tests.bk('a'))),
                                           ('booking_reminder_2h',  (select starts_at - interval '2 hours'  from public.bookings where id = tests.bk('a')))) x $$,
  'reminders 24 h and 2 h before');
select is((select count(*)::int from public.notifications where booking_id = tests.bk('quiet')), 0, 'notify off: nothing for the customer');
select is((select count(*)::int from public.notifications where booking_id = tests.bk('soon') and type::text like 'booking_reminder%'), 0,
  'booked < 2 h ahead: no reminders');
select is((select array_agg(type::text) from public.notifications where booking_id = tests.bk('today') and type::text like 'booking_reminder%'),
  case when private.in_quiet_hours(tests.id('biz'), (select starts_at - interval '2 hours' from public.bookings where id = tests.bk('today')))
       then null else array['booking_reminder_2h'] end,
  'booked 5 h ahead: only the 2 h reminder (none if it would fall in quiet hours)');
select is((select payload ->> 'business_name' from tests.n(tests.bk('a'), 'booking_confirmed')), 'Business biz', 'payload carries what the message shows');

-- reschedule: old reminders cancelled, new ones scheduled, the customer told
select tests.act_as('recep');
select lives_ok($$ select public.biz_reschedule_booking(tests.bk('a'), (select starts_at + interval '1 day' from public.bookings where id = tests.bk('a')), null, true) $$,
  'reception moves the booking and notifies');
select tests.as_postgres();
select is((select count(*)::int from public.notifications where booking_id = tests.bk('a') and type::text like 'booking_reminder%' and status = 'cancelled'), 2,
  'old reminders cancelled');
select is((select count(*)::int from public.notifications where booking_id = tests.bk('a') and type::text like 'booking_reminder%' and status = 'queued'), 2,
  'new reminders for the new time');
select ok((select payload ? 'old_starts_at' from tests.n(tests.bk('a'), 'booking_rescheduled_by_business')), 'reschedule message shows the old time');

-- cancel by the business (notify) vs Undo (never notifies)
select tests.act_as('recep');
select lives_ok($$ select public.biz_cancel_booking(tests.bk('today'), 'Staff sick', true) $$, 'business cancels');
select lives_ok($$ select public.biz_undo_manual_booking(tests.bk('soon')) $$, 'undo right after saving');
select tests.as_postgres();
select results_eq($$ select payload ->> 'reason' from tests.n(tests.bk('today'), 'booking_cancelled_by_business') $$, $$ values ('Staff sick') $$,
  'cancellation message with the reason');
select is((select count(*)::int from public.notifications where booking_id = tests.bk('today') and type = 'booking_reminder_2h' and status = 'queued'), 0,
  'its reminders are cancelled');
select is((select count(*)::int from tests.n(tests.bk('soon'), 'booking_cancelled_by_business')), 0, 'Undo sends no cancellation');

-- ═══ quiet hours (22:00–08:00 Beirut) ═══
select tests.act_as('recep');
select tests.manual('early', '71 000 115', tests.at(tests.day(3), '08:00'), true);
select tests.manual('late', '71 000 116', tests.at(tests.day(3), '23:30'), true);
select tests.as_postgres();
select results_eq($$ select type::text, scheduled_for from public.notifications where booking_id = tests.bk('early') and type::text like 'booking_reminder%' $$,
                  $$ values ('booking_reminder_24h', tests.at(tests.day(2), '08:00')) $$,
  '8:00 visit: no 6:00 reminder; the 24 h one remains');
select results_eq($$ select type::text, scheduled_for from public.notifications where booking_id = tests.bk('late') and type = 'booking_reminder_24h' $$,
                  $$ values ('booking_reminder_24h', tests.at(tests.day(3), '08:00')) $$,
  '23:30 visit: the 24 h reminder moves to the end of quiet hours');
select is(private.business_alert_at(tests.id('biz'), tests.at(tests.day(3), '12:00'), null, tests.at(tests.day(1), '23:00')),
  tests.at(tests.day(2), '08:00'), 'a normal business alert at 23:00 waits until 08:00');
select is(private.business_alert_at(tests.id('biz'), tests.at(tests.day(3), '12:00'), tests.at(tests.day(2), '07:00'), tests.at(tests.day(1), '23:00')),
  tests.at(tests.day(1), '23:00'), 'a request expiring early in the morning is surfaced right away');
select is(private.business_alert_at(tests.id('biz'), tests.at(tests.day(3), '12:00'), null, tests.at(tests.day(1), '15:00')),
  tests.at(tests.day(1), '15:00'), 'outside quiet hours: immediately');

-- ═══ business alerts ═══
insert into public.booking_events (booking_id, business_id, event, actor_kind, from_status, to_status)
values (tests.bk('quiet'), tests.id('biz'), 'cancelled', 'customer', 'confirmed', 'cancelled');
select results_eq($$ select recipient_user_id, recipient_phone from public.notifications
                     where booking_id = tests.bk('quiet') and type = 'biz_booking_cancelled' order by recipient_phone $$,
                  $$ values (tests.id('owner'), '+96170111001'), (tests.id('recep'), '+96170111002') $$,
  'customer cancellation alerts owner and reception by default (not staff)');
select tests.act_as('recep');
select throws_ok($$ select public.biz_set_notification_setting(tests.id('biz'), tests.id('owner'), 'biz_new_booking', false) $$,
  'P0001', 'FORBIDDEN', 'reception changes only their own alerts');
select lives_ok($$ select public.biz_set_notification_setting(tests.id('biz'), tests.id('recep'), 'biz_new_booking', false) $$, 'reception opts out');
select results_eq($$ select (e -> 'alerts' ->> 'biz_new_booking')::boolean from jsonb_array_elements(public.biz_get_notification_settings(tests.id('biz'))) e
                     where (e ->> 'role') in ('owner', 'reception') order by e ->> 'role' $$,
                  $$ values (true), (false) $$, 'owner keeps the default, reception off');
select tests.act_as('staff_user');
select throws_ok($$ select public.biz_get_notification_settings(tests.id('biz')) $$, 'P0001', 'FORBIDDEN', 'staff do not manage alerts');

-- ═══ dispatch: claim, finish, retry, receipts, fallback ═══
select tests.as_postgres();
update public.notifications set status = 'cancelled' where status = 'queued';     -- start clean
select tests.act_as('recep');
select tests.manual('b', '71 000 222', now() + interval '1 day 6 hours', true);
select tests.as_postgres();
select tests.act_as('owner');
select throws_ok($$ select public.notify_claim(10) $$, '42501', null, 'the dispatcher RPCs are service_role only');
set local role service_role;
insert into tests.v select 'claim', public.notify_claim(10);
select results_eq($$ select e ->> 'type', e -> 'channels', (e ->> 'critical')::boolean, e #>> '{templates,whatsapp,provider_template_name}'
                     from jsonb_array_elements((select j from tests.v where k = 'claim')) e $$,
                  $$ values ('booking_confirmed', '["whatsapp", "sms"]'::jsonb, true, 'booking_confirmed_v1') $$,
  'only due rows (not future reminders); WhatsApp then SMS for critical messages; template attached');
select is(jsonb_array_length(public.notify_claim(10)), 0, 'a second run claims nothing (no double send)');
insert into tests.v values ('nid', (select j -> 0 -> 'id' from tests.v where k = 'claim'));
select public.notify_record_attempt(tests.bk('nid'), 'whatsapp', 'whatsapp', 'wamid.1', true, null);
select public.notify_finish(tests.bk('nid'), 'sent');
select is((select status::text from public.notifications where id = tests.bk('nid')), 'sent', 'sent');
select public.notify_status_update('whatsapp', 'wamid.1', 'failed', '131026 undeliverable');
select results_eq($$ select status::text, channel_override::text from public.notifications where id = tests.bk('nid') $$,
                  $$ values ('queued', 'sms') $$, 'a failed WhatsApp receipt on a critical message → one SMS retry');
select results_eq($$ select e -> 'channels' from jsonb_array_elements(public.notify_claim(10)) e $$,
                  $$ values ('["sms"]'::jsonb) $$, 'the retry goes by SMS only');
select public.notify_record_attempt(tests.bk('nid'), 'sms', 'twilio', 'SM1', true, null);
select public.notify_finish(tests.bk('nid'), 'sent');
select public.notify_status_update('twilio', 'SM1', 'delivered', null);
select public.notify_status_update('twilio', 'SM1', 'sent', null);
select is((select status::text from public.notification_deliveries where provider_message_id = 'SM1'), 'delivered',
  'receipts never go backwards (delivered stays delivered)');

-- retry with backoff, then give up after 4 attempts
update public.notifications set status = 'queued', scheduled_for = now(), channel_override = null, attempts = 0 where id = tests.bk('nid');
select public.notify_claim(10);
select public.notify_finish(tests.bk('nid'), 'retry', 'whatsapp 503');
select results_eq($$ select status::text, scheduled_for > now() + interval '50 seconds' from public.notifications where id = tests.bk('nid') $$,
                  $$ values ('queued', true) $$, 'temporary error → retry in about a minute');
update public.notifications set attempts = 3, scheduled_for = now() where id = tests.bk('nid');
select public.notify_claim(10);
select public.notify_finish(tests.bk('nid'), 'retry', 'whatsapp 503');
select is((select status::text from public.notifications where id = tests.bk('nid')), 'failed', 'after 4 attempts it fails');

-- ═══ WhatsApp buttons ═══
select tests.as_postgres();
select tests.act_as('recep');
insert into tests.v values ('m', to_jsonb((public.create_manual_booking(tests.id('biz_loc'), jsonb_build_object('business_customer_id', tests.id('moe_rec')),
  tests.id('Cut'), tests.id('Karim'), now() + interval '2 days')).id));
set local role service_role;
select is(public.whatsapp_button('wamid.btn1', '96170999999', 'confirm:' || tests.bk('m')) ->> 'reply', 'not_yours',
  'Confirm from another number is refused');
select is(public.whatsapp_button('wamid.btn2', '96170111003', 'confirm:' || tests.bk('m')) ->> 'reply', 'confirmed', 'Confirm from the customer''s number');
select is(public.whatsapp_button('wamid.btn2', '96170111003', 'confirm:' || tests.bk('m')), null, 'the same webhook twice is handled once');
select is(public.whatsapp_button('wamid.btn3', '96170111003', 'cancel:' || tests.bk('m')) ->> 'reply', 'cancel_link',
  'Cancel replies with the manage link (never cancels directly)');
select tests.as_postgres();
select results_eq($$ select customer_confirmed_at is not null, status::text from public.bookings where id = tests.bk('m') $$,
                  $$ values (true, 'confirmed') $$, 'attendance confirmed, booking untouched by Cancel');
select is((select count(*)::int from public.booking_events where booking_id = tests.bk('m') and event = 'customer_confirmed'), 1, 'event logged');

-- template fallback: the customer's locale (ar) until only English is approved
update public.notification_templates set status = 'approved' where type = 'booking_confirmed' and channel = 'whatsapp' and locale = 'en';
update public.notifications set status = 'cancelled' where status = 'queued';
update public.notifications set status = 'queued', scheduled_for = now() where booking_id = tests.bk('m') and type = 'booking_confirmed';
set local role service_role;
select is((select e #>> '{templates,whatsapp,locale}' from jsonb_array_elements(public.notify_claim(10)) e), 'en',
  'Arabic template not approved yet → the approved English one');

-- ═══ customer preferences + inbox ═══
select tests.as_postgres();
select tests.act_as('moe');
select lives_ok($$ select public.set_notification_preference('whatsapp', false) $$, 'customer turns WhatsApp off');
select lives_ok($$ select public.set_notification_preference('push', false) $$, 'and push');
select throws_ok($$ select public.set_notification_preference('sms', false) $$, 'P0001', 'LAST_CHANNEL', 'one of push / WhatsApp / SMS stays on');
select ok((select count(*) > 0 from public.get_my_notifications()), 'in-app inbox lists their messages');
select tests.act_as('owner');
select is((select count(*)::int from public.get_my_notifications() where booking_id = tests.bk('m')), 0, 'never someone else''s');

select tests.act_as('owner');
select throws_ok($$ select * from public.admin_notification_stats() $$, 'P0001', 'FORBIDDEN', 'delivery report is for ops');
select tests.as_postgres();

select * from finish();
rollback;
