-- Phase 3 Part 6 §7, Part 2 §1.1, M4 plan — OTP routing & limits (Send SMS Hook), get_my_access,
-- account deletion job, what anonymous sessions cannot do
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(33);

create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.as_service() to anon, authenticated, service_role;
grant usage on schema tests to service_role;
grant select on tests.ids to service_role;
grant execute on all functions in schema tests to service_role;

-- ═══ the hook's functions are server-only ═══
select ok(not has_function_privilege('anon', 'public.otp_route(text, text[], text)', 'execute')
          and not has_function_privilege('authenticated', 'public.otp_route(text, text[], text)', 'execute')
          and not has_function_privilege('authenticated', 'public.otp_mark(uuid, text, text, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.otp_status_update(text, text, text, text, timestamptz)', 'execute'),
  'clients cannot call OTP routing or delivery functions');
select ok(has_function_privilege('service_role', 'public.otp_route(text, text[], text)', 'execute'),
  'the Send SMS Hook (service_role) can');

-- ═══ routing: WhatsApp first, SMS on "send by SMS instead", foreign numbers WhatsApp-only ═══
select tests.as_service();
create temp table r (k text primary key, v jsonb);
grant all on r to service_role;
insert into r values ('first', public.otp_route('96170123123'));
select results_eq($$ select v ->> 'channel', (v ->> 'allowed')::boolean, v ->> 'phone' from r where k = 'first' $$,
                  $$ values ('whatsapp', true, '+96170123123') $$, 'first code goes to WhatsApp');
select is((public.otp_route('12')) ->> 'reason', 'INVALID_PHONE', 'garbage number rejected');
select lives_ok($$ select public.otp_mark((select (v ->> 'delivery_id')::uuid from r where k = 'first'), 'sent', 'whatsapp', 'wamid.1') $$,
  'hook records the provider result');
select tests.as_postgres();
update private.otp_deliveries set created_at = now() - interval '35 seconds' where phone_e164 = '+96170123123';
select tests.as_service();
select is((public.otp_route('96170123123')) ->> 'channel', 'sms',
  'asking again after 30 s (Send by SMS instead) switches to SMS');
select is((public.otp_route('96170123123', '{+961}', 'sms')) ->> 'channel', 'sms', 'hook can force SMS after a WhatsApp error');
insert into r values ('fr', public.otp_route('33612345678'));
select results_eq($$ select v ->> 'channel', (v ->> 'sms_available')::boolean from r where k = 'fr' $$,
                  $$ values ('whatsapp', false) $$, 'foreign number: WhatsApp, SMS fallback not available');
select tests.as_postgres();
update private.otp_deliveries set created_at = now() - interval '35 seconds' where phone_e164 = '+33612345678';
select tests.as_service();
select is((public.otp_route('33612345678')) ->> 'channel', 'whatsapp', 'foreign number stays on WhatsApp when asking again');
select is((public.otp_route('33612345678', '{+961}', 'sms')) ->> 'reason', 'SMS_NOT_AVAILABLE', 'and SMS cannot be forced for it');

-- per-number limits: 5 per 15 minutes, 10 per day (fallbacks don't count)
select tests.as_postgres();
insert into private.otp_deliveries (phone_e164, channel, created_at)
select '+96171000000', 'whatsapp', now() - make_interval(mins => g) from generate_series(1, 5) g;
insert into private.otp_deliveries (phone_e164, channel, created_at)
select '+96171000001', 'whatsapp', now() - make_interval(hours => g) from generate_series(1, 10) g;
select tests.as_service();
select is((public.otp_route('96171000000')) ->> 'reason', 'OTP_TOO_MANY', '6th code in 15 minutes refused');
select is((public.otp_route('96171000001')) ->> 'reason', 'OTP_TOO_MANY', '11th code in 24 hours refused');

-- delivery receipts
select is(public.otp_status_update('whatsapp', 'wamid.1', 'delivered', null, now()), true, 'receipt matched by provider message id');
select is(public.otp_status_update('whatsapp', 'wamid.1', 'sent'), true, 'late "sent" receipt accepted...');
select tests.as_postgres();
select results_eq($$ select status, delivered_at is not null from private.otp_deliveries where provider_message_id = 'wamid.1' $$,
                  $$ values ('delivered', true) $$, '...but status never moves backwards');
select tests.as_service();
select is(public.otp_status_update('whatsapp', 'unknown', 'delivered'), false, 'unknown message ignored');
select tests.as_postgres();

-- ═══ get_my_access ═══
select tests.new_user('owner', '96170100100');  select tests.new_user('opsadmin', '96170600600');
select tests.new_user('visitor');
select tests.new_business('biz', 'owner');
insert into public.admin_users (user_id, role) values (tests.id('opsadmin'), 'ops');
select tests.as_anon();
select throws_ok($$ select public.get_my_access() $$, '42501', null, 'logged out: no access summary (no grant)');
select tests.act_as('visitor', 'aal1', true);
select results_eq($$ select (a ->> 'is_anonymous')::boolean, (a ->> 'phone_verified')::boolean, jsonb_array_length(a -> 'memberships')
                     from public.get_my_access() a $$,
                  $$ values (true, false, 0) $$, 'anonymous visitor: no phone, no memberships');
select tests.act_as('owner');
select results_eq($$ select a #>> '{memberships,0,role}', a #>> '{memberships,0,business_name}', a ->> 'phone_hint'
                     from public.get_my_access() a $$,
                  $$ values ('owner', 'Business biz', '+961 70 ••• 100') $$, 'owner sees their business and role');
select tests.act_as('opsadmin', 'aal1');
select results_eq($$ select a ->> 'admin_role', (a ->> 'admin_mfa_ok')::boolean from public.get_my_access() a $$,
                  $$ values ('ops', false) $$, 'admin at aal1: told MFA is still needed');
select throws_ok($$ select * from public.admin_otp_delivery_stats() $$, 'P0001', 'FORBIDDEN', 'and admin RPCs refuse aal1');
select tests.act_as('opsadmin', 'aal2');
select is((select (a ->> 'admin_mfa_ok')::boolean from public.get_my_access() a), true, 'admin at aal2: MFA ok');
select ok((select count(*) >= 2 from public.admin_otp_delivery_stats()), 'ops reads OTP delivery stats (per channel)');

-- ═══ anonymous sessions can't do customer actions ═══
select tests.act_as('visitor', 'aal1', true);
select throws_ok($$ select * from public.get_claimable_visits() $$, 'P0001', 'AUTH_REQUIRED', 'anonymous: no claim offers');
select throws_ok($$ select public.delete_my_account() $$, 'P0001', 'AUTH_REQUIRED', 'anonymous: no account deletion');
select throws_ok($$ select public.invite_member(tests.id('biz'), '70 123 456', 'staff') $$, 'P0001', 'AUTH_REQUIRED',
  'anonymous: no team actions');
update public.profiles set first_name = 'X' where id = tests.id('visitor');   -- RLS: no row qualifies
select tests.as_postgres();
select ok((select first_name is null from public.profiles where id = tests.id('visitor')), 'anonymous: cannot edit a profile');

-- ═══ account deletion (skeleton job) ═══
select tests.new_user('dina', '96170808080');
select tests.new_user('other_owner');
select tests.new_business('biz2', 'other_owner');
select tests.new_staff('biz2', 'Tony');  select tests.new_service('biz2', 'Cut');  select tests.link('biz2', 'Tony', 'Cut');
select tests.customer_record('dina_rec', 'biz2', 'Dina', '+96170808080', 'dina');
select tests.visit('dina_future', 'biz2', 'Tony', 'Cut', 'dina_rec', tests.at(tests.day(5), '10:00'), 'confirmed');
update public.bookings set customer_user_id = tests.id('dina') where id = tests.id('dina_future');
select tests.add_member('biz', 'dina', 'reception');
select tests.act_as('dina');
select is((public.delete_my_account()) ->> 'status', 'requested', 'customer requests deletion');
select tests.act_as('owner');
select lives_ok($$ select public.delete_my_account() $$, 'an owner can request it too...');
select tests.as_postgres();
select is(private.job_process_account_deletions(), 1, 'the job processes the customer');
select results_eq(
  $$ select p.status::text, p.phone_e164, p.first_name,
            (select status::text from public.bookings where id = tests.id('dina_future')),
            (select user_id from public.business_customers where id = tests.id('dina_rec')),
            (select status::text from public.business_members where business_id = tests.id('biz') and user_id = tests.id('dina'))
     from public.profiles p where p.id = tests.id('dina') $$,
  $$ values ('deleted', null::text, null::text, 'cancelled', null::uuid, 'revoked') $$,
  'profile anonymized, future booking cancelled, business keeps its record (unlinked), memberships revoked');
select is((select status from private.account_deletions where user_id = tests.id('owner')), 'needs_support',
  '...but an active owner is routed to support first');

-- ═══ OTP data retention ═══
update private.otp_deliveries set created_at = now() - interval '31 days' where phone_e164 = '+96171000001';
select is(private.job_otp_cleanup(), 10, 'OTP delivery rows older than 30 days are deleted');

select * from finish();
rollback;
