-- M6 · Business dashboard II: calendar & daily operations — role-projected read models
-- Spec: Phase 2 B2–B7, Phase 3 Part 3 §4.4, Part 5 §4 (biz_get_customer), Part 6 §3.4 + Realtime.
-- Writes keep going through the M3 booking RPCs (create_manual_booking, biz_reschedule_booking,
-- reassign_booking_item, …). This migration adds the reads the calendar needs, block time, and
-- the "who can take this booking instead" lookup used by the affected-booking flows.
-- Projection rules (Part 1 §6.3): staff see only their own column; phone only with
-- staff_see_customer_phone; no prices/revenue for staff; reception sees spend only with
-- reception_sees_revenue; time-off reasons only for owner/manager and the staff member.

-- ─── Helpers ───────────────────────────────────────────────────────────────
create function private.bc_reliability(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_user_id is null then 'new_customer'
              else case private.reliability_tier(p_user_id)
                     when 'new' then 'new_customer' when 'reliable' then 'reliable'
                     else 'some_missed_appointments' end end
$$;

create function private.person_name(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') from public.profiles p where p.id = p_user_id
$$;

-- Business customer as the calling role may see it (null for walk-ins without details)
create function private.bc_card(p_bc_id uuid, p_booking_id uuid, p_role public.business_role,
                                p_set public.business_settings)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', bc.id, 'name', bc.display_name,
    'phone', case when p_role <> 'staff' or p_set.staff_see_customer_phone then bc.phone_e164 end,
    'is_new', bc.first_booking_id is not distinct from p_booking_id and bc.visit_count = 0,
    'visit_count', bc.visit_count,
    'reliability', case when p_role <> 'staff' then private.bc_reliability(bc.user_id) end,
    'pinned_note', (select n.body from public.customer_notes n
                    where n.business_customer_id = bc.id and n.is_pinned and n.deleted_at is null
                      and (p_role <> 'staff' or n.visible_to_staff)
                    order by n.updated_at desc limit 1))
  from public.business_customers bc where bc.id = p_bc_id
$$;

-- One booking row for calendar / lists / drawers
create function private.booking_card(p_item public.booking_items, p_role public.business_role,
                                     p_set public.business_settings)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'item_id', p_item.id, 'booking_id', b.id, 'ref', b.ref, 'location_id', b.location_id,
    'staff_id', p_item.staff_id, 'staff_name', s.display_name,
    'service_id', p_item.service_id, 'service_name', sv.name,
    'starts_at', p_item.starts_at, 'ends_at', p_item.ends_at, 'duration_min', p_item.duration_min,
    'buffer_before', p_item.buffer_before_min, 'buffer_after', p_item.buffer_after_min,
    'status', b.status, 'source', b.source, 'is_request', b.is_request, 'expires_at', b.expires_at,
    'selection_mode', p_item.selection_mode,
    'requested', p_item.selection_mode in ('specific', 'rebook') and p_item.requested_staff_id = p_item.staff_id,
    'requested_staff_id', p_item.requested_staff_id,
    'price_type', case when p_role <> 'staff' then p_item.price_type end,
    'price_min',  case when p_role <> 'staff' then p_item.price_min end,
    'price_max',  case when p_role <> 'staff' then p_item.price_max end,
    'currency', b.currency,
    'internal_note', b.internal_note, 'customer_note', b.customer_note,
    'created_by_kind', b.created_by_kind, 'rescheduled_count', b.rescheduled_count,
    'cancel_reason', b.cancel_reason, 'cancelled_by_kind', b.cancelled_by_kind,
    'no_show_disputed', b.no_show_disputed, 'updated_at', b.updated_at,
    'customer', private.bc_card(b.business_customer_id, b.id, p_role, p_set))
  from public.bookings b
  join public.staff_members s on s.id = p_item.staff_id
  join public.services sv on sv.id = p_item.service_id
  where b.id = p_item.booking_id
$$;

create function private.biz_tz(p_business_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select l.timezone from public.business_locations l where l.business_id = p_business_id
                   order by l.created_at limit 1), 'Asia/Beirut')
$$;

-- ═══ B3 Calendar ══════════════════════════════════════════════════════════
-- Staff columns in scope with working time and time off, plus booking items, for [p_from, p_to]
-- (Beirut dates, ≤ 42 days). Staff role: always and only their own column.
create function public.biz_get_calendar(p_location_id uuid, p_from date, p_to date,
                                        p_staff_ids uuid[] default null, p_include_cancelled boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz uuid; v_tz text; v_role public.business_role; v_set public.business_settings; v_me uuid;
  v_win tstzrange; v_staff uuid[]; v_full boolean;
begin
  select business_id, timezone into v_biz, v_tz from public.business_locations where id = p_location_id;
  v_role := case when v_biz is not null then private.my_role(v_biz) end;
  if v_role is null then perform private.raise_code('FORBIDDEN'); end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 41 then
    perform private.raise_code('INVALID_RANGE');
  end if;
  select * into v_set from public.business_settings where business_id = v_biz;
  v_me := private.my_staff_id(v_biz);
  v_full := v_role in ('owner', 'manager');
  v_win := tstzrange(private.local_instant(p_from, 0, v_tz), private.local_instant(p_to + 1, 0, v_tz), '[)');

  if v_role = 'staff' then
    v_staff := case when v_me is null then '{}'::uuid[] else array[v_me] end;
  else
    select coalesce(array_agg(s.id order by s.display_order, s.display_name), '{}') into v_staff
    from public.staff_members s
    join public.staff_locations sl on sl.staff_id = s.id and sl.location_id = p_location_id
    where s.business_id = v_biz
      and (p_staff_ids is null or s.id = any(p_staff_ids))
      and (s.status = 'active'
           or exists (select 1 from public.booking_items bi join public.bookings b on b.id = bi.booking_id
                      where bi.staff_id = s.id and bi.occupied && v_win and b.status in ('pending', 'confirmed')));
  end if;

  return jsonb_build_object(
    'timezone', v_tz, 'role', v_role, 'my_staff_id', v_me,
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'display_name', s.display_name, 'role_title', s.role_title, 'status', s.status,
               'publicly_bookable', s.publicly_bookable,
               'working', (select coalesce(jsonb_agg(jsonb_build_array(lower(r), upper(r)) order by lower(r)), '[]')
                           from unnest(private.staff_working_time(s.id, p_location_id, p_from, p_to)) r),
               'time_off', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id', t.id, 'start', lower(t.period), 'end', upper(t.period), 'kind', t.kind,
                                     'reason', case when v_full or s.id = v_me then t.reason end)
                                   order by lower(t.period)), '[]')
                            from public.staff_time_off t where t.staff_id = s.id and t.period && v_win))
             order by array_position(v_staff, s.id))
      from public.staff_members s where s.id = any(v_staff)), '[]'),
    'items', coalesce((
      select jsonb_agg(private.booking_card(bi, v_role, v_set) order by bi.starts_at, bi.staff_id)
      from public.booking_items bi join public.bookings b on b.id = bi.booking_id
      where bi.location_id = p_location_id and bi.staff_id = any(v_staff) and bi.occupied && v_win
        and (b.status <> 'held' or b.expires_at > now())
        and (p_include_cancelled or b.status <> 'cancelled')), '[]'));
end $$;

-- ═══ Block time (B3 §4.4): break / personal / training straight from the grid ═══
-- Desk roles for anyone at the business; staff for themselves. Existing bookings are kept; the
-- client offers the affected-booking flow (reassign / cancel) for any overlap.
create function public.biz_block_time(p_staff_id uuid, p_start timestamptz, p_end timestamptz,
                                      p_kind public.time_off_kind default 'personal', p_reason text default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_biz uuid; v_id uuid;
begin
  select business_id into v_biz from public.staff_members where id = p_staff_id and status = 'active';
  if v_biz is null
     or not (private.has_business_role(v_biz, '{owner,manager,reception}') or p_staff_id = private.my_staff_id(v_biz)) then
    perform private.raise_code('FORBIDDEN');
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > interval '31 days' then
    perform private.raise_code('INVALID_RANGE');
  end if;
  insert into public.staff_time_off (staff_id, business_id, period, kind, reason, created_by)
  values (p_staff_id, v_biz, tstzrange(p_start, p_end, '[)'), coalesce(p_kind, 'personal'),
          nullif(left(btrim(coalesce(p_reason, '')), 200), ''), private.uid())
  returning id into v_id;
  return v_id;
end $$;

create function public.biz_remove_block(p_time_off_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.staff_time_off;
begin
  select * into v from public.staff_time_off where id = p_time_off_id;
  if v.id is null
     or not (private.has_business_role(v.business_id, '{owner,manager,reception}')
             or v.staff_id = private.my_staff_id(v.business_id)) then
    perform private.raise_code('FORBIDDEN');
  end if;
  delete from public.staff_time_off where id = p_time_off_id;
end $$;

-- ═══ Affected-booking flows ═══════════════════════════════════════════════
-- Who could take this booking instead (same time): staff at the location who perform the
-- service, whether they're free, and whether it's inside their hours.
create function public.biz_reassign_options(p_item_id uuid)
returns table (staff_id uuid, display_name text, is_free boolean, in_hours boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_item public.booking_items; v_tz text; v_day date;
begin
  select * into v_item from public.booking_items where id = p_item_id;
  if v_item.id is null or not private.has_business_role(v_item.business_id, '{owner,manager,reception}') then
    perform private.raise_code('FORBIDDEN');
  end if;
  select timezone into v_tz from public.business_locations where id = v_item.location_id;
  v_day := (v_item.starts_at at time zone v_tz)::date;
  return query
  select s.id, s.display_name,
         not exists (select 1 from public.booking_items x join public.bookings xb on xb.id = x.booking_id
                     where x.staff_id = s.id and x.blocks_time and x.occupied && v_item.occupied
                       and (xb.status <> 'held' or xb.expires_at > now())),
         coalesce(v_item.occupied <@ (private.staff_working_time(s.id, v_item.location_id, v_day, v_day)
                                      - private.staff_time_off_time(s.id, v_item.occupied)), false)
  from public.staff_members s
  join public.staff_locations sl on sl.staff_id = s.id and sl.location_id = v_item.location_id
  join public.staff_services ss on ss.staff_id = s.id and ss.service_id = v_item.service_id
  where s.status = 'active' and s.id <> v_item.staff_id
  order by 3 desc, 4 desc, s.display_order, s.display_name;
end $$;

-- A staff member's upcoming bookings in a window (whole future when p_to is null): the list the
-- archive / time-off / block-time flows walk through.
create function public.biz_affected_bookings(p_staff_id uuid, p_from timestamptz default null,
                                             p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_biz uuid; v_role public.business_role; v_set public.business_settings;
begin
  select business_id into v_biz from public.staff_members where id = p_staff_id;
  v_role := case when v_biz is not null then private.my_role(v_biz) end;
  if v_role is null or v_role = 'staff' then perform private.raise_code('FORBIDDEN'); end if;
  select * into v_set from public.business_settings where business_id = v_biz;
  return coalesce((
    select jsonb_agg(private.booking_card(bi, v_role, v_set) order by bi.starts_at)
    from public.booking_items bi join public.bookings b on b.id = bi.booking_id
    where bi.staff_id = p_staff_id and b.status in ('pending', 'confirmed')
      and bi.ends_at > greatest(coalesce(p_from, now()), now())
      and (p_to is null or bi.starts_at < p_to)), '[]');
end $$;

-- ═══ B5 Bookings ══════════════════════════════════════════════════════════
-- Tabs: pending · upcoming · past · cancelled (cancelled + no-shows) · all. Staff: own bookings.
create function public.biz_list_bookings(
  p_business_id uuid, p_tab text default 'upcoming',
  p_staff_id uuid default null, p_service_id uuid default null, p_source text default null,
  p_from date default null, p_to date default null, p_q text default null, p_customer_id uuid default null,
  p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.business_role := private.my_role(p_business_id);
  v_set public.business_settings; v_tz text; v_staff uuid; v_q text := btrim(coalesce(p_q, ''));
  v_digits text; v_rows jsonb; v_total bigint; v_pending bigint;
begin
  if v_role is null then perform private.raise_code('FORBIDDEN'); end if;
  if p_tab not in ('pending', 'upcoming', 'past', 'cancelled', 'all') then perform private.raise_code('INVALID_INPUT'); end if;
  select * into v_set from public.business_settings where business_id = p_business_id;
  v_tz := private.biz_tz(p_business_id);
  v_staff := case when v_role = 'staff' then coalesce(private.my_staff_id(p_business_id), '00000000-0000-0000-0000-000000000000'::uuid)
                  else p_staff_id end;
  v_digits := regexp_replace(private.normalize_digits(v_q), '\D', '', 'g');
  if v_digits like '0%' then v_digits := substr(v_digits, 2); end if;

  with f as (
    select bi.*, b.status as b_status, b.starts_at as b_start, b.expires_at as b_exp
    from public.booking_items bi
    join public.bookings b on b.id = bi.booking_id
    left join public.business_customers bc on bc.id = b.business_customer_id
    where bi.business_id = p_business_id and b.status <> 'held'
      and (v_staff is null or bi.staff_id = v_staff)
      and (p_service_id is null or bi.service_id = p_service_id)
      and (p_source is null or b.source::text = p_source)
      and (p_customer_id is null or b.business_customer_id = p_customer_id)
      and (p_from is null or b.starts_at >= private.local_instant(p_from, 0, v_tz))
      and (p_to is null or b.starts_at < private.local_instant(p_to + 1, 0, v_tz))
      and (v_q = ''
           or upper(b.ref) = upper(v_q)
           or (v_digits <> '' and v_q ~ '^[+0-9٠-٩۰-۹ ()-]+$' and bc.phone_e164 like '%' || v_digits || '%'
               and (v_role <> 'staff' or v_set.staff_see_customer_phone))
           or private.normalize_text(bc.display_name) like '%' || private.normalize_text(v_q) || '%')
      and case p_tab
            when 'pending'   then b.status = 'pending'
            when 'upcoming'  then b.status = 'confirmed' and b.ends_at >= now()
            when 'past'      then b.status in ('confirmed', 'completed') and b.ends_at < now()
            when 'cancelled' then b.status in ('cancelled', 'no_show')
            else true end
  ), page as (
    select * from f
    order by case when p_tab = 'pending' then f.b_exp end asc,
             case when p_tab = 'upcoming' then f.b_start end asc,
             f.b_start desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(private.booking_card(row(p.id, p.booking_id, p.business_id, p.location_id, p.position,
                     p.service_id, p.canonical_service_id, p.staff_id, p.selection_mode, p.requested_staff_id,
                     p.assignment_rule_used, p.starts_at, p.ends_at, p.buffer_before_min, p.buffer_after_min,
                     p.occupied, p.blocks_time, p.allow_overlap, p.duration_min, p.price_type, p.price_min,
                     p.price_max, p.price_overridden, p.created_at, p.updated_at)::public.booking_items, v_role, v_set)
                   order by case when p_tab = 'pending' then p.b_exp end asc,
                            case when p_tab = 'upcoming' then p.b_start end asc,
                            p.b_start desc)
                   from page p), '[]')
    into v_total, v_rows;

  select count(*) into v_pending
  from public.booking_items bi join public.bookings b on b.id = bi.booking_id
  where bi.business_id = p_business_id and b.status = 'pending' and (v_staff is null or bi.staff_id = v_staff);

  return jsonb_build_object('total', v_total, 'pending_count', v_pending, 'rows', v_rows);
end $$;

-- Booking drawer: the card plus the event timeline with the actor's name (accountability, B5)
create function public.biz_get_booking(p_booking_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_biz uuid; v_role public.business_role; v_set public.business_settings; v_item public.booking_items;
begin
  v_biz := private.assert_booking_access(p_booking_id, true);
  v_role := private.my_role(v_biz);
  select * into v_set from public.business_settings where business_id = v_biz;
  select * into v_item from public.booking_items where booking_id = p_booking_id order by position limit 1;
  return private.booking_card(v_item, v_role, v_set) || jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event', e.event, 'actor_kind', e.actor_kind,
               'actor_name', case when e.actor_kind = 'business' then coalesce(private.person_name(e.actor_user_id), 'Team member')
                                  when e.actor_kind = 'customer' then 'Customer'
                                  when e.actor_kind = 'system' then 'Automatic'
                                  else 'APP_NAME support' end,
               'from_status', e.from_status, 'to_status', e.to_status, 'created_at', e.created_at,
               'data', e.data - 'reason' || case when v_role <> 'staff' and e.data ? 'reason'
                                                 then jsonb_build_object('reason', e.data -> 'reason') else '{}' end)
             order by e.created_at, e.id)
      from public.booking_events e where e.booking_id = p_booking_id), '[]'));
end $$;

-- ═══ B7 Customer detail ═══════════════════════════════════════════════════
-- Unknown or out-of-scope customers are indistinguishable (NOT_FOUND). Reviews never appear here.
create function public.biz_get_customer(p_business_id uuid, p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.business_role := private.my_role(p_business_id);
  v_set public.business_settings; v_bc public.business_customers; v_staff uuid; v_spend boolean;
begin
  if v_role is null then perform private.raise_code('FORBIDDEN'); end if;
  select * into v_set from public.business_settings where business_id = p_business_id;
  select * into v_bc from public.business_customers
   where id = p_customer_id and business_id = p_business_id and merged_into_id is null;
  v_staff := case when v_role = 'staff' then private.my_staff_id(p_business_id) end;
  if v_bc.id is null
     or (v_role = 'staff' and not exists (
           select 1 from public.bookings b join public.booking_items bi on bi.booking_id = b.id
           where b.business_customer_id = v_bc.id and bi.staff_id = v_staff
             and b.status in ('pending', 'confirmed') and b.starts_at > now())) then
    perform private.raise_code('NOT_FOUND');
  end if;
  v_spend := v_role in ('owner', 'manager') or (v_role = 'reception' and v_set.reception_sees_revenue);

  return jsonb_build_object(
    'customer', jsonb_build_object(
      'id', v_bc.id, 'name', v_bc.display_name,
      'phone', case when v_role <> 'staff' or v_set.staff_see_customer_phone then v_bc.phone_e164 end,
      'since', v_bc.created_at, 'acquired_via', v_bc.acquired_via, 'is_claimed', v_bc.user_id is not null,
      'archived', v_bc.archived_at is not null, 'is_blocked_online', v_bc.is_blocked_online,
      'reliability', case when v_role <> 'staff' then private.bc_reliability(v_bc.user_id) end),
    'stats', case when v_role = 'staff' then null else jsonb_build_object(
      'visits', v_bc.visit_count,
      'lifetime_spend', case when v_spend then v_bc.lifetime_spend end,
      'average_spend', case when v_spend and v_bc.visit_count > 0 then round(v_bc.lifetime_spend / v_bc.visit_count, 2) end,
      'last_visit_at', v_bc.last_visit_at, 'first_visit_at', v_bc.first_visit_at,
      'favorite_service', (select name from public.services where id = v_bc.favorite_service_id),
      'favorite_service_id', v_bc.favorite_service_id,
      'preferred_staff', (select display_name from public.staff_members where id = v_bc.preferred_staff_id),
      'preferred_staff_id', v_bc.preferred_staff_id,
      'no_shows', v_bc.no_show_count, 'cancellations', v_bc.cancel_count, 'late_cancellations', v_bc.late_cancel_count) end,
    'upcoming', coalesce((
      select jsonb_agg(private.booking_card(bi, v_role, v_set) order by bi.starts_at)
      from public.booking_items bi join public.bookings b on b.id = bi.booking_id
      where b.business_customer_id = v_bc.id and b.status in ('pending', 'confirmed') and b.ends_at >= now()
        and (v_staff is null or bi.staff_id = v_staff)), '[]'),
    'history', case when v_role = 'staff' then '[]'::jsonb else coalesce((
      select jsonb_agg(c order by (c ->> 'starts_at') desc)
      from (select private.booking_card(bi, v_role, v_set) as c
            from public.booking_items bi join public.bookings b on b.id = bi.booking_id
            where b.business_customer_id = v_bc.id and b.status <> 'held'
              and not (b.status in ('pending', 'confirmed') and b.ends_at >= now())
            order by b.starts_at desc limit 100) h), '[]') end,
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'body', n.body, 'is_pinned', n.is_pinned, 'visible_to_staff', n.visible_to_staff,
               'author', coalesce(private.person_name(n.author_user_id), 'Team member'),
               'mine', n.author_user_id = private.uid(), 'created_at', n.created_at)
             order by n.is_pinned desc, n.created_at desc)
      from public.customer_notes n
      where n.business_customer_id = v_bc.id and n.deleted_at is null
        and (v_role <> 'staff' or n.visible_to_staff)), '[]'));
end $$;

-- ═══ B4 Appointment creation helpers ═════════════════════════════════════
-- Smart field: phone digits (incl. Lebanese local "03 …") or name → this business's customers,
-- with what reception needs to pick fast (visits, last visit, usual staff, reliability).
create function public.biz_find_customers(p_business_id uuid, p_q text, p_limit int default 6)
returns table (id uuid, display_name text, phone_e164 text, visit_count int, last_visit_at timestamptz,
               preferred_staff_id uuid, preferred_staff_name text, favorite_service_id uuid, reliability_label text,
               is_blocked_online boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(private.normalize_digits(coalesce(p_q, '')), '\D', '', 'g');
begin
  if not private.has_business_role(p_business_id, '{owner,manager,reception}') then perform private.raise_code('FORBIDDEN'); end if;
  if v_q = '' then return; end if;
  if v_digits like '0%' then v_digits := substr(v_digits, 2); end if;
  return query
  select bc.id, bc.display_name, bc.phone_e164, bc.visit_count, bc.last_visit_at, bc.preferred_staff_id,
         (select s.display_name from public.staff_members s where s.id = bc.preferred_staff_id and s.status = 'active'),
         bc.favorite_service_id, private.bc_reliability(bc.user_id), bc.is_blocked_online
  from public.business_customers bc
  where bc.business_id = p_business_id and bc.merged_into_id is null and bc.archived_at is null
    and ((v_digits <> '' and v_q ~ '^[+0-9٠-٩۰-۹ ()-]+$' and bc.phone_e164 like '%' || v_digits || '%')
         or private.normalize_text(bc.display_name) like '%' || private.normalize_text(v_q) || '%')
  order by (bc.phone_e164 like '%' || nullif(v_digits, '')) desc nulls last, bc.visit_count desc, bc.last_visit_at desc nulls last
  limit least(greatest(coalesce(p_limit, 6), 1), 20);
end $$;

-- Most-booked services (last 90 days) for the one-tap chips
create function public.biz_service_usage(p_business_id uuid)
returns table (service_id uuid, bookings bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role(p_business_id) is null then perform private.raise_code('FORBIDDEN'); end if;
  return query
  select bi.service_id, count(*)
  from public.booking_items bi join public.bookings b on b.id = bi.booking_id
  where bi.business_id = p_business_id and b.status in ('confirmed', 'completed', 'no_show')
    and b.starts_at > now() - interval '90 days'
  group by bi.service_id order by 2 desc;
end $$;

-- Undo right after saving a manual booking / walk-in ("Saved · Undo", B4 §9): only the person
-- who created it, within 2 minutes; logged as a cancellation with {"undo": true}, no notification.
create function public.biz_undo_manual_booking(p_booking_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings;
begin
  select * into v from public.bookings where id = p_booking_id for update;
  if v.id is null or v.created_by_user_id is distinct from private.uid() or v.source not in ('manual', 'walk_in')
     or private.my_role(v.business_id) is null then
    perform private.raise_code('FORBIDDEN');
  end if;
  if v.created_at < now() - interval '2 minutes' or v.status not in ('confirmed', 'completed') then
    perform private.raise_code('OUTSIDE_WINDOW');
  end if;
  if v.status = 'completed' then
    perform private.add_reliability_event(v.customer_user_id, v.id, 'forgiven', null, 'undo_manual_booking');
  end if;
  update public.bookings set status = 'cancelled', cancelled_by_kind = 'business', cancel_reason = 'Undone right after saving'
   where id = p_booking_id;
  perform private.log_booking_event(p_booking_id, 'cancelled', 'business', v.status, 'cancelled', '{"undo":true,"notify":false}');
  perform private.recompute_business_customer_stats(v.business_customer_id);
end $$;

-- ═══ B2 Overview (lean) ═══════════════════════════════════════════════════
create function public.biz_today(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.business_role := private.my_role(p_business_id);
  v_set public.business_settings; v_tz text; v_day date; v_win tstzrange; v_staff uuid;
  v_loc uuid; v_rev boolean; v_avail numeric; v_booked numeric;
begin
  if v_role is null then perform private.raise_code('FORBIDDEN'); end if;
  select * into v_set from public.business_settings where business_id = p_business_id;
  select id, timezone into v_loc, v_tz from public.business_locations where business_id = p_business_id order by created_at limit 1;
  v_tz := coalesce(v_tz, 'Asia/Beirut');
  v_day := (now() at time zone v_tz)::date;
  v_win := tstzrange(private.local_instant(v_day, 0, v_tz), private.local_instant(v_day + 1, 0, v_tz), '[)');
  v_staff := case when v_role = 'staff' then coalesce(private.my_staff_id(p_business_id), '00000000-0000-0000-0000-000000000000'::uuid) end;
  v_rev := v_role in ('owner', 'manager') or (v_role = 'reception' and v_set.reception_sees_revenue);

  -- utilization = booked minutes / scheduled staff minutes today (Phase 2 B2 §13)
  select coalesce(sum(extract(epoch from upper(r) - lower(r)) / 60), 0) into v_avail
  from public.staff_members s
  join public.staff_locations sl on sl.staff_id = s.id and sl.location_id = v_loc
  cross join lateral unnest(private.staff_working_time(s.id, v_loc, v_day, v_day)) r
  where s.business_id = p_business_id and s.status = 'active' and (v_staff is null or s.id = v_staff);
  select coalesce(sum(bi.duration_min), 0) into v_booked
  from public.booking_items bi join public.bookings b on b.id = bi.booking_id
  where bi.business_id = p_business_id and bi.occupied && v_win and b.status in ('confirmed', 'completed')
    and (v_staff is null or bi.staff_id = v_staff);

  return jsonb_build_object(
    'date', v_day,
    'pending_requests', (select count(*) from public.booking_items bi join public.bookings b on b.id = bi.booking_id
                         where bi.business_id = p_business_id and b.status = 'pending' and (v_staff is null or bi.staff_id = v_staff)),
    'unmarked_past', (select coalesce(jsonb_agg(b.id), '[]') from public.bookings b
                      where b.business_id = p_business_id and b.status = 'confirmed' and b.ends_at < now()
                        and (v_staff is null or exists (select 1 from public.booking_items bi where bi.booking_id = b.id and bi.staff_id = v_staff))),
    'contested_no_shows', (select count(*) from public.bookings b where b.business_id = p_business_id and b.status = 'no_show' and b.no_show_disputed
                             and (v_staff is null or exists (select 1 from public.booking_items bi where bi.booking_id = b.id and bi.staff_id = v_staff))),
    'appointments', (select count(*) from public.booking_items bi join public.bookings b on b.id = bi.booking_id
                     where bi.business_id = p_business_id and bi.starts_at <@ v_win and b.status in ('pending', 'confirmed', 'completed', 'no_show')
                       and (v_staff is null or bi.staff_id = v_staff)),
    'cancellations', (select count(*) from public.booking_items bi join public.bookings b on b.id = bi.booking_id
                      where bi.business_id = p_business_id and bi.starts_at <@ v_win and b.status = 'cancelled'
                        and coalesce((select e.data ->> 'undo' from public.booking_events e where e.booking_id = b.id and e.event = 'cancelled'
                                      order by e.id desc limit 1), 'false') <> 'true'
                        and (v_staff is null or bi.staff_id = v_staff)),
    'expected_revenue', case when v_rev and v_role <> 'staff' then (
        select jsonb_build_object('amount', coalesce(sum(b.total_price_min), 0),
                                  'approx', coalesce(bool_or(bi.price_type <> 'fixed'), false),
                                  'currency', coalesce(min(b.currency), 'USD'))
        from public.booking_items bi join public.bookings b on b.id = bi.booking_id
        where bi.business_id = p_business_id and bi.starts_at <@ v_win and b.status in ('confirmed', 'completed')) end,
    'utilization', case when v_avail > 0 then round(least(v_booked / v_avail, 1) * 100) end);
end $$;

-- ─── CRM stats: a customer's "cancellations" are the ones they made ─────────
-- (M3 counted business-side cancellations too, e.g. a salon closing for a day or an Undo.)
create or replace function private.recompute_business_customer_stats(p_business_customer_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_business_customer_id is null then return; end if;
  update public.business_customers bc set
    visit_count         = s.visits,
    no_show_count       = s.no_shows,
    cancel_count        = s.cancels,
    late_cancel_count   = s.late_cancels,
    lifetime_spend      = s.spend,
    first_visit_at      = s.first_visit,
    last_visit_at       = s.last_visit,
    preferred_staff_id  = s.pref_staff,
    favorite_service_id = s.fav_service
  from (
    select count(*) filter (where b.status = 'completed')                  as visits,
           count(*) filter (where b.status = 'no_show')                    as no_shows,
           count(*) filter (where b.status = 'cancelled' and b.cancelled_by_kind = 'customer') as cancels,
           count(*) filter (where b.is_late_cancel)                        as late_cancels,
           coalesce(sum(b.total_price_min) filter (where b.status = 'completed'), 0) as spend,
           min(b.starts_at) filter (where b.status = 'completed')          as first_visit,
           max(b.starts_at) filter (where b.status = 'completed')          as last_visit,
           (select bi.staff_id from public.booking_items bi join public.bookings b2 on b2.id = bi.booking_id
            where b2.business_customer_id = p_business_customer_id and b2.status = 'completed'
            group by bi.staff_id order by count(*) desc, max(b2.starts_at) desc limit 1) as pref_staff,
           (select bi.service_id from public.booking_items bi join public.bookings b2 on b2.id = bi.booking_id
            where b2.business_customer_id = p_business_customer_id and b2.status = 'completed'
            group by bi.service_id order by count(*) desc, max(b2.starts_at) desc limit 1) as fav_service
    from public.bookings b
    where b.business_customer_id = p_business_customer_id
  ) s
  where bc.id = p_business_customer_id;
end $$;

-- ─── Realtime (Part 6 §3.4): the calendar listens for changes and refetches through
-- biz_get_calendar. RLS applies, so staff only receive their own items; customer names never
-- travel over Realtime (they live in business_customers, which isn't published).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.booking_items, public.bookings;
  end if;
end $$;

grant execute on function public.biz_get_calendar(uuid, date, date, uuid[], boolean) to authenticated;
grant execute on function public.biz_block_time(uuid, timestamptz, timestamptz, public.time_off_kind, text) to authenticated;
grant execute on function public.biz_remove_block(uuid)                        to authenticated;
grant execute on function public.biz_reassign_options(uuid)                    to authenticated;
grant execute on function public.biz_affected_bookings(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.biz_list_bookings(uuid, text, uuid, uuid, text, date, date, text, uuid, int, int) to authenticated;
grant execute on function public.biz_get_booking(uuid)                         to authenticated;
grant execute on function public.biz_get_customer(uuid, uuid)                  to authenticated;
grant execute on function public.biz_find_customers(uuid, text, int)           to authenticated;
grant execute on function public.biz_service_usage(uuid)                       to authenticated;
grant execute on function public.biz_undo_manual_booking(uuid)                 to authenticated;
grant execute on function public.biz_today(uuid)                               to authenticated;

select private.assign_app_ownership();
