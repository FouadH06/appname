-- M3 · Availability grid built once per request (found by the hosted Gate A check on staging).
-- compute_slots built the local-time grid per staff member through private.local_instant(), which
-- can't be inlined (its SET search_path clause), so 8 staff × 14 days × 96 slots paid ~10.7k
-- function calls with a GUC change each: p95 195 ms on staging compute (118 ms locally).
-- The grid is identical for every staff member, so it is now built once with the same expression.
-- Results are unchanged (same DST semantics); local p95 111 ms → 14 ms.

create or replace function private.compute_slots(p_location_id uuid, p_service_id uuid, p_staff_id uuid,
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
  -- The local-time grid is the same for every staff member: build it once (DST-safe, same
  -- expression as private.local_instant, inlined because a SET clause blocks function inlining).
  grid as materialized (
    select (d::date::timestamp + make_interval(mins => m)) at time zone v_tz as t
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    cross join generate_series(0, 1439, v_step) m
  )
  select g.t, c.sid, c.pt, c.pmin, c.pmax, c.dur
  from c cross join grid g
  where not isempty(c.free)
    and g.t >= v_earliest
    and tstzrange(g.t - make_interval(mins => c.bb),
                  g.t + make_interval(mins => c.dur + c.ba), '[)') <@ c.free;
end $$;

select private.assign_app_ownership();
