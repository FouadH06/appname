-- M6 · Gate B instrumentation: how long reception takes to log an appointment
-- Target (Phase 4 M6 DoD): median manual booking creation < 15 s in real pilot use.
-- Privacy: operational data only — no customer name, phone, notes or free text. The duration is
-- measured on the device with a monotonic clock (drawer opened → booking saved); the server
-- stamps saved_at from the booking itself and derives opened_at, so device clock skew doesn't
-- matter. One row per booking, written only by the person who created it, right after saving.

create table private.booking_creation_timings (
  booking_id     uuid primary key references public.bookings(id) on delete cascade,
  business_id    uuid not null references public.businesses(id),
  actor_role     public.business_role not null,
  customer_kind  text not null check (customer_kind in ('existing', 'new', 'walk_in')),
  flow           text not null check (flow in ('slot', 'button', 'walk_in', 'keyboard', 'customer_page', 'add_another')),
  source         public.booking_source not null,
  opened_at      timestamptz not null,
  saved_at       timestamptz not null,
  duration_ms    int not null check (duration_ms between 0 and 3600000),
  created_at     timestamptz not null default now(),
  check (saved_at >= opened_at)
);
create index on private.booking_creation_timings (business_id, saved_at);

create function public.biz_log_booking_timing(p_booking_id uuid, p_duration_ms int,
                                              p_customer_kind text, p_flow text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings; v_role public.business_role;
begin
  select * into v from public.bookings where id = p_booking_id;
  v_role := case when v.id is not null then private.my_role(v.business_id) end;
  if v.id is null or v_role is null or v.created_by_user_id is distinct from private.uid()
     or v.source not in ('manual', 'walk_in') then
    perform private.raise_code('FORBIDDEN');
  end if;
  if v.created_at < now() - interval '10 minutes' then perform private.raise_code('OUTSIDE_WINDOW'); end if;
  if p_duration_ms is null or p_duration_ms < 0 or p_duration_ms > 3600000
     or p_customer_kind not in ('existing', 'new', 'walk_in')
     or p_flow not in ('slot', 'button', 'walk_in', 'keyboard', 'customer_page', 'add_another') then
    perform private.raise_code('INVALID_INPUT');
  end if;
  insert into private.booking_creation_timings (booking_id, business_id, actor_role, customer_kind, flow, source,
                                                opened_at, saved_at, duration_ms)
  values (v.id, v.business_id, v_role, p_customer_kind, p_flow, v.source,
          v.created_at - make_interval(secs => p_duration_ms / 1000.0), v.created_at, p_duration_ms)
  on conflict (booking_id) do nothing;                    -- first report wins (retries are harmless)
end $$;

-- Pilot report for ops: median / p75 / p90 seconds per business, role and customer kind
create function public.admin_booking_timing_stats(p_from date default null, p_to date default null,
                                                  p_business_id uuid default null)
returns table (business_id uuid, business_name text, actor_role public.business_role, customer_kind text,
               bookings int, median_seconds numeric, p75_seconds numeric, p90_seconds numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin('{ops}') then perform private.raise_code('FORBIDDEN'); end if;
  return query
  select t.business_id, b.name, t.actor_role, t.customer_kind, count(*)::int,
         round((percentile_cont(0.5)  within group (order by t.duration_ms) / 1000)::numeric, 1),
         round((percentile_cont(0.75) within group (order by t.duration_ms) / 1000)::numeric, 1),
         round((percentile_cont(0.9)  within group (order by t.duration_ms) / 1000)::numeric, 1)
  from private.booking_creation_timings t join public.businesses b on b.id = t.business_id
  where (p_business_id is null or t.business_id = p_business_id)
    and (p_from is null or t.saved_at >= (p_from::timestamp at time zone 'Asia/Beirut'))
    and (p_to is null or t.saved_at < ((p_to + 1)::timestamp at time zone 'Asia/Beirut'))
  group by grouping sets ((t.business_id, b.name), (t.business_id, b.name, t.actor_role, t.customer_kind))
  order by b.name, t.actor_role nulls first, t.customer_kind nulls first;
end $$;

grant execute on function public.biz_log_booking_timing(uuid, int, text, text)  to authenticated;
grant execute on function public.admin_booking_timing_stats(date, date, uuid)    to authenticated;

select private.assign_app_ownership();
