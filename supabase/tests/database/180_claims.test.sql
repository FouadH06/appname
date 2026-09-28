-- Phase 3 Part 2 §2.3, Part 3 §4.2, Part 7 §6 (34–40) — explicit claim model, access tokens,
-- offers, safe merge, recycled numbers, phone change
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(41);

-- ─── fixtures ───
select tests.new_user('owner_a');  select tests.new_user('owner_b');  select tests.new_user('owner_c');
select tests.new_user('rita', '96170222222');
select tests.new_user('prev', '96170999000');       -- previous holder of a recycled number (see biz_c)
select tests.new_user('nophone');
select tests.new_user('visitor');
select tests.new_user('lara', '96170555555');
select tests.new_business('biz_a', 'owner_a');
select tests.new_business('biz_b', 'owner_b');
select tests.new_business('biz_c', 'owner_c');
select tests.open_every_day('biz_b', 0, 1440);
select tests.new_staff('biz_a', 'Karim');  select tests.new_service('biz_a', 'Cut A');  select tests.link('biz_a', 'Karim', 'Cut A');
select tests.new_staff('biz_b', 'Joe');    select tests.new_service('biz_b', 'Cut B');  select tests.link('biz_b', 'Joe', 'Cut B');
select tests.staff_every_day('biz_b', 'Joe', 0, 1440);
select tests.new_staff('biz_c', 'Rami');   select tests.new_service('biz_c', 'Cut C');  select tests.link('biz_c', 'Rami', 'Cut C');

-- Shadows for Moe's number (+96170111111) at three businesses, BEFORE Moe has an account
select tests.customer_record('sh_a', 'biz_a', 'Mohammad', '+96170111111');
select tests.customer_record('sh_b', 'biz_b', 'Moe B',    '+96170111111');
select tests.customer_record('sh_c', 'biz_c', 'Moe C',    '+96170111111', 'prev');   -- claimed by the number's previous owner
select tests.visit('a1', 'biz_a', 'Karim', 'Cut A', 'sh_a', tests.at(tests.day(-3),   '10:00'));
select tests.visit('a2', 'biz_a', 'Karim', 'Cut A', 'sh_a', tests.at(tests.day(-40),  '10:00'));
select tests.visit('a_old', 'biz_a', 'Karim', 'Cut A', 'sh_a', tests.at(tests.day(-400), '10:00'));
select tests.visit('b1', 'biz_b', 'Joe', 'Cut B', 'sh_b', tests.at(tests.day(-10),  '11:00'));
select tests.visit('b2', 'biz_b', 'Joe', 'Cut B', 'sh_b', tests.at(tests.day(-70),  '11:00'));
select tests.visit('b_old', 'biz_b', 'Joe', 'Cut B', 'sh_b', tests.at(tests.day(-500), '11:00'));
select tests.visit('c1', 'biz_c', 'Rami', 'Cut C', 'sh_c', tests.at(tests.day(-5),   '12:00'));

-- ═══ 34. phone verification links nothing ═══
select tests.new_user('moe', '96170111111');                                       -- OTP-verified account appears
update auth.users set phone_confirmed_at = now() where id = tests.id('moe');       -- and verifies again
select is((select count(*)::int from public.business_customers
           where phone_e164 = '+96170111111' and user_id = tests.id('moe')), 0,
  'verifying the phone links no customer record');
select is((select count(*)::int from public.bookings where customer_user_id = tests.id('moe')), 0,
  'verifying the phone links no booking');
select is((select phone_e164 from public.profiles where id = tests.id('moe')), '+96170111111',
  'the profile only mirrors the verified phone');

-- Tokens (the notification sender issues these in M7)
create table tests.tok (name text primary key, token text);
grant select on tests.tok to anon, authenticated;
insert into tests.tok values
  ('a1',      private.issue_access_token('claim_visit', tests.id('a1'))),
  ('manage',  private.issue_access_token('manage_booking', tests.id('a2'))),
  ('expired', private.issue_access_token('claim_visit', tests.id('a2'), now() - interval '1 minute')),
  ('old',     private.issue_access_token('claim_visit', tests.id('a_old'), now() + interval '1 day'));

-- ═══ resolve_access_token: summary only, never claims ═══
select tests.as_anon();
select results_eq(
  $$ select r ->> 'purpose', r ->> 'phone_hint', (r ->> 'claimable')::boolean, r #>> '{booking,business_name}'
     from public.resolve_access_token((select token from tests.tok where name = 'a1')) r $$,
  $$ values ('claim_visit', '+961 70 ••• 111', true, 'Business biz_a') $$,
  'logged-out visitor resolves a claim link: purpose, masked phone, business');
select throws_ok($$ select public.resolve_access_token('not-a-token') $$, 'P0001', 'TOKEN_INVALID',
  'unknown token rejected');
select tests.as_postgres();
select ok((select customer_user_id is null from public.bookings where id = tests.id('a1')),
  'resolving a token claims nothing');

-- ═══ 35. claim_booking(token) ═══
select tests.act_as('visitor', 'aal1', true);
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'a1')) $$,
  'P0001', 'AUTH_REQUIRED', 'anonymous caller cannot claim');
select tests.act_as('nophone');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'a1')) $$,
  'P0001', 'PHONE_NOT_VERIFIED', 'caller without a verified phone cannot claim');
select tests.act_as('rita');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'a1')) $$,
  'P0001', 'CLAIM_PHONE_MISMATCH', 'another verified number cannot claim');
select tests.act_as('moe');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'manage')) $$,
  'P0001', 'TOKEN_INVALID', 'a manage-booking link is not a claim link');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'expired')) $$,
  'P0001', 'TOKEN_EXPIRED', 'expired claim link rejected');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'old')) $$,
  'P0001', 'CLAIM_TOO_OLD', 'visits older than 12 months cannot be claimed');
select lives_ok($$ select public.claim_booking((select token from tests.tok where name = 'a1')) $$,
  'Moe claims the visit from his link');
select tests.as_postgres();
select is((select customer_user_id from public.bookings where id = tests.id('a1')), tests.id('moe'),
  'that booking is now in Moe''s account');
select is((select user_id from public.business_customers where id = tests.id('sh_a')), tests.id('moe'),
  'the business relationship is claimed');
select ok((select customer_user_id is null from public.bookings where id = tests.id('a2')),
  'other visits at the same business stay unlinked until offered and confirmed');
select is((select data ->> 'via' from public.booking_events where booking_id = tests.id('a1') and event = 'claimed'),
  'token', 'claim event recorded');
select tests.act_as('moe');
select is((public.claim_booking((select token from tests.tok where name = 'a1')) ->> 'already_claimed')::boolean, true,
  'retrying the same link is idempotent');
select tests.act_as('rita');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'a1')) $$,
  'P0001', 'TOKEN_USED', 'a used link cannot be used by anyone else');

-- ═══ 36. offers reveal the minimum ═══
select tests.act_as('moe');
select set_eq($$ select business_id from public.get_claimable_visits() $$,
              $$ values (tests.id('biz_a')), (tests.id('biz_b')) $$,
  'offers: businesses with unlinked visits for his number (not biz_c, claimed by the number''s previous owner)');
select results_eq(
  $$ select business_name, visit_count, latest_month from public.get_claimable_visits() where business_id = tests.id('biz_b') $$,
  $$ values ('Business biz_b', 2, date_trunc('month', tests.day(-10))::date) $$,
  'an offer shows name, count (only ≤ 12 months) and latest month');
select is((select array_agg(u.n order by u.i)
           from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) with ordinality as u(n, m, i)
           where p.oid = 'public.get_claimable_visits'::regproc and u.m = 't'),
          array['business_id', 'business_name', 'area_name', 'visit_count', 'latest_month'],
  'no services, staff, prices or exact dates in offers');

-- dismissal hides a business until a newer visit exists
select lives_ok($$ select public.dismiss_claimable_visits(array[tests.id('biz_a')]) $$, 'Moe dismisses biz_a');
select ok(not exists (select 1 from public.get_claimable_visits() where business_id = tests.id('biz_a')),
  'dismissed business no longer offered');
select tests.as_postgres();
update private.claim_dismissals set dismissed_at = now() - interval '1 hour' where user_id = tests.id('moe');
select tests.visit('a3', 'biz_a', 'Karim', 'Cut A', 'sh_a', tests.at(tests.day(-1), '15:00'));
select tests.act_as('moe');
select is((select visit_count from public.get_claimable_visits() where business_id = tests.id('biz_a')), 2,
  'a visit recorded after the dismissal brings the offer back');

-- ═══ 37. claim_visits links only confirmed businesses ═══
select is(((public.claim_visits(array[tests.id('biz_b')])) #>> array['claimed', tests.id('biz_b')::text])::int, 2,
  'confirming biz_b links its two recent visits');
select tests.as_postgres();
select ok((select customer_user_id is null from public.bookings where id = tests.id('b_old')),
  'the >12-month visit is never linked');
select ok((select customer_user_id is null from public.bookings where id = tests.id('a2')),
  'biz_a (not confirmed) is untouched');
select is((select user_id from public.business_customers where id = tests.id('sh_b')), tests.id('moe'),
  'biz_b relationship claimed');

-- ═══ 38. safe merge ═══
select tests.customer_record('lara_own', 'biz_a', 'Lara K', '+96170555555', 'lara');          -- booked online before
select tests.customer_record('lara_sh',  'biz_a', 'Lara Khoury', '+96170555555');             -- reception's shadow
select tests.visit('l_own', 'biz_a', 'Karim', 'Cut A', 'lara_own', tests.at(tests.day(-20),  '09:00'));
select tests.visit('l1',    'biz_a', 'Karim', 'Cut A', 'lara_sh',  tests.at(tests.day(-30),  '09:00'));
select tests.visit('l0',    'biz_a', 'Karim', 'Cut A', 'lara_sh',  tests.at(tests.day(-450), '09:00'));
update public.bookings set customer_user_id = tests.id('lara') where id = tests.id('l_own');
insert into public.customer_notes (business_id, business_customer_id, author_user_id, body)
values (tests.id('biz_a'), tests.id('lara_sh'), tests.id('owner_a'), 'Prefers short sides');
insert into private.possible_duplicates (business_id, a_id, b_id)
values (tests.id('biz_a'), least(tests.id('lara_own'), tests.id('lara_sh')), greatest(tests.id('lara_own'), tests.id('lara_sh')));
select tests.act_as('lara');
select lives_ok($$ select public.claim_visits(array[tests.id('biz_a')]) $$, 'Lara confirms her biz_a visits');
select tests.as_postgres();
select results_eq(
  $$ select merged_into_id, archived_at is not null from public.business_customers where id = tests.id('lara_sh') $$,
  $$ values (tests.id('lara_own'), true) $$,
  'the shadow is merged into her record and archived');
select is((select count(*)::int from public.bookings where business_customer_id = tests.id('lara_own')), 3,
  'all the shadow''s bookings are re-pointed to the surviving record (history stays with the business)');
select results_eq(
  $$ select (select customer_user_id from public.bookings where id = tests.id('l1')),
            (select customer_user_id from public.bookings where id = tests.id('l0')) $$,
  $$ values (tests.id('lara'), null::uuid) $$,
  'only the claimed ≤12-month visit is linked to her account');
select results_eq(
  $$ select count(*) filter (where not is_system)::int, count(*) filter (where is_system and body = 'Also known as Lara Khoury')::int
     from public.customer_notes where business_customer_id = tests.id('lara_own') $$,
  $$ values (1, 1) $$,
  'notes re-pointed, plus an "Also known as" system note');
select results_eq(
  $$ select bc.visit_count, bc.display_name,
            (select resolved_at is not null from private.possible_duplicates where business_id = tests.id('biz_a'))
     from public.business_customers bc where bc.id = tests.id('lara_own') $$,
  $$ values (3, 'Lara K', true) $$,
  'stats recomputed, business-entered name kept, duplicate flag resolved');

-- ═══ 40. after a claim, new manual bookings link automatically ═══
select tests.act_as('owner_b');
select is((public.create_manual_booking(tests.id('biz_b_loc'), jsonb_build_object('business_customer_id', tests.id('sh_b')),
                                        tests.id('Cut B'), tests.id('Joe'), tests.at(tests.day(3), '13:00'))).customer_user_id,
          tests.id('moe'), 'manual booking on a claimed relationship lands in the customer''s account');
select tests.as_postgres();

-- ═══ phone change links nothing and moves offers to the new number ═══
select tests.as_postgres();
update auth.users set phone = '96170777777', phone_confirmed_at = now() where id = tests.id('moe');
select is((select count(*)::int from public.bookings where customer_user_id = tests.id('moe')), 4,
  'changing phone adds no links (a1, b1, b2, and the new manual booking)');
insert into tests.tok values ('a3', private.issue_access_token('claim_visit', tests.id('a3')));
select tests.act_as('moe');
select is((select count(*)::int from public.get_claimable_visits()), 0,
  'offers follow the current verified number');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'a3')) $$,
  'P0001', 'CLAIM_PHONE_MISMATCH', 'a link for his old number no longer matches');
select tests.as_postgres();

-- ═══ recycled number: a record claimed by someone else is never offered or claimable ═══
insert into tests.tok values ('c1', private.issue_access_token('claim_visit', tests.id('c1')));
update auth.users set phone = '96170111111', phone_confirmed_at = now() where id = tests.id('rita');   -- Rita now has that number
select tests.act_as('rita');
select ok(not exists (select 1 from public.get_claimable_visits() where business_id = tests.id('biz_c')),
  'records claimed by the number''s previous owner are not offered');
select throws_ok($$ select public.claim_booking((select token from tests.tok where name = 'c1')) $$,
  'P0001', 'CLAIM_CONFLICT', 'and cannot be claimed');
select tests.as_postgres();

select * from finish();
rollback;
