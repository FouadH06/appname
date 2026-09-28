-- Phase 3 Part 7 §5 #27 — exhaustive state machine: every (from, to, actor) matches the transition table
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
select plan(4);

-- assert_transition accepts exactly the listed triples and rejects every other combination
create temp table combos as
select f.s as from_status, t.s as to_status, a.k as actor,
       exists (select 1 from private.booking_transitions bt
               where bt.from_status = f.s and bt.to_status = t.s and bt.actor = a.k) as expected
from unnest(enum_range(null::public.booking_status)) f(s)
cross join unnest(enum_range(null::public.booking_status)) t(s)
cross join unnest(enum_range(null::public.actor_kind)) a(k);

create function pg_temp.accepted(p_from public.booking_status, p_to public.booking_status, p_actor public.actor_kind)
returns boolean language plpgsql as $$
begin
  perform private.assert_transition(p_from, p_to, p_actor);
  return true;
exception when sqlstate 'P0001' then
  return false;
end $$;

select is((select count(*)::int from combos), 144, '6 statuses × 6 statuses × 4 actors = 144 combinations checked');
select is((select count(*)::int from combos where pg_temp.accepted(from_status, to_status, actor) <> expected), 0,
  'assert_transition matches the transition table for all 144 combinations');
select is((select count(*)::int from combos where expected), 17, '17 allowed transitions (Part 3 §1.4)');
select ok(not exists (select 1 from combos where expected and to_status = 'held'),
  'nothing ever transitions back to held');

select * from finish();
rollback;
