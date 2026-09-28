-- M3 · Availability engine + staff assignment
-- Spec: Phase 3 Part 3 §2–3. publicly_bookable is enforced in ONE place: private.candidate_staff.

-- Effective terms for (staff, service): overrides win
create function private.staff_service_terms(p_staff_id uuid, p_service_id uuid)
returns table (duration_min int, buffer_before_min int, buffer_after_min int,
               price_type public.price_type, price_min numeric, price_max numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(ss.duration_min_override, s.duration_min),
         s.buffer_before_min, s.buffer_after_min,
         coalesce(ss.price_type_override, s.price_type),
         case when ss.price_type_override is not null then ss.price_min_override else s.price_min end,
         case when ss.price_type_override is not null then ss.price_max_override else s.price_max end
  from public.staff_services ss
  join public.services s on s.id = ss.service_id and s.business_id = ss.business_id
  where ss.staff_id = p_staff_id and ss.service_id = p_service_id
$$;

-- Local wall-clock minutes on a date → instant, in the location's IANA zone (DST-safe)
create function private.local_instant(p_day date, p_minute int, p_tz text) returns timestamptz
language sql stable parallel safe set search_path = '' as $$
  select (p_day::timestamp + make_interval(mins => p_minute)) at time zone p_tz
$$;

-- Working time = (overrides for the date, else effective weekly hours) ∩ location hours − closures
create function private.staff_working_time(p_staff_id uuid, p_location_id uuid, p_from date, p_to date)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  with loc as (select timezone as tz from public.business_locations where id = p_location_id),
  days as (select d::date as d from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d),
  ovr as (select * from public.staff_schedule_overrides o
          where o.staff_id = p_staff_id and o.location_id = p_location_id and o.on_date between p_from and p_to),
  intervals as (
    select o.on_date as d, o.start_minute as s, o.end_minute as e from ovr o where o.is_working
    union all
    select days.d, w.start_minute, w.end_minute
    from days
    join public.staff_weekly_hours w
      on w.staff_id = p_staff_id and w.location_id = p_location_id
     and w.iso_weekday = extract(isodow from days.d)
     and days.d >= w.effective_from and (w.effective_to is null or days.d < w.effective_to)
    where not exists (select 1 from ovr where ovr.on_date = days.d)
  ),
  open_hours as (
    select days.d, h.start_minute as s, h.end_minute as e
    from days join public.location_hours h
      on h.location_id = p_location_id and h.iso_weekday = extract(isodow from days.d)
  )
  select
    coalesce((select range_agg(tstzrange(private.local_instant(i.d, i.s, loc.tz),
                                         private.local_instant(i.d, i.e, loc.tz), '[)'))
              from intervals i, loc), '{}'::tstzmultirange)
  * coalesce((select range_agg(tstzrange(private.local_instant(h.d, h.s, loc.tz),
                                         private.local_instant(h.d, h.e, loc.tz), '[)'))
              from open_hours h, loc), '{}'::tstzmultirange)
  - coalesce((select range_agg(tstzrange(private.local_instant(lower(c.period), 0, loc.tz),
                                         private.local_instant(upper(c.period), 0, loc.tz), '[)'))
              from public.location_closures c, loc
              where c.location_id = p_location_id and c.period && daterange(p_from, p_to, '[]')),
             '{}'::tstzmultirange)
$$;

-- Busy time: blocking items (ignoring expired holds, and optionally one booking)
create function private.staff_busy_time(p_staff_id uuid, p_window tstzrange, p_ignore_booking_id uuid default null)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(bi.occupied), '{}'::tstzmultirange)
  from public.booking_items bi
  join public.bookings b on b.id = bi.booking_id
  where bi.staff_id = p_staff_id and bi.blocks_time and bi.occupied && p_window
    and not (b.status = 'held' and b.expires_at <= now())
    and (p_ignore_booking_id is null or b.id <> p_ignore_booking_id)
$$;

create function private.staff_time_off_time(p_staff_id uuid, p_window tstzrange)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(t.period), '{}'::tstzmultirange)
  from public.staff_time_off t where t.staff_id = p_staff_id and t.period && p_window
$$;

-- Free = working − time off − busy
create function private.staff_free_time(p_staff_id uuid, p_location_id uuid, p_from date, p_to date,
                                        p_ignore_booking_id uuid default null)
returns tstzmultirange language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_win tstzrange;
begin
  select timezone into v_tz from public.business_locations where id = p_location_id;
  v_win := tstzrange(private.local_instant(p_from, 0, v_tz), private.local_instant(p_to + 1, 0, v_tz), '[)');
  return private.staff_working_time(p_staff_id, p_location_id, p_from, p_to)
       - private.staff_time_off_time(p_staff_id, v_win)
       - private.staff_busy_time(p_staff_id, v_win, p_ignore_booking_id);
end $$;

-- Candidate staff. p_audience: public_any | public_specific | internal_any | internal_specific
create function private.candidate_staff(p_location_id uuid, p_service_id uuid, p_staff_id uuid, p_audience text)
returns table (staff_id uuid, assignment_priority int, last_auto_assigned_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.assignment_priority, s.last_auto_assigned_at
  from public.staff_members s
  join public.staff_locations sl on sl.staff_id = s.id and sl.location_id = p_location_id
  join public.staff_services  ss on ss.staff_id = s.id and ss.service_id = p_service_id
  where s.status = 'active'
    and case p_audience
          when 'public_any'        then s.publicly_bookable and s.accepts_any_assignment
          when 'public_specific'   then s.publicly_bookable and s.id = p_staff_id
          when 'internal_any'      then s.accepts_any_assignment
          when 'internal_specific' then s.id = p_staff_id
          else false
        end
$$;

-- Single slot engine: one row per (slot start, free staff member)
create function private.compute_slots(p_location_id uuid, p_service_id uuid, p_staff_id uuid,
                                      p_from date, p_to date, p_audience text, p_apply_min_notice boolean)
returns table (slot_start timestamptz, staff_id uuid, price_type public.price_type,
               price_min numeric, price_max numeric, duration_min int)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_step int; v_notice int; v_earliest timestamptz;
begin
  select l.timezone, st.slot_interval_minutes, st.min_notice_minutes
    into v_tz, v_step, v_notice
  from public.business_locations l join public.business_settings st on st.business_id = l.business_id
  where l.id = p_location_id;
  if v_tz is null then return; end if;

  v_earliest := case when p_apply_min_notice then now() + make_interval(mins => v_notice) else now() end;

  return query
  -- MATERIALIZED: free time is computed ONCE per staff member. Without it Postgres inlines this CTE
  -- and evaluates staff_free_time() for every grid row (measured: 7.3 s → see M3 report).
  with c as materialized (
    select cs.staff_id as sid, t.duration_min as dur, t.buffer_before_min as bb, t.buffer_after_min as ba,
           t.price_type as pt, t.price_min as pmin, t.price_max as pmax,
           private.staff_free_time(cs.staff_id, p_location_id, p_from, p_to) as free
    from private.candidate_staff(p_location_id, p_service_id, p_staff_id, p_audience) cs
    cross join lateral private.staff_service_terms(cs.staff_id, p_service_id) t
  ),
  grid as (
    select c.*, private.local_instant(d::date, m, v_tz) as t
    from c
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    cross join generate_series(0, 1439, v_step) m
    where not isempty(c.free)
  )
  select g.t, g.sid, g.pt, g.pmin, g.pmax, g.dur
  from grid g
  where g.t >= v_earliest
    and tstzrange(g.t - make_interval(mins => g.bb),
                  g.t + make_interval(mins => g.dur + g.ba), '[)') <@ g.free;
end $$;

-- ─── Public wrappers (anon + authenticated) ────────────────────────────────
-- Shared validation; returns the clamped date window or nothing when not bookable.
create function private.public_slot_window(p_location_id uuid, p_service_id uuid, p_staff_id uuid,
                                           p_date_from date, p_date_to date,
                                           out o_from date, out o_to date)
language plpgsql stable security definer set search_path = '' as $$
declare v_biz uuid; v_tz text; v_set public.business_settings; v_today date;
begin
  if not private.is_publicly_visible_location(p_location_id) then return; end if;
  select l.business_id, l.timezone into v_biz, v_tz from public.business_locations l where l.id = p_location_id;
  select * into v_set from public.business_settings where business_id = v_biz;
  if not v_set.allow_online_booking then return; end if;
  if not exists (select 1 from public.services s where s.id = p_service_id and s.business_id = v_biz
                 and s.status = 'active' and s.is_online_bookable) then return; end if;
  if (p_staff_id is null and v_set.staff_choice_mode = 'choose_only')
  or (p_staff_id is not null and v_set.staff_choice_mode = 'any_only') then return; end if;
  v_today := (now() at time zone v_tz)::date;
  o_from := greatest(coalesce(p_date_from, v_today), v_today);
  o_to   := least(coalesce(p_date_to, o_from + 13), o_from + 30, v_today + v_set.max_advance_days);
  if o_to < o_from then o_from := null; o_to := null; end if;
end $$;

create function public.get_available_slots(p_location_id uuid, p_service_id uuid, p_staff_id uuid default null,
                                           p_date_from date default null, p_date_to date default null)
returns table (slot_start timestamptz, price_type public.price_type, price_min numeric, price_max numeric)
language plpgsql stable security definer set search_path = '' as $$
declare w record;
begin
  select * into w from private.public_slot_window(p_location_id, p_service_id, p_staff_id, p_date_from, p_date_to);
  if w.o_from is null then return; end if;
  -- Any mode returns NO staff identifiers; specific mode only repeats the caller's own choice.
  return query
  select cs.slot_start, min(cs.price_type), min(cs.price_min), max(coalesce(cs.price_max, cs.price_min))
  from private.compute_slots(p_location_id, p_service_id, p_staff_id, w.o_from, w.o_to,
                             case when p_staff_id is null then 'public_any' else 'public_specific' end, true) cs
  group by cs.slot_start
  order by cs.slot_start;
end $$;

create function public.get_available_days(p_location_id uuid, p_service_id uuid, p_staff_id uuid default null,
                                          p_date_from date default null, p_date_to date default null)
returns setof date
language plpgsql stable security definer set search_path = '' as $$
declare w record; v_tz text;
begin
  select * into w from private.public_slot_window(p_location_id, p_service_id, p_staff_id, p_date_from, p_date_to);
  if w.o_from is null then return; end if;
  select timezone into v_tz from public.business_locations where id = p_location_id;
  return query
  select distinct (cs.slot_start at time zone v_tz)::date
  from private.compute_slots(p_location_id, p_service_id, p_staff_id, w.o_from, w.o_to,
                             case when p_staff_id is null then 'public_any' else 'public_specific' end, true) cs
  order by 1;
end $$;

-- Earliest slot within the horizon, scanning a week at a time
create function public.get_next_available(p_location_id uuid, p_service_id uuid, p_staff_id uuid default null)
returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare w record; v_from date; v_next timestamptz; v_audience text;
begin
  select * into w from private.public_slot_window(p_location_id, p_service_id, p_staff_id, null, current_date + 365);
  if w.o_from is null then return null; end if;
  v_audience := case when p_staff_id is null then 'public_any' else 'public_specific' end;
  v_from := w.o_from;
  while v_from <= w.o_to loop
    select min(cs.slot_start) into v_next
    from private.compute_slots(p_location_id, p_service_id, p_staff_id, v_from, least(v_from + 6, w.o_to), v_audience, true) cs;
    if v_next is not null then return v_next; end if;
    v_from := v_from + 7;
  end loop;
  return null;
end $$;

-- ─── Business wrapper (internal audiences; membership required) ────────────
create function public.biz_get_available_slots(p_location_id uuid, p_service_id uuid,
                                               p_staff_id uuid default null, p_date date default null)
returns table (slot_start timestamptz, staff_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
declare v_biz uuid; v_tz text;
begin
  select business_id, timezone into v_biz, v_tz from public.business_locations where id = p_location_id;
  if v_biz is null
     or not (private.has_business_role(v_biz, '{owner,manager,reception}')
             or (p_staff_id is not null and p_staff_id = private.my_staff_id(v_biz))) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;
  return query
  select cs.slot_start, array_agg(cs.staff_id order by cs.staff_id)
  from private.compute_slots(p_location_id, p_service_id, p_staff_id,
                             coalesce(p_date, (now() at time zone v_tz)::date),
                             coalesce(p_date, (now() at time zone v_tz)::date),
                             case when p_staff_id is null then 'internal_any' else 'internal_specific' end, false) cs
  group by cs.slot_start
  order by cs.slot_start;
end $$;

-- ─── Staff assignment ("Any available", Part 3 §3) ─────────────────────────
-- Advisory order only: the exclusion constraint decides the actual winner under concurrency.
create function private.rank_free_staff(p_location_id uuid, p_service_id uuid, p_start timestamptz,
                                        p_audience text, p_rule public.assignment_rule)
returns table (staff_id uuid, rnk int)
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_day date; v_day_range tstzrange;
begin
  select timezone into v_tz from public.business_locations where id = p_location_id;
  v_day := (p_start at time zone v_tz)::date;
  v_day_range := tstzrange(private.local_instant(v_day, 0, v_tz), private.local_instant(v_day + 1, 0, v_tz), '[)');
  return query
  with c as (
    select cs.staff_id as sid, cs.assignment_priority as prio, cs.last_auto_assigned_at as last_at,
           t.duration_min as dur, t.buffer_before_min as bb, t.buffer_after_min as ba
    from private.candidate_staff(p_location_id, p_service_id, null, p_audience) cs
    cross join lateral private.staff_service_terms(cs.staff_id, p_service_id) t
  ),
  free_c as (
    select c.*, tstzrange(p_start - make_interval(mins => c.bb),
                          p_start + make_interval(mins => c.dur + c.ba), '[)') as need
    from c
    where tstzrange(p_start - make_interval(mins => c.bb),
                    p_start + make_interval(mins => c.dur + c.ba), '[)')
          <@ private.staff_free_time(c.sid, p_location_id, v_day, v_day)
  ),
  m as (
    select f.*,
      coalesce((select sum(extract(epoch from (upper(bi.occupied) - lower(bi.occupied))) / 60)
                from public.booking_items bi
                where bi.staff_id = f.sid and bi.blocks_time and bi.occupied && v_day_range), 0) as booked_min,
      coalesce(extract(epoch from (lower(f.need) - (
                select max(upper(bi.occupied)) from public.booking_items bi
                where bi.staff_id = f.sid and bi.blocks_time
                  and bi.occupied && tstzrange(lower(f.need) - interval '12 hours', lower(f.need), '(]')
                  and upper(bi.occupied) <= lower(f.need)
                  and upper(bi.occupied) > lower(f.need) - interval '12 hours'))) / 60, 1e6) as gap_min
    from free_c f
  )
  select m.sid,
         (row_number() over (order by
            case p_rule when 'least_booked'  then m.booked_min end asc nulls last,
            case p_rule when 'priority'      then m.prio::numeric end asc nulls last,
            case p_rule when 'round_robin'   then extract(epoch from coalesce(m.last_at, 'epoch'::timestamptz)) end asc nulls last,
            case p_rule when 'minimize_gaps' then m.gap_min end asc nulls last,
            m.booked_min asc, m.prio asc, m.sid))::int
  from m;
end $$;

-- ─── Grants ────────────────────────────────────────────────────────────────
grant execute on function public.get_available_slots(uuid, uuid, uuid, date, date) to anon, authenticated;
grant execute on function public.get_available_days(uuid, uuid, uuid, date, date)  to anon, authenticated;
grant execute on function public.get_next_available(uuid, uuid, uuid)              to anon, authenticated;
grant execute on function public.biz_get_available_slots(uuid, uuid, uuid, date)   to authenticated;

select private.assign_app_ownership();
