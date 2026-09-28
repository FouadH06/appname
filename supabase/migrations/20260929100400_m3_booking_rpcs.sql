-- M3 · Booking RPCs: holds, confirm, manual bookings, requests, cancel, reschedule, reassign,
--      complete / no-show, notes; CRM stats
-- Spec: Phase 3 Part 3 §4–5. Clients never write bookings directly; these are the only write paths.
-- Error contract: P0001 with a stable code in MESSAGE and JSON hints in DETAIL (Part 3 §1.6).

create function private.raise_code(p_code text, p_detail jsonb default '{}') returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '{}')::text;
end $$;

-- ─── Concurrency helpers ───────────────────────────────────────────────────
-- Writers that claim a staff member's time take this lock INSIDE the sub-transaction that
-- inserts/updates the item. Same-staff writers then queue for milliseconds instead of hitting the
-- exclusion-constraint deadlock (two conflicting inserts waiting on each other). If the attempt
-- fails, the sub-transaction rolls back and releases the lock, so a waiting transaction never holds
-- another staff member's lock, and no lock cycle can form. The exclusion constraint stays the
-- final arbiter.
create function private.lock_staff(p_staff_id uuid) returns void
language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('app.staff:' || p_staff_id::text, 0))
$$;

-- Leaves a candidate's sub-transaction (releasing its lock) when the staff member turns out busy
create function private.signal_busy() returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'AB001', message = 'staff busy (internal)';
end $$;

-- ─── CRM stats cache (Part 3 §5): recomputed, never incremented ────────────
create function private.recompute_business_customer_stats(p_business_customer_id uuid) returns void
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
           count(*) filter (where b.status = 'cancelled')                  as cancels,
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

-- ─── Shared checks ─────────────────────────────────────────────────────────
-- Business actor: owner/manager/reception, or (when allowed) the staff member on the booking
create function private.assert_booking_access(p_booking_id uuid, p_staff_allowed boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_biz uuid;
begin
  select business_id into v_biz from public.bookings where id = p_booking_id;
  if v_biz is null then perform private.raise_code('FORBIDDEN'); end if;
  if private.has_business_role(v_biz, '{owner,manager,reception}') then return v_biz; end if;
  if p_staff_allowed and exists (select 1 from public.booking_items bi
                                 where bi.booking_id = p_booking_id and bi.staff_id = private.my_staff_id(v_biz)) then
    return v_biz;
  end if;
  perform private.raise_code('FORBIDDEN');
  return null;
end $$;

-- Online slot validity: on the grid, after minimum notice, within the horizon
create function private.assert_public_slot(p_location_id uuid, p_start timestamptz) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_tz text; v_set public.business_settings; v_local timestamp;
begin
  select l.timezone into v_tz from public.business_locations l where l.id = p_location_id;
  select s.* into v_set from public.business_settings s
    join public.business_locations l on l.business_id = s.business_id where l.id = p_location_id;
  v_local := p_start at time zone v_tz;
  if (extract(hour from v_local) * 60 + extract(minute from v_local))::int % v_set.slot_interval_minutes <> 0
     or extract(second from v_local) <> 0
     or p_start < now() + make_interval(mins => v_set.min_notice_minutes)
     or v_local::date > (now() at time zone v_tz)::date + v_set.max_advance_days then
    perform private.raise_code('INVALID_SLOT');
  end if;
end $$;

create function private.policy_snapshot(p_business_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('cancellation_window_minutes', s.cancellation_window_minutes,
                            'booking_mode', s.booking_mode, 'min_notice_minutes', s.min_notice_minutes)
  from public.business_settings s where s.business_id = p_business_id
$$;

create function private.single_item(p_booking_id uuid) returns public.booking_items
language plpgsql volatile security definer set search_path = '' as $$
declare v public.booking_items; n int;
begin
  select count(*) into n from public.booking_items where booking_id = p_booking_id;
  if n <> 1 then perform private.raise_code('NOT_SUPPORTED', '{"reason":"multi_item"}'); end if;
  select * into v from public.booking_items where booking_id = p_booking_id;
  return v;
end $$;

-- ═══ Customer: holds ═══════════════════════════════════════════════════════
create function public.create_hold(
  p_location_id uuid, p_service_id uuid, p_start timestamptz,
  p_staff_id uuid default null,
  p_selection_mode public.staff_selection_mode default null,
  p_source public.booking_source default 'business_link',
  p_attribution jsonb default '{}')
returns table (booking_id uuid, hold_token text, expires_at timestamptz, staff_id uuid,
               staff_first_name text, starts_at timestamptz, ends_at timestamptz,
               price_type public.price_type, price_min numeric, price_max numeric,
               selection_mode public.staff_selection_mode)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid();
  v_biz uuid; v_tz text; v_set public.business_settings; v_svc public.services;
  v_mode public.staff_selection_mode; v_day date;
  v_cands uuid[]; v_sid uuid; v_terms record; v_occ tstzrange;
  v_bid uuid; v_token text; v_chosen uuid;
begin
  if v_uid is null then perform private.raise_code('AUTH_REQUIRED'); end if;
  perform private.hit_rate_limit('create_hold', v_uid::text, 20, interval '10 minutes');
  if p_source in ('manual', 'walk_in') then perform private.raise_code('FORBIDDEN'); end if;
  if not private.is_publicly_visible_location(p_location_id) then perform private.raise_code('NOT_BOOKABLE'); end if;

  select l.business_id, l.timezone into v_biz, v_tz from public.business_locations l where l.id = p_location_id;
  select * into v_set from public.business_settings where business_id = v_biz;
  select * into v_svc from public.services s
   where s.id = p_service_id and s.business_id = v_biz and s.status = 'active' and s.is_online_bookable;
  if v_svc.id is null or not v_set.allow_online_booking then perform private.raise_code('NOT_BOOKABLE'); end if;

  if p_staff_id is null then
    if v_set.staff_choice_mode = 'choose_only' then perform private.raise_code('NOT_BOOKABLE'); end if;
    v_mode := 'any';
  else
    if v_set.staff_choice_mode = 'any_only' then perform private.raise_code('NOT_BOOKABLE'); end if;
    v_mode := coalesce(p_selection_mode, 'specific');
    if v_mode not in ('specific', 'rebook') then perform private.raise_code('INVALID_SLOT'); end if;
  end if;

  perform private.assert_public_slot(p_location_id, p_start);
  v_day := (p_start at time zone v_tz)::date;

  -- one active hold per user
  delete from public.bookings b where b.hold_owner_user_id = v_uid and b.status = 'held';

  if v_mode = 'any' then
    select array_agg(r.staff_id order by r.rnk) into v_cands
    from private.rank_free_staff(p_location_id, p_service_id, p_start, 'public_any', v_set.assignment_rule) r;
    if v_cands is null then perform private.raise_code('SLOT_TAKEN'); end if;
  else
    select array_agg(cs.staff_id) into v_cands
    from private.candidate_staff(p_location_id, p_service_id, p_staff_id, 'public_specific') cs;
    if v_cands is null then perform private.raise_code('NOT_BOOKABLE', '{"reason":"staff"}'); end if;
  end if;

  foreach v_sid in array v_cands loop
    select * into v_terms from private.staff_service_terms(v_sid, p_service_id);
    v_occ := tstzrange(p_start - make_interval(mins => v_terms.buffer_before_min),
                       p_start + make_interval(mins => v_terms.duration_min + v_terms.buffer_after_min), '[)');

    begin
      perform private.lock_staff(v_sid);
      -- expired holds that would collide are cleared first
      delete from public.bookings b using public.booking_items bi
       where bi.booking_id = b.id and b.status = 'held' and b.expires_at <= now()
         and bi.staff_id = v_sid and bi.blocks_time and bi.occupied && v_occ;
      if not (v_occ <@ private.staff_free_time(v_sid, p_location_id, v_day, v_day)) then
        perform private.signal_busy();
      end if;
      v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
      insert into public.bookings (business_id, location_id, status, source, expires_at, hold_owner_user_id,
                                   hold_token_hash, starts_at, ends_at, created_by_kind, created_by_user_id,
                                   currency, total_price_min, total_price_max, attribution)
      values (v_biz, p_location_id, 'held', p_source, now() + interval '5 minutes', v_uid,
              extensions.digest(v_token, 'sha256'), p_start,
              p_start + make_interval(mins => v_terms.duration_min), 'customer', v_uid,
              v_svc.currency, v_terms.price_min, coalesce(v_terms.price_max, v_terms.price_min),
              coalesce(p_attribution, '{}'))
      returning id into v_bid;

      insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id,
                                        staff_id, selection_mode, requested_staff_id, assignment_rule_used,
                                        starts_at, ends_at, buffer_before_min, buffer_after_min, occupied,
                                        duration_min, price_type, price_min, price_max)
      values (v_bid, v_biz, p_location_id, p_service_id, v_svc.canonical_service_id,
              v_sid, v_mode,
              case when v_mode in ('specific', 'rebook') then v_sid end,
              case when v_mode = 'any' then v_set.assignment_rule end,
              p_start, p_start + make_interval(mins => v_terms.duration_min),
              v_terms.buffer_before_min, v_terms.buffer_after_min, v_occ,
              v_terms.duration_min, v_terms.price_type, v_terms.price_min, v_terms.price_max);
      v_chosen := v_sid;
      exit;
    exception when exclusion_violation or deadlock_detected or sqlstate 'AB001' then
      v_bid := null;          -- taken or busy; the lock is released with this sub-transaction
    end;
  end loop;

  if v_chosen is null then
    perform private.raise_code(case when v_mode = 'any' then 'SLOT_TAKEN' else 'STAFF_NOT_FREE' end);
  end if;
  if v_mode = 'any' then
    update public.staff_members set last_auto_assigned_at = now() where id = v_chosen;
  end if;

  return query
  select v_bid, v_token, b.expires_at, v_chosen, split_part(s.display_name, ' ', 1), b.starts_at, b.ends_at,
         v_terms.price_type, v_terms.price_min, v_terms.price_max, v_mode
  from public.bookings b join public.staff_members s on s.id = v_chosen
  where b.id = v_bid;
end $$;

create function private.own_hold(p_booking_id uuid, p_hold_token text) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare v public.bookings;
begin
  select * into v from public.bookings b
   where b.id = p_booking_id and b.status = 'held'
     and b.hold_token_hash = extensions.digest(coalesce(p_hold_token, ''), 'sha256')
   for update;
  if v.id is null then perform private.raise_code('HOLD_NOT_FOUND'); end if;
  return v;
end $$;

create function public.extend_hold(p_booking_id uuid, p_hold_token text) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings;
begin
  v := private.own_hold(p_booking_id, p_hold_token);
  if v.expires_at <= now() then perform private.raise_code('HOLD_EXPIRED'); end if;
  update public.bookings set expires_at = greatest(expires_at, now() + interval '10 minutes')
   where id = p_booking_id returning expires_at into v.expires_at;
  return v.expires_at;
end $$;

create function public.release_hold(p_booking_id uuid, p_hold_token text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.own_hold(p_booking_id, p_hold_token);
  delete from public.bookings where id = p_booking_id;
end $$;

-- C10 "Change": move the hold to another publicly bookable staff member at the same time
create function public.change_hold_staff(p_booking_id uuid, p_hold_token text, p_staff_id uuid)
returns table (staff_id uuid, staff_first_name text, ends_at timestamptz,
               price_type public.price_type, price_min numeric, price_max numeric)
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings; v_item public.booking_items; v_terms record; v_occ tstzrange; v_tz text; v_day date;
begin
  v := private.own_hold(p_booking_id, p_hold_token);
  v_item := private.single_item(p_booking_id);
  if not exists (select 1 from private.candidate_staff(v.location_id, v_item.service_id, p_staff_id, 'public_specific')) then
    perform private.raise_code('NOT_BOOKABLE', '{"reason":"staff"}');
  end if;
  select timezone into v_tz from public.business_locations where id = v.location_id;
  v_day := (v.starts_at at time zone v_tz)::date;
  select * into v_terms from private.staff_service_terms(p_staff_id, v_item.service_id);
  v_occ := tstzrange(v.starts_at - make_interval(mins => v_terms.buffer_before_min),
                     v.starts_at + make_interval(mins => v_terms.duration_min + v_terms.buffer_after_min), '[)');
  begin
    perform private.lock_staff(p_staff_id);
    if not (v_occ <@ private.staff_free_time(p_staff_id, v.location_id, v_day, v_day, p_booking_id)) then
      perform private.signal_busy();
    end if;
    update public.booking_items set
      staff_id = p_staff_id, selection_mode = 'specific', requested_staff_id = p_staff_id,
      assignment_rule_used = null, ends_at = v.starts_at + make_interval(mins => v_terms.duration_min),
      buffer_before_min = v_terms.buffer_before_min, buffer_after_min = v_terms.buffer_after_min,
      occupied = v_occ, duration_min = v_terms.duration_min,
      price_type = v_terms.price_type, price_min = v_terms.price_min, price_max = v_terms.price_max
    where id = v_item.id;
  exception when exclusion_violation or deadlock_detected or sqlstate 'AB001' then
    perform private.raise_code('STAFF_NOT_FREE');
  end;
  update public.bookings set ends_at = v.starts_at + make_interval(mins => v_terms.duration_min),
         total_price_min = v_terms.price_min, total_price_max = coalesce(v_terms.price_max, v_terms.price_min)
   where id = p_booking_id;
  return query
  select p_staff_id, split_part(s.display_name, ' ', 1), v.starts_at + make_interval(mins => v_terms.duration_min),
         v_terms.price_type, v_terms.price_min, v_terms.price_max
  from public.staff_members s where s.id = p_staff_id;
end $$;

-- ═══ Customer: confirm (Part 3 §4.3) ══════════════════════════════════════
create function public.confirm_booking(p_booking_id uuid, p_hold_token text,
                                       p_first_name text default null, p_last_name text default null,
                                       p_customer_note text default null, p_idempotency_key text default null)
returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid();
  v public.bookings; v_item public.booking_items; v_set public.business_settings; v_prof public.profiles;
  v_tier public.reliability_tier; v_bc public.business_customers; v_shadow public.business_customers;
  v_request boolean; v_to public.booking_status; v_name text;
begin
  if not private.is_active_customer() then
    select * into v_prof from public.profiles where id = v_uid;
    perform private.raise_code(case when v_prof.status in ('suspended', 'deleted') then 'ACCOUNT_RESTRICTED'
                                    else 'PHONE_NOT_VERIFIED' end);
  end if;
  select * into v_prof from public.profiles where id = v_uid;

  -- idempotency: a retried confirm returns the booking it already created
  if p_idempotency_key is not null then
    select * into v from public.bookings
     where customer_user_id = v_uid and idempotency_key = p_idempotency_key and status <> 'held';
    if v.id is not null then return v; end if;
  end if;

  begin
    v := private.own_hold(p_booking_id, p_hold_token);   -- the token proves ownership (anonymous → signed in)
  exception when sqlstate 'P0001' then
    -- A concurrent retry with the same key may have just confirmed this hold: return that booking.
    if p_idempotency_key is not null then
      select * into v from public.bookings
       where customer_user_id = v_uid and idempotency_key = p_idempotency_key and status <> 'held';
      if v.id is not null then return v; end if;
    end if;
    raise;
  end;
  v_item := private.single_item(p_booking_id);
  select * into v_set from public.business_settings where business_id = v.business_id;

  if not private.is_publicly_visible_location(v.location_id) or not v_set.allow_online_booking
     or v.starts_at <= now()
     or not exists (select 1 from public.services s where s.id = v_item.service_id and s.status = 'active' and s.is_online_bookable)
     or not exists (select 1 from public.staff_members s where s.id = v_item.staff_id and s.status = 'active' and s.publicly_bookable) then
    perform private.raise_code('NOT_BOOKABLE');
  end if;

  v_tier := private.reliability_tier(v_uid);
  if v_tier = 'blocked' then perform private.raise_code('CUSTOMER_BLOCKED'); end if;

  select * into v_bc from public.business_customers where business_id = v.business_id and user_id = v_uid;
  if v_bc.is_blocked_online then perform private.raise_code('CUSTOMER_BLOCKED'); end if;

  if (select count(*) from public.bookings b
      where b.business_id = v.business_id and b.customer_user_id = v_uid
        and b.status in ('pending', 'confirmed') and b.starts_at > now()) >= v_set.max_active_bookings_per_customer then
    perform private.raise_code('TOO_MANY_ACTIVE_BOOKINGS');
  end if;
  if exists (select 1 from public.bookings b
             where b.business_id = v.business_id and b.customer_user_id = v_uid and b.id <> v.id
               and b.status in ('pending', 'confirmed')
               and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v.starts_at, v.ends_at, '[)')) then
    perform private.raise_code('OVERLAP_SAME_BUSINESS');
  end if;

  -- Customer record: the user's own; an unclaimed shadow is NEVER merged here (explicit claim model)
  if v_bc.id is null then
    select * into v_shadow from public.business_customers
     where business_id = v.business_id and user_id is null and archived_at is null
       and phone_e164 = v_prof.phone_e164;
    v_name := coalesce(nullif(btrim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')), ''),
                       nullif(btrim(coalesce(v_prof.first_name, '') || ' ' || coalesce(v_prof.last_name, '')), ''),
                       'Customer');
    insert into public.business_customers (business_id, user_id, phone_e164, display_name, acquired_via)
    values (v.business_id, v_uid, v_prof.phone_e164, left(v_name, 80),
            coalesce(v_shadow.acquired_via,            -- the business already had this customer
                     case v.source when 'business_link' then 'business_link'::public.acquisition_channel
                                   else 'marketplace'::public.acquisition_channel end))
    on conflict (business_id, user_id) where user_id is not null do nothing   -- parallel confirm race
    returning * into v_bc;
    if v_bc.id is null then
      select * into v_bc from public.business_customers where business_id = v.business_id and user_id = v_uid;
    end if;
    if v_shadow.id is not null then
      insert into private.possible_duplicates (business_id, a_id, b_id)
      values (v.business_id, least(v_bc.id, v_shadow.id), greatest(v_bc.id, v_shadow.id))
      on conflict do nothing;
    end if;
  end if;

  if v_prof.first_name is null and p_first_name is not null then
    update public.profiles set first_name = left(btrim(p_first_name), 50),
                               last_name = coalesce(last_name, left(btrim(p_last_name), 50))
     where id = v_uid;
  end if;

  v_request := v_set.booking_mode = 'request' or v_tier = 'restricted';
  v_to := case when v_request then 'pending'::public.booking_status else 'confirmed'::public.booking_status end;
  perform private.assert_transition('held', v_to, 'customer');

  update public.bookings set
    status               = v_to,
    is_request           = v_request,
    -- a request never outlives the appointment start (review requirement)
    expires_at           = case when v_request
                                then least(now() + make_interval(mins => v_set.request_expiry_minutes), starts_at) end,
    customer_user_id     = v_uid,
    business_customer_id = v_bc.id,
    customer_note        = left(p_customer_note, 200),
    policy_snapshot      = private.policy_snapshot(v.business_id),
    idempotency_key      = p_idempotency_key,
    hold_token_hash      = null,
    hold_owner_user_id   = null
  where id = v.id
  returning * into v;

  update public.business_customers set first_booking_id = v.id where id = v_bc.id and first_booking_id is null;
  perform private.log_booking_event(v.id, case when v_request then 'requested' else 'confirmed' end::public.booking_event_type,
                                    'customer', 'held', v_to, jsonb_build_object('notify', true));
  perform private.recompute_business_customer_stats(v_bc.id);
  return v;
end $$;

-- ═══ Business: manual booking / walk-in (Part 3 §4.4) ═════════════════════
-- p_customer: {"business_customer_id": "..."} | {"phone": "...", "name": "..."} | null (walk-in only)
create function public.create_manual_booking(
  p_location_id uuid, p_customer jsonb, p_service_id uuid, p_staff_id uuid default null,
  p_start timestamptz default null, p_duration_override int default null, p_price_override jsonb default null,
  p_internal_note text default null, p_notify boolean default true, p_allow_outside_hours boolean default false,
  p_as_walk_in boolean default false, p_mark_completed boolean default false)
returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid();
  v_biz uuid; v_tz text; v_set public.business_settings; v_svc public.services; v_bc public.business_customers;
  v_desk boolean; v_mode public.staff_selection_mode; v_cands uuid[]; v_sid uuid; v_terms record;
  v_dur int; v_ptype public.price_type; v_pmin numeric; v_pmax numeric; v_occ tstzrange;
  v_day date; v_phone text; v_status public.booking_status; b public.bookings;
  v_bid uuid; v_chosen uuid;
begin
  select business_id, timezone into v_biz, v_tz from public.business_locations where id = p_location_id;
  if v_biz is null then perform private.raise_code('FORBIDDEN'); end if;
  v_desk := private.has_business_role(v_biz, '{owner,manager,reception}');
  if not v_desk and not (p_staff_id is not null and p_staff_id = private.my_staff_id(v_biz)) then
    perform private.raise_code('FORBIDDEN');
  end if;
  if p_allow_outside_hours and not v_desk then perform private.raise_code('FORBIDDEN'); end if;
  if p_start is null then perform private.raise_code('INVALID_SLOT'); end if;

  select * into v_set from public.business_settings where business_id = v_biz;
  select * into v_svc from public.services where id = p_service_id and business_id = v_biz and status = 'active';
  if v_svc.id is null then perform private.raise_code('NOT_BOOKABLE'); end if;

  v_day := (p_start at time zone v_tz)::date;
  if v_day < (now() at time zone v_tz)::date then perform private.raise_code('INVALID_SLOT', '{"reason":"past_day"}'); end if;
  if p_mark_completed and p_start > now() then perform private.raise_code('INVALID_SLOT', '{"reason":"future_completed"}'); end if;

  -- customer
  if p_customer ? 'business_customer_id' then
    select * into v_bc from public.business_customers
     where id = (p_customer ->> 'business_customer_id')::uuid and business_id = v_biz and archived_at is null;
    if v_bc.id is null then perform private.raise_code('NOT_FOUND', '{"field":"customer"}'); end if;
  elsif p_customer ? 'phone' then
    v_phone := private.normalize_phone(p_customer ->> 'phone');
    if v_phone is null then perform private.raise_code('INVALID_PHONE'); end if;
    select * into v_bc from public.business_customers                     -- active shadow first
     where business_id = v_biz and user_id is null and archived_at is null and phone_e164 = v_phone;
    if v_bc.id is null then                                               -- then a claimed relationship
      select * into v_bc from public.business_customers
       where business_id = v_biz and user_id is not null and archived_at is null and phone_e164 = v_phone
       order by updated_at desc limit 1;
    end if;
    if v_bc.id is null then
      -- atomic find-or-create: a parallel booking for the same new phone may be creating it right now
      insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
      values (v_biz, v_phone, left(coalesce(nullif(btrim(p_customer ->> 'name'), ''), 'Customer'), 80), 'manual')
      on conflict (business_id, phone_e164) where user_id is null and phone_e164 is not null and archived_at is null
      do nothing
      returning * into v_bc;
      if v_bc.id is null then
        select * into v_bc from public.business_customers
         where business_id = v_biz and user_id is null and archived_at is null and phone_e164 = v_phone;
      end if;
    end if;
  elsif not p_as_walk_in then
    perform private.raise_code('NOT_FOUND', '{"field":"customer"}');
  end if;

  -- staff: explicit (incl. internal-only) or Any via the business rule (internal audience)
  if p_staff_id is not null then
    select array_agg(cs.staff_id) into v_cands
    from private.candidate_staff(p_location_id, p_service_id, p_staff_id, 'internal_specific') cs;
    if v_cands is null then perform private.raise_code('NOT_BOOKABLE', '{"reason":"staff"}'); end if;
    v_mode := 'business';
  else
    select array_agg(r.staff_id order by r.rnk) into v_cands
    from private.rank_free_staff(p_location_id, p_service_id, p_start, 'internal_any', v_set.assignment_rule) r;
    if v_cands is null then perform private.raise_code('SLOT_TAKEN'); end if;
    v_mode := 'any';
  end if;

  v_status := case when p_mark_completed then 'completed'::public.booking_status else 'confirmed'::public.booking_status end;

  foreach v_sid in array v_cands loop
    select * into v_terms from private.staff_service_terms(v_sid, p_service_id);
    v_dur := coalesce(p_duration_override, v_terms.duration_min);
    if p_price_override is not null then
      v_ptype := coalesce((p_price_override ->> 'type')::public.price_type, 'fixed');
      v_pmin := (p_price_override ->> 'min')::numeric;
      v_pmax := (p_price_override ->> 'max')::numeric;
    else
      v_ptype := v_terms.price_type; v_pmin := v_terms.price_min; v_pmax := v_terms.price_max;
    end if;
    v_occ := tstzrange(p_start - make_interval(mins => v_terms.buffer_before_min),
                       p_start + make_interval(mins => v_dur + v_terms.buffer_after_min), '[)');

    if not p_allow_outside_hours
       and not (v_occ <@ (private.staff_working_time(v_sid, p_location_id, v_day, v_day)
                          - private.staff_time_off_time(v_sid, v_occ))) then
      if p_staff_id is not null then perform private.raise_code('OUTSIDE_HOURS'); end if;
      continue;
    end if;

    begin
      perform private.lock_staff(v_sid);
      insert into public.bookings (business_id, location_id, business_customer_id, customer_user_id, status, source,
                                   starts_at, ends_at, internal_note, policy_snapshot, currency,
                                   total_price_min, total_price_max, created_by_kind, created_by_user_id,
                                   confirmed_at, completed_at, completed_by_kind, review_eligible_until)
      values (v_biz, p_location_id, v_bc.id,
              v_bc.user_id,                                  -- set only for an already-claimed relationship
              v_status, case when p_as_walk_in then 'walk_in' else 'manual' end::public.booking_source,
              p_start, p_start + make_interval(mins => v_dur), left(p_internal_note, 500),
              private.policy_snapshot(v_biz), v_svc.currency, v_pmin, coalesce(v_pmax, v_pmin),
              'business', v_uid, now(),
              case when p_mark_completed then now() end,
              case when p_mark_completed then 'business'::public.actor_kind end,
              case when p_mark_completed and v_bc.user_id is not null then now() + interval '30 days' end)
      returning id into v_bid;
      insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id,
                                        staff_id, selection_mode, assignment_rule_used,
                                        starts_at, ends_at, buffer_before_min, buffer_after_min, occupied,
                                        duration_min, price_type, price_min, price_max, price_overridden)
      values (v_bid, v_biz, p_location_id, p_service_id, v_svc.canonical_service_id,
              v_sid, v_mode, case when v_mode = 'any' then v_set.assignment_rule end,
              p_start, p_start + make_interval(mins => v_dur), v_terms.buffer_before_min, v_terms.buffer_after_min,
              v_occ, v_dur, v_ptype, v_pmin, v_pmax, p_price_override is not null);
      v_chosen := v_sid;
      exit;
    exception when exclusion_violation or deadlock_detected then
      v_bid := null;
      if p_staff_id is not null then perform private.raise_code('STAFF_NOT_FREE'); end if;
    end;
  end loop;

  if v_chosen is null then perform private.raise_code('SLOT_TAKEN'); end if;

  if v_bc.id is not null then
    update public.business_customers set first_booking_id = v_bid where id = v_bc.id and first_booking_id is null;
  end if;
  perform private.log_booking_event(v_bid, 'confirmed', 'business', null, 'confirmed',
    jsonb_build_object('notify', p_notify and v_bc.phone_e164 is not null, 'outside_hours', p_allow_outside_hours,
                       'walk_in', p_as_walk_in));
  if p_mark_completed then
    perform private.log_booking_event(v_bid, 'completed', 'business', 'confirmed', 'completed', '{}');
    perform private.add_reliability_event(v_bc.user_id, v_bid, 'completed');
  end if;
  perform private.recompute_business_customer_stats(v_bc.id);
  select * into b from public.bookings where id = v_bid;
  return b;
end $$;

-- ═══ Requests ═════════════════════════════════════════════════════════════
create function public.accept_request(p_booking_id uuid) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings;
begin
  perform private.assert_booking_access(p_booking_id, false);
  select * into v from public.bookings where id = p_booking_id for update;
  perform private.assert_transition(v.status, 'confirmed', 'business');
  if v.expires_at <= now() or v.starts_at <= now() then perform private.raise_code('OUTSIDE_WINDOW'); end if;
  update public.bookings set status = 'confirmed' where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'accepted', 'business', 'pending', 'confirmed', '{"notify":true}');
  return v;
end $$;

create function public.decline_request(p_booking_id uuid, p_reason text default null) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings;
begin
  perform private.assert_booking_access(p_booking_id, false);
  select * into v from public.bookings where id = p_booking_id for update;
  if v.status <> 'pending' then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  update public.bookings set status = 'cancelled', cancelled_by_kind = 'business', cancel_reason = left(p_reason, 300)
   where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'declined', 'business', 'pending', 'cancelled',
                                    jsonb_build_object('reason', p_reason, 'notify', true));
  perform private.recompute_business_customer_stats(v.business_customer_id);
  return v;
end $$;

-- ═══ Cancellation (Part 3 §4.5) ═══════════════════════════════════════════
create function public.cancel_my_booking(p_booking_id uuid, p_reason text default null) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings; v_late boolean; v_from public.booking_status;
begin
  select * into v from public.bookings where id = p_booking_id and customer_user_id = private.uid() for update;
  if v.id is null then perform private.raise_code('FORBIDDEN'); end if;
  v_from := v.status;
  perform private.assert_transition(v.status, 'cancelled', 'customer');
  if now() >= v.starts_at then perform private.raise_code('OUTSIDE_WINDOW'); end if;
  v_late := v.status = 'confirmed'
            and now() > v.starts_at - make_interval(mins => coalesce((v.policy_snapshot ->> 'cancellation_window_minutes')::int, 0));
  update public.bookings set status = 'cancelled', cancelled_by_kind = 'customer', cancel_reason = left(p_reason, 300),
                             is_late_cancel = v_late
   where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'cancelled', 'customer', v_from, 'cancelled',
                                    jsonb_build_object('late', v_late, 'notify', true));
  if v_late then perform private.add_reliability_event(v.customer_user_id, v.id, 'late_cancel'); end if;
  perform private.recompute_business_customer_stats(v.business_customer_id);
  return v;
end $$;

create function public.biz_cancel_booking(p_booking_id uuid, p_reason text default null, p_notify boolean default true)
returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings; v_from public.booking_status;
begin
  perform private.assert_booking_access(p_booking_id, true);
  select * into v from public.bookings where id = p_booking_id for update;
  v_from := v.status;
  perform private.assert_transition(v.status, 'cancelled', 'business');
  if v.created_by_kind = 'customer' and nullif(btrim(p_reason), '') is null then
    perform private.raise_code('REASON_REQUIRED');
  end if;
  update public.bookings set status = 'cancelled', cancelled_by_kind = 'business', cancel_reason = left(p_reason, 300)
   where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'cancelled', 'business', v_from, 'cancelled',
    jsonb_build_object('reason', p_reason, 'notify', p_notify or v.created_by_kind = 'customer'));
  perform private.recompute_business_customer_stats(v.business_customer_id);
  return v;
end $$;

-- ═══ Reschedule (Part 3 §4.6): atomic in-place move ═══════════════════════
create function private.do_reschedule(p_booking_id uuid, p_new_start timestamptz, p_new_staff uuid,
                                      p_actor public.actor_kind, p_allow_outside_hours boolean,
                                      p_notify boolean default true)
returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.bookings; v_item public.booking_items; v_tz text; v_day date; v_staff uuid; v_terms record;
  v_occ tstzrange; v_changed_staff boolean;
begin
  select * into v from public.bookings where id = p_booking_id for update;
  if v.status not in ('pending', 'confirmed') or v.starts_at <= now() then
    perform private.raise_code('TRANSITION_NOT_ALLOWED');
  end if;
  v_item := private.single_item(p_booking_id);
  select timezone into v_tz from public.business_locations where id = v.location_id;
  v_day := (p_new_start at time zone v_tz)::date;
  v_staff := coalesce(p_new_staff, v_item.staff_id);
  v_changed_staff := v_staff <> v_item.staff_id;

  if p_actor = 'customer' then
    if now() > v.starts_at - make_interval(mins => coalesce((v.policy_snapshot ->> 'cancellation_window_minutes')::int, 0)) then
      perform private.raise_code('OUTSIDE_WINDOW');
    end if;
    perform private.assert_public_slot(v.location_id, p_new_start);
    if v_changed_staff and not exists (select 1 from private.candidate_staff(v.location_id, v_item.service_id, v_staff, 'public_specific')) then
      perform private.raise_code('NOT_BOOKABLE', '{"reason":"staff"}');
    end if;
  else
    if v_changed_staff and not exists (select 1 from private.candidate_staff(v.location_id, v_item.service_id, v_staff, 'internal_specific')) then
      perform private.raise_code('NOT_BOOKABLE', '{"reason":"staff"}');
    end if;
    if v_day < (now() at time zone v_tz)::date then perform private.raise_code('INVALID_SLOT'); end if;
  end if;

  if v_changed_staff then
    select * into v_terms from private.staff_service_terms(v_staff, v_item.service_id);
  else
    select v_item.duration_min as duration_min, v_item.buffer_before_min as buffer_before_min,
           v_item.buffer_after_min as buffer_after_min, v_item.price_type as price_type,
           v_item.price_min as price_min, v_item.price_max as price_max into v_terms;
  end if;
  v_occ := tstzrange(p_new_start - make_interval(mins => v_terms.buffer_before_min),
                     p_new_start + make_interval(mins => v_terms.duration_min + v_terms.buffer_after_min), '[)');

  if p_actor <> 'customer' and not p_allow_outside_hours
     and not (v_occ <@ (private.staff_working_time(v_staff, v.location_id, v_day, v_day)
                        - private.staff_time_off_time(v_staff, v_occ))) then
    perform private.raise_code('OUTSIDE_HOURS');
  end if;

  begin
    perform private.lock_staff(v_staff);
    if p_actor = 'customer'
       and not (v_occ <@ private.staff_free_time(v_staff, v.location_id, v_day, v_day, p_booking_id)) then
      perform private.signal_busy();
    end if;
    update public.booking_items set
      staff_id = v_staff, starts_at = p_new_start, ends_at = p_new_start + make_interval(mins => v_terms.duration_min),
      buffer_before_min = v_terms.buffer_before_min, buffer_after_min = v_terms.buffer_after_min,
      occupied = v_occ, duration_min = v_terms.duration_min,
      price_type = v_terms.price_type, price_min = v_terms.price_min, price_max = v_terms.price_max,
      selection_mode = case when p_actor = 'customer' and v_changed_staff then 'specific' else selection_mode end,
      requested_staff_id = case when p_actor = 'customer' and v_changed_staff then v_staff else requested_staff_id end,
      assignment_rule_used = case when p_actor = 'customer' and v_changed_staff then null else assignment_rule_used end
    where id = v_item.id;
  exception when exclusion_violation or deadlock_detected or sqlstate 'AB001' then
    perform private.raise_code('STAFF_NOT_FREE');
  end;

  update public.bookings set starts_at = p_new_start, ends_at = p_new_start + make_interval(mins => v_terms.duration_min),
         rescheduled_count = rescheduled_count + 1,
         total_price_min = v_terms.price_min, total_price_max = coalesce(v_terms.price_max, v_terms.price_min),
         -- keep a pending request's expiry within the (new) start
         expires_at = case when status = 'pending' then least(expires_at, p_new_start) else expires_at end
   where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'rescheduled', p_actor, v.status, v.status,
    jsonb_build_object('old_start', v_item.starts_at, 'new_start', p_new_start,
                       'old_staff_id', v_item.staff_id, 'new_staff_id', v_staff,
                       -- the customer is always told about a change they didn't make themselves
                       'notify', p_actor = 'customer' or p_notify or v.created_by_kind = 'customer'));
  return v;
end $$;

create function public.reschedule_my_booking(p_booking_id uuid, p_new_start timestamptz, p_staff_id uuid default null)
returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.bookings where id = p_booking_id and customer_user_id = private.uid()) then
    perform private.raise_code('FORBIDDEN');
  end if;
  return private.do_reschedule(p_booking_id, p_new_start, p_staff_id, 'customer', false, true);
end $$;

create function public.biz_reschedule_booking(p_booking_id uuid, p_new_start timestamptz, p_staff_id uuid default null,
                                              p_notify boolean default true, p_allow_outside_hours boolean default false)
returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v_biz uuid;
begin
  v_biz := private.assert_booking_access(p_booking_id, true);
  if p_allow_outside_hours and not private.has_business_role(v_biz, '{owner,manager,reception}') then
    perform private.raise_code('FORBIDDEN');
  end if;
  return private.do_reschedule(p_booking_id, p_new_start, p_staff_id, 'business', p_allow_outside_hours, p_notify);
end $$;

-- ═══ Reassign staff (same time) ═══════════════════════════════════════════
create function public.reassign_booking_item(p_item_id uuid, p_new_staff_id uuid, p_notify boolean default false)
returns public.booking_items
language plpgsql volatile security definer set search_path = '' as $$
declare v_item public.booking_items; v public.bookings; v_set public.business_settings; v_notify boolean;
begin
  select * into v_item from public.booking_items where id = p_item_id;
  if v_item.id is null then perform private.raise_code('FORBIDDEN'); end if;
  perform private.assert_booking_access(v_item.booking_id, false);
  select * into v from public.bookings where id = v_item.booking_id for update;
  if v.status not in ('pending', 'confirmed') then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  if not exists (select 1 from private.candidate_staff(v.location_id, v_item.service_id, p_new_staff_id, 'internal_specific')) then
    perform private.raise_code('NOT_BOOKABLE', '{"reason":"staff"}');
  end if;
  begin
    perform private.lock_staff(p_new_staff_id);
    update public.booking_items set staff_id = p_new_staff_id where id = p_item_id returning * into v_item;
  exception when exclusion_violation or deadlock_detected then
    perform private.raise_code('STAFF_NOT_FREE');
  end;
  select * into v_set from public.business_settings where business_id = v.business_id;
  -- a customer who chose this person is ALWAYS told (Part 3 §4.4)
  v_notify := v_item.selection_mode in ('specific', 'rebook') or p_notify
              or (v_item.selection_mode = 'any' and v_set.notify_customer_on_any_reassign);
  perform private.log_booking_event(v.id, 'staff_changed', 'business', v.status, v.status,
    jsonb_build_object('new_staff_id', p_new_staff_id, 'requested_staff_id', v_item.requested_staff_id, 'notify', v_notify));
  return v_item;
end $$;

-- ═══ Complete / no-show ═══════════════════════════════════════════════════
create function public.mark_completed(p_booking_id uuid) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings;
begin
  perform private.assert_booking_access(p_booking_id, true);
  select * into v from public.bookings where id = p_booking_id for update;
  perform private.assert_transition(v.status, 'completed', 'business');
  if v.status = 'no_show' then perform private.raise_code('TRANSITION_NOT_ALLOWED', '{"use":"undo_no_show"}'); end if;
  if now() < v.starts_at then perform private.raise_code('OUTSIDE_WINDOW'); end if;
  update public.bookings set status = 'completed', completed_by_kind = 'business',
         review_eligible_until = case when customer_user_id is not null then now() + interval '30 days' end
   where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'completed', 'business', 'confirmed', 'completed', '{}');
  perform private.add_reliability_event(v.customer_user_id, v.id, 'completed');
  perform private.recompute_business_customer_stats(v.business_customer_id);
  return v;
end $$;

create function public.mark_completed_bulk(p_booking_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; n int := 0;
begin
  foreach v_id in array coalesce(p_booking_ids, '{}') loop
    begin
      perform public.mark_completed(v_id);
      n := n + 1;
    exception when sqlstate 'P0001' then
      null;                                     -- skip bookings that can't be completed; count the rest
    end;
  end loop;
  return n;
end $$;

create function public.mark_no_show(p_booking_id uuid) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings; v_from public.booking_status;
begin
  perform private.assert_booking_access(p_booking_id, true);
  select * into v from public.bookings where id = p_booking_id for update;
  v_from := v.status;
  perform private.assert_transition(v.status, 'no_show', 'business');
  if now() < v.starts_at or now() > v.starts_at + interval '24 hours' then perform private.raise_code('OUTSIDE_WINDOW'); end if;
  update public.bookings set status = 'no_show' where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'no_show_marked', 'business', v_from, 'no_show', '{"notify":true}');
  perform private.add_reliability_event(v.customer_user_id, v.id, 'no_show', v.starts_at);
  perform private.recompute_business_customer_stats(v.business_customer_id);
  return v;
end $$;

-- The business corrects its own mistake within 24 h (not while disputed)
create function public.undo_no_show(p_booking_id uuid) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings;
begin
  perform private.assert_booking_access(p_booking_id, true);
  select * into v from public.bookings where id = p_booking_id for update;
  if v.status <> 'no_show' then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  if v.no_show_disputed or now() > v.starts_at + interval '24 hours' then perform private.raise_code('OUTSIDE_WINDOW'); end if;
  update public.bookings set status = 'completed', completed_by_kind = 'business', completed_at = now(),
         review_eligible_until = case when customer_user_id is not null then now() + interval '30 days' end
   where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'completed', 'business', 'no_show', 'completed', '{"undo_no_show":true}');
  -- exact reversal of the no-show (same occurred_at so decay matches), plus the visit itself
  perform private.add_reliability_event(v.customer_user_id, v.id, 'forgiven', v.starts_at, 'undo_no_show');
  perform private.add_reliability_event(v.customer_user_id, v.id, 'completed');
  perform private.recompute_business_customer_stats(v.business_customer_id);
  return v;
end $$;

create function public.update_booking_note(p_booking_id uuid, p_internal_note text) returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare v public.bookings;
begin
  perform private.assert_booking_access(p_booking_id, false);
  update public.bookings set internal_note = left(p_internal_note, 500) where id = p_booking_id returning * into v;
  perform private.log_booking_event(v.id, 'note_changed', 'business', v.status, v.status, '{}');
  return v;
end $$;

-- ─── Grants: signed-in callers only (anonymous-auth visitors are `authenticated`) ─
grant execute on function public.create_hold(uuid, uuid, timestamptz, uuid, public.staff_selection_mode, public.booking_source, jsonb) to authenticated;
grant execute on function public.extend_hold(uuid, text)                     to authenticated;
grant execute on function public.release_hold(uuid, text)                    to authenticated;
grant execute on function public.change_hold_staff(uuid, text, uuid)         to authenticated;
grant execute on function public.confirm_booking(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.create_manual_booking(uuid, jsonb, uuid, uuid, timestamptz, int, jsonb, text, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.accept_request(uuid)                        to authenticated;
grant execute on function public.decline_request(uuid, text)                 to authenticated;
grant execute on function public.cancel_my_booking(uuid, text)               to authenticated;
grant execute on function public.biz_cancel_booking(uuid, text, boolean)     to authenticated;
grant execute on function public.reschedule_my_booking(uuid, timestamptz, uuid) to authenticated;
grant execute on function public.biz_reschedule_booking(uuid, timestamptz, uuid, boolean, boolean) to authenticated;
grant execute on function public.reassign_booking_item(uuid, uuid, boolean)  to authenticated;
grant execute on function public.mark_completed(uuid)                        to authenticated;
grant execute on function public.mark_completed_bulk(uuid[])                 to authenticated;
grant execute on function public.mark_no_show(uuid)                          to authenticated;
grant execute on function public.undo_no_show(uuid)                          to authenticated;
grant execute on function public.update_booking_note(uuid, text)             to authenticated;

select private.assign_app_ownership();
