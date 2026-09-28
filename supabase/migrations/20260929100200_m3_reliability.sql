-- M3 · Customer reliability (internal score; businesses see a coarse label only)
-- Spec: Phase 3 Part 2 §2.4, locked decision H (recency-weighted, one emergency never labels you)

create table private.reliability_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  booking_id   uuid references public.bookings(id) on delete set null,
  kind         text not null check (kind in ('no_show', 'late_cancel', 'completed', 'forgiven', 'dispute_overturned')),
  weight       numeric(4,2) not null,
  occurred_at  timestamptz not null,
  created_by   uuid,
  note         text
);
create index on private.reliability_events (user_id, occurred_at desc);
create index on private.reliability_events (booking_id);

create table private.customer_reliability (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  score        numeric(6,3) not null default 0,
  tier         public.reliability_tier not null default 'new',
  computed_at  timestamptz not null default now()
);

-- score = Σ weight × 0.5^(age_days/60) over 180 days; completed visits (negative weight) are
-- capped at −1.0 in total; floored at 0.
-- tier: new (<2 completed and score < 1.5) · reliable (< 1.5) · some_missed (< 2.5)
--       · restricted (< 4, online bookings become requests) · blocked (≥ 4, admin review)
create function private.recompute_reliability(p_user_id uuid) returns public.reliability_tier
language plpgsql security definer set search_path = '' as $$
declare
  v_penalties numeric; v_reversals numeric; v_credit numeric; v_completed int;
  v_score numeric; v_tier public.reliability_tier;
begin
  -- decayed(e) = weight × 0.5^(age_days / 60)
  select coalesce(sum(d) filter (where kind in ('no_show', 'late_cancel')), 0),        -- positive
         coalesce(sum(d) filter (where kind in ('forgiven', 'dispute_overturned')), 0), -- exact reversals (negative)
         coalesce(sum(d) filter (where kind = 'completed'), 0),                        -- negative
         count(*) filter (where kind = 'completed')
    into v_penalties, v_reversals, v_credit, v_completed
  from (select e.kind,
               e.weight * power(0.5, extract(epoch from (now() - e.occurred_at)) / 86400.0 / 60.0) as d
        from private.reliability_events e
        where e.user_id = p_user_id and e.occurred_at > now() - interval '180 days') s;

  -- completed visits help, but never by more than 1.0 in total
  v_score := greatest(0, v_penalties + v_reversals + greatest(-1.0, v_credit));

  v_tier := (case
    when v_completed < 2 and v_score < 1.5 then 'new'
    when v_score < 1.5 then 'reliable'
    when v_score < 2.5 then 'some_missed'
    when v_score < 4   then 'restricted'
    else 'blocked'
  end)::public.reliability_tier;

  insert into private.customer_reliability (user_id, score, tier, computed_at)
  values (p_user_id, round(v_score, 3), v_tier, now())
  on conflict (user_id) do update set score = excluded.score, tier = excluded.tier, computed_at = excluded.computed_at;
  return v_tier;
end $$;

create function private.add_reliability_event(p_user_id uuid, p_booking_id uuid, p_kind text,
                                              p_occurred_at timestamptz default now(), p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then
    return;                                   -- shadow customers have no platform reliability
  end if;
  insert into private.reliability_events (user_id, booking_id, kind, weight, occurred_at, created_by, note)
  values (p_user_id, p_booking_id, p_kind,
          case p_kind when 'no_show' then 1.0 when 'late_cancel' then 0.4 when 'completed' then -0.15
                      when 'forgiven' then -1.0 when 'dispute_overturned' then -1.0 end,
          p_occurred_at, private.uid(), p_note);
  perform private.recompute_reliability(p_user_id);
end $$;

create function private.reliability_tier(p_user_id uuid) returns public.reliability_tier
language sql stable security definer set search_path = '' as $$
  select coalesce((select tier from private.customer_reliability where user_id = p_user_id), 'new')
$$;

-- The ONLY reliability information a business ever sees (Part 2 §2.4): a coarse label, and only
-- for a customer who has a record at one of the caller's businesses. Never where/when misses happened.
create function public.customer_reliability_label(p_user_id uuid) returns public.reliability_label
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.business_customers bc
                 where bc.user_id = p_user_id
                   and bc.business_id in (select private.my_business_ids('{owner,manager,reception}'))) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  return (case private.reliability_tier(p_user_id)
           when 'new' then 'new_customer'
           when 'reliable' then 'reliable'
           else 'some_missed_appointments'
         end)::public.reliability_label;
end $$;

revoke execute on function public.customer_reliability_label(uuid) from public, anon;
grant execute on function public.customer_reliability_label(uuid) to authenticated;

select private.assign_app_ownership();
