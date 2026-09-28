-- Phase 3 Part 2 §2.2–2.3, Part 1 P10 — business customers, attribution, shadows, notes
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(10);

select tests.new_user('owner_a');
select tests.new_user('owner_b');
select tests.new_user('moe', '96170123456');
select tests.new_business('biz_a', 'owner_a');
select tests.new_business('biz_b', 'owner_b');

insert into public.business_customers (id, business_id, phone_e164, display_name, acquired_via)
values ('11111111-1111-1111-1111-111111111111', tests.id('biz_a'), '+96170123456', 'Moe (walk-in)', 'manual');

-- attribution is immutable
select throws_ok($$ update public.business_customers set acquired_via = 'marketplace'
                    where id = '11111111-1111-1111-1111-111111111111' $$,
  'P0001', 'IMMUTABLE_FIELD', 'acquired_via cannot change');

-- active shadows are unique by phone per business
select throws_ok($$ insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
                    values (tests.id('biz_a'), '+96170123456', 'Moe again', 'manual') $$,
  '23505', null, 'duplicate active shadow phone rejected');
select lives_ok($$ insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
                   values (tests.id('biz_b'), '+96170123456', 'Moe at B', 'manual') $$,
  'same phone at another business is a separate record');

-- a claimed record may share the phone snapshot with an unclaimed shadow (no auto-merge)
select lives_ok($$ insert into public.business_customers (business_id, user_id, phone_e164, display_name, acquired_via)
                   values (tests.id('biz_a'), tests.id('moe'), '+96170123456', 'Moe', 'manual') $$,
  'user record can coexist with the unclaimed shadow (explicit claim model)');
select throws_ok($$ insert into public.business_customers (business_id, user_id, display_name, acquired_via)
                    values (tests.id('biz_a'), tests.id('moe'), 'Moe dup', 'marketplace') $$,
  '23505', null, 'one record per user per business');

-- merge bookkeeping
select throws_ok($$ update public.business_customers
                    set merged_into_id = (select id from public.business_customers where user_id = tests.id('moe'))
                    where id = '11111111-1111-1111-1111-111111111111' $$,
  '23514', null, 'a merged shadow must be archived in the same change');
select lives_ok($$ update public.business_customers
                   set merged_into_id = (select id from public.business_customers where user_id = tests.id('moe')),
                       archived_at = now()
                   where id = '11111111-1111-1111-1111-111111111111' $$,
  'merge into the claimed record (archived shadow)');
select lives_ok($$ insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
                   values (tests.id('biz_a'), '+96170123456', 'New walk-in', 'manual') $$,
  'archived shadow no longer blocks a new shadow with that phone');
select throws_ok($$ insert into public.business_customers (business_id, display_name, acquired_via, claimed_at)
                    values (tests.id('biz_a'), 'Ghost', 'manual', now()) $$,
  '23514', null, 'claimed_at requires a user');

-- notes can't cross tenants
select throws_ok($$ insert into public.customer_notes (business_id, business_customer_id, author_user_id, body)
                    values (tests.id('biz_b'), '11111111-1111-1111-1111-111111111111', tests.id('owner_b'), 'x') $$,
  '23503', null, 'a note cannot attach to another business''s customer');

select * from finish();
rollback;
