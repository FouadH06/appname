-- M8 · public booking: business page (non-leak, redirects, availability states), staff options
--      (public only, rebook shortcut), customer read models, no-show contest
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(32);

select tests.new_user('owner');  select tests.new_user('moe', '96170222001');  select tests.new_user('other', '96170222002');
select tests.new_business('biz', 'owner');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim Public');
select tests.new_staff('biz', 'Rina Internal', null, false, false);
select tests.new_staff('biz', 'Omar Archived');
update public.staff_members set status = 'archived', archived_at = now() where id = tests.id('Omar Archived');
select tests.staff_every_day('biz', 'Karim Public', 540, 1140);
select tests.staff_every_day('biz', 'Rina Internal', 540, 1140);
select tests.new_staff('biz', 'Lea Public');
select tests.staff_every_day('biz', 'Lea Public', 540, 1140);
select tests.new_service('biz', 'Cut');
select tests.new_service('biz', 'Consult');
update public.services set price_type = 'on_consultation', price_min = null, is_online_bookable = false where id = tests.id('Consult');
select tests.link('biz', 'Karim Public', 'Cut');  select tests.link('biz', 'Rina Internal', 'Cut');  select tests.link('biz', 'Lea Public', 'Cut');
select tests.customer_record('moe_rec', 'biz', 'Moe Haddad', '+96170222001', 'moe');
select tests.visit('past', 'biz', 'Karim Public', 'Cut', 'moe_rec', tests.at(tests.day(-10), '10:00'));
select tests.visit('up', 'biz', 'Rina Internal', 'Cut', 'moe_rec', tests.at(tests.day(2), '11:00'), 'confirmed');
select tests.visit('up2', 'biz', 'Karim Public', 'Cut', 'moe_rec', tests.at(tests.day(3), '10:00'), 'confirmed');
select tests.visit('ns', 'biz', 'Karim Public', 'Cut', 'moe_rec', tests.at(tests.day(-1), '10:00'), 'no_show');
select tests.visit('ns_old', 'biz', 'Karim Public', 'Cut', 'moe_rec', tests.at(tests.day(-20), '10:00'), 'no_show');
update public.bookings set customer_user_id = tests.id('moe') where business_customer_id = tests.id('moe_rec');
update public.bookings set no_show_at = now() - interval '8 days' where id = tests.id('ns_old');
select tests.new_business('draft', 'owner');
update public.businesses set status = 'draft' where id = tests.id('draft');

create table tests.v (k text primary key, j jsonb);
grant select, insert on tests.v to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ═══ C1 business page ═══
select tests.as_anon();
insert into tests.v values ('page', public.get_business_page('BIZ-TEST'));
select is((select j ->> 'state' from tests.v where k = 'page'), 'ok', 'visitors (anon) get the page; slug case-insensitive');
select is((select jsonb_agg(s ->> 'name' order by s ->> 'name') from tests.v, jsonb_array_elements(j -> 'staff') s where k = 'page'),
  '["Karim Public", "Lea Public"]'::jsonb, 'only public, active staff');
select ok((select position(tests.id('Rina Internal')::text in j::text) = 0 and position('Rina' in j::text) = 0
                  and position(tests.id('Omar Archived')::text in j::text) = 0 and position('Omar' in j::text) = 0
           from tests.v where k = 'page'),
  'no internal-only or archived staff id or name anywhere in the payload');
select results_eq($$ select s ->> 'name', (s ->> 'online')::boolean from tests.v, jsonb_array_elements(j -> 'services') s where k = 'page' order by 1 $$,
                  $$ values ('Consult', false), ('Cut', true) $$, 'on-consultation service shown but not bookable online');
select is((select (j ->> 'accepting')::boolean from tests.v where k = 'page'), true, 'accepting online bookings');
select is(public.get_business_page('draft-test') ->> 'state', 'unavailable', 'draft business: unavailable');
select is(public.get_business_page('nope-nope') ->> 'state', 'not_found', 'unknown slug');
select tests.as_postgres();
update public.businesses set slug = 'fade-district' where id = tests.id('biz');
update public.business_settings set allow_online_booking = false where business_id = tests.id('biz');
select tests.as_anon();
select is(public.get_business_page('biz-test') ->> 'redirect_to', 'fade-district', 'old slug → redirect to the new one');
select is((public.get_business_page('fade-district') ->> 'accepting')::boolean, false, 'paused online booking: profile shown, not accepting');
select tests.as_postgres();
update public.business_settings set allow_online_booking = true where business_id = tests.id('biz');

-- ═══ C8 staff options ═══
select tests.as_anon();
insert into tests.v values ('opts', public.get_staff_options(tests.id('biz_loc'), tests.id('Cut')));
select is((select jsonb_agg(s ->> 'name' order by s ->> 'name') from tests.v, jsonb_array_elements(j -> 'staff') s where k = 'opts'),
  '["Karim Public", "Lea Public"]'::jsonb, 'staff options: public staff only');
select ok((select position(tests.id('Rina Internal')::text in j::text) = 0 from tests.v where k = 'opts'), 'no internal staff id');
select is((select j -> 'rebook' from tests.v where k = 'opts'), 'null'::jsonb, 'visitors get no rebook shortcut');
select tests.act_as('moe');
select is(public.get_staff_options(tests.id('biz_loc'), tests.id('Cut')) #>> '{rebook,name}', 'Karim', '"Book again with Karim" for the returning customer');

-- ═══ C12 / C13 ═══
select is((select jsonb_agg(b ->> 'id') from jsonb_array_elements(public.get_my_bookings('upcoming')) b),
  jsonb_build_array(tests.id('up'), tests.id('up2')), 'upcoming: their own bookings');
select is(public.get_my_bookings('upcoming') #>> '{0,staff_first_name}', 'Rina',
  'staff first name even for internal staff on their own booking…');
select is(public.get_my_bookings('upcoming') #>> '{0,staff_id}', null, '…but never the internal staff id');
select is(jsonb_array_length(public.get_my_bookings('past')), 3, 'past: completed and no-shows');
select ok((public.get_my_booking(tests.id('up')) -> 'timeline') is not null, 'booking detail with timeline');
select is(public.get_my_next_booking_at(tests.id('biz')) ->> 'id', tests.id('up')::text, '"You''re booked" banner data');
select tests.act_as('other');
select throws_ok($$ select public.get_my_booking(tests.id('up')) $$, 'P0001', 'FORBIDDEN', 'someone else''s booking');
select tests.act_as('moe', 'aal1', true);
select throws_ok($$ select public.get_my_bookings() $$, 'P0001', 'AUTH_REQUIRED', 'anonymous visitors must verify their phone');

-- ═══ reschedule with "Any available" ═══
select tests.act_as('moe');
select is((select staff_first_name from public.preview_reschedule_any(tests.id('up2'), tests.at(tests.day(3), '14:00'))), 'Lea',
  'preview: the business rule picks a free public staff member (least booked that day)');
select lives_ok($$ select public.reschedule_my_booking_any(tests.id('up2'), tests.at(tests.day(3), '14:00'), tests.id('Lea Public')) $$,
  'confirm the new time with that person');
select tests.as_postgres();
select results_eq($$ select b.starts_at, bi.staff_id, bi.selection_mode::text, bi.requested_staff_id, bi.assignment_rule_used is not null
                     from public.bookings b join public.booking_items bi on bi.booking_id = b.id where b.id = tests.id('up2') $$,
                  $$ values (tests.at(tests.day(3), '14:00'), tests.id('Lea Public'), 'any', null::uuid, true) $$,
  'moved atomically to a concrete staff member, still an Any booking');
select tests.visit('lea_busy', 'biz', 'Lea Public', 'Cut', 'moe_rec', tests.at(tests.day(3), '16:00'), 'confirmed');
select tests.act_as('moe');
select throws_ok($$ select public.reschedule_my_booking_any(tests.id('up2'), tests.at(tests.day(3), '16:00'), tests.id('Lea Public')) $$,
  'P0001', 'STAFF_NOT_FREE', 'a previewed person who is no longer free is refused (preview again)');
select throws_ok($$ select * from public.preview_reschedule_any(tests.id('up'), tests.at(tests.day(3), '12:00')) $$,
  'P0001', 'NOT_SUPPORTED', 'booking with internal-only staff: contact the business instead');
select tests.act_as('other');
select throws_ok($$ select * from public.preview_reschedule_any(tests.id('up2'), tests.at(tests.day(3), '12:00')) $$,
  'P0001', 'FORBIDDEN', 'someone else''s booking');

-- ═══ no-show contest ═══
select tests.act_as('moe');
select throws_ok($$ select public.contest_no_show(tests.id('ns'), 'no') $$, 'P0001', 'REASON_REQUIRED', 'a short statement is required');
select throws_ok($$ select public.contest_no_show(tests.id('ns_old'), 'I was there on time') $$, 'P0001', 'OUTSIDE_WINDOW', '7-day window');
select lives_ok($$ select public.contest_no_show(tests.id('ns'), 'I was there on time, paid cash') $$, 'contest within 7 days');
select throws_ok($$ select public.contest_no_show(tests.id('ns'), 'Again please') $$, 'P0001', 'TRANSITION_NOT_ALLOWED', 'only once');
select tests.as_postgres();
select results_eq($$ select b.no_show_disputed, d.status::text, (select count(*)::int from public.booking_events e where e.booking_id = b.id and e.event = 'no_show_contested')
                     from public.bookings b join public.disputes d on d.booking_id = b.id where b.id = tests.id('ns') $$,
                  $$ values (true, 'open', 1) $$, 'dispute opened for support, booking marked disputed, event logged');

select * from finish();
rollback;
