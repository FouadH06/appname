-- Phase 3 Part 2 §2.4, Part 7 §6 — reliability: recency-weighted, forgiving, coarse label only
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(13);

create function tests.events(p_user text, p_kind text, p_n int, p_age interval default '1 day') returns void
language sql as $$
  insert into private.reliability_events (user_id, kind, weight, occurred_at)
  select tests.id(p_user), p_kind,
         case p_kind when 'no_show' then 1.0 when 'late_cancel' then 0.4 when 'completed' then -0.15 else -1.0 end,
         now() - p_age
  from generate_series(1, p_n)
$$;
create function tests.tier(p_user text) returns text language sql as
  $$ select private.recompute_reliability(tests.id(p_user))::text $$;

select tests.new_user('fresh');   select tests.new_user('one_miss');  select tests.new_user('regular');
select tests.new_user('two_miss'); select tests.new_user('old_miss'); select tests.new_user('forgiven');
select tests.new_user('serial');  select tests.new_user('blocked');   select tests.new_user('loyal');

select is(tests.tier('fresh'), 'new', 'no history → new');

select tests.events('one_miss', 'no_show', 1);
select is(tests.tier('one_miss'), 'new', 'ONE no-show never produces a negative label (genuine emergency)');

select tests.events('regular', 'completed', 2); select tests.events('regular', 'no_show', 1);
select is(tests.tier('regular'), 'reliable', 'regular customer with one miss stays reliable');

select tests.events('two_miss', 'no_show', 2);
select is(tests.tier('two_miss'), 'some_missed', 'two recent no-shows → some missed');

select tests.events('old_miss', 'no_show', 2, '150 days');
select is(tests.tier('old_miss'), 'new', 'the same two no-shows 150 days ago have decayed away');

select tests.events('forgiven', 'no_show', 2); select tests.events('forgiven', 'forgiven', 1);
select is(tests.tier('forgiven'), 'new', 'a forgiven no-show is an exact reversal');

select tests.events('serial', 'no_show', 3);
select is(tests.tier('serial'), 'restricted', 'three recent no-shows → restricted (requests only)');

select tests.events('blocked', 'no_show', 5);
select is(tests.tier('blocked'), 'blocked', 'five recent no-shows → blocked');

select tests.events('loyal', 'completed', 20); select tests.events('loyal', 'no_show', 3);
select is(tests.tier('loyal'), 'some_missed', 'completed visits help but their credit is capped at 1.0');
select ok((select score from private.customer_reliability where user_id = tests.id('loyal')) between 1.9 and 2.0,
  'capped credit: ≈ 2.97 − 1.0');

-- ─── the label is all a business ever sees ───
select tests.new_user('owner_a'); select tests.new_user('owner_b');
select tests.new_business('biz_a', 'owner_a'); select tests.new_business('biz_b', 'owner_b');
insert into public.business_customers (business_id, user_id, display_name, acquired_via)
values (tests.id('biz_a'), tests.id('two_miss'), 'Customer', 'marketplace');

select tests.act_as('owner_a');
select is(public.customer_reliability_label(tests.id('two_miss'))::text, 'some_missed_appointments',
  'a business with this customer sees only the coarse label');
select tests.as_postgres();
select tests.act_as('owner_b');
select throws_ok($$ select public.customer_reliability_label(tests.id('two_miss')) $$, 'P0001', 'FORBIDDEN',
  'a business without this customer sees nothing');
select throws_ok($$ select * from private.reliability_events $$, '42501', null,
  'the raw history is never readable by clients');
select tests.as_postgres();

select * from finish();
rollback;
