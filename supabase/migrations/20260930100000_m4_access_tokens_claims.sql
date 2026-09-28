-- M4 · Access tokens (WhatsApp links) and the explicit claim model
-- Spec: Phase 3 Part 2 §2.3 (Flows A/B, safe merge), Part 3 §4.2 (claim_booking, get_claimable_visits,
--       claim_visits, dismiss_claimable_visits, resolve_access_token), Part 7 §6 (tests 34–41).
-- Principle: verifying a phone links NOTHING. Every link below needs an explicit customer action.

-- ─── Schema additions ──────────────────────────────────────────────────────
-- Who consumed a single-use token (idempotent retries, support investigations)
alter table private.access_tokens add column used_by uuid references auth.users(id) on delete set null;
alter table private.access_tokens
  add constraint access_tokens_claim_bound
  check (purpose <> 'claim_visit' or (booking_id is not null and phone_e164 is not null and business_customer_id is not null));

-- Offers search customer records by phone across businesses
create index business_customers_phone_idx on public.business_customers (phone_e164) where phone_e164 is not null;

-- System-authored CRM notes (the "Also known as …" note written by a merge has no human author).
-- [M4 deviation D1] Part 2 §2.3 step 3 needs a note without an author; author stays required otherwise.
alter table public.customer_notes alter column author_user_id drop not null;
alter table public.customer_notes add column is_system boolean not null default false;
alter table public.customer_notes
  add constraint customer_notes_author_required check (is_system or author_user_id is not null);

-- ─── Small helpers ─────────────────────────────────────────────────────────
-- raise_code only raises (no writes), so it is STABLE; STABLE readers can then use it (M3 made it
-- VOLATILE by default).
alter function private.raise_code(text, jsonb) stable;

-- 256-bit random token, URL-safe
create function private.new_token() returns text
language sql volatile set search_path = '' as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

create function private.token_hash(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(coalesce(p_token, ''), 'sha256')
$$;

-- '+961 70 ••• 456' (country code, first two local digits, last three). Shown to token holders so
-- they know which number to verify; never enough to reconstruct it.
create function private.mask_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_phone is null then null
    when p_phone like '+961%' then '+961 ' || substr(p_phone, 5, 2) || ' ••• ' || right(p_phone, 3)
    else left(p_phone, 4) || ' ••• ' || right(p_phone, 3)
  end
$$;

-- The caller's verified phone (null for anonymous / unverified / inactive callers)
create function private.my_verified_phone() returns text
language sql stable security definer set search_path = '' as $$
  select p.phone_e164 from public.profiles p
  where p.id = private.uid() and not private.is_anonymous()
    and p.phone_verified_at is not null and p.status in ('active', 'warned')
$$;

-- Common identity gate for claim / invitation RPCs
create function private.require_verified_customer() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_phone text;
begin
  if private.uid() is null or private.is_anonymous() then perform private.raise_code('AUTH_REQUIRED'); end if;
  if exists (select 1 from public.profiles where id = private.uid() and status in ('suspended', 'deleted')) then
    perform private.raise_code('ACCOUNT_RESTRICTED');
  end if;
  v_phone := private.my_verified_phone();
  if v_phone is null then perform private.raise_code('PHONE_NOT_VERIFIED'); end if;
  return v_phone;
end $$;

-- ─── Issuing tokens (called by the notification sender, M7; tests call it directly) ──
-- The raw token exists only in the returned value (it goes into the WhatsApp link); the DB keeps
-- sha256. claim_visit is bound to the booking, its customer record and that record's phone, and
-- expires 30 days after the visit (Part 2 §2.3 Flow A).
create function private.issue_access_token(p_purpose text, p_booking_id uuid, p_expires_at timestamptz default null)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_b public.bookings; v_bc public.business_customers; v_token text := private.new_token(); v_exp timestamptz;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if v_b.id is null or v_b.status = 'held' then perform private.raise_code('NOT_FOUND'); end if;
  select * into v_bc from public.business_customers where id = v_b.business_customer_id;

  if p_purpose = 'claim_visit' then
    if v_bc.phone_e164 is null then perform private.raise_code('INVALID_PHONE'); end if;
    v_exp := coalesce(p_expires_at, v_b.ends_at + interval '30 days');
  elsif p_purpose = 'manage_booking' then
    v_exp := coalesce(p_expires_at, v_b.ends_at + interval '7 days');
  elsif p_purpose = 'review' then
    v_exp := coalesce(p_expires_at, v_b.review_eligible_until, v_b.ends_at + interval '30 days');
  else
    perform private.raise_code('NOT_SUPPORTED');
  end if;

  insert into private.access_tokens (token_hash, purpose, booking_id, business_customer_id, phone_e164, expires_at)
  values (private.token_hash(v_token), p_purpose, v_b.id, v_bc.id, v_bc.phone_e164, v_exp);
  return v_token;
end $$;

-- ─── resolve_access_token (Part 3 §4.2): limited summary, never claims ─────
create function public.resolve_access_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t private.access_tokens; v jsonb;
begin
  select * into t from private.access_tokens where token_hash = private.token_hash(p_token);
  if t.id is null or t.expires_at <= now() then perform private.raise_code('TOKEN_INVALID'); end if;

  select jsonb_build_object(
           'purpose', t.purpose,
           'state', case when t.used_at is not null then 'used' else 'valid' end,
           'expires_at', t.expires_at,
           'phone_hint', private.mask_phone(t.phone_e164),
           'claimable', t.purpose = 'claim_visit' and t.used_at is null and b.customer_user_id is null
                        and b.starts_at >= now() - interval '12 months',
           'booking', jsonb_build_object(
             'ref', b.ref, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
             'business_name', z.name, 'business_slug', z.slug, 'area_name', a.name_en,
             'services', (select coalesce(jsonb_agg(s.name order by bi.starts_at), '[]')
                          from public.booking_items bi join public.services s on s.id = bi.service_id
                          where bi.booking_id = b.id),
             'staff_first_name', (select split_part(st.display_name, ' ', 1)
                                  from public.booking_items bi join public.staff_members st on st.id = bi.staff_id
                                  where bi.booking_id = b.id order by bi.starts_at limit 1)))
    into v
  from public.bookings b
  join public.businesses z on z.id = b.business_id
  join public.business_locations l on l.id = b.location_id
  left join public.areas a on a.id = l.area_id
  where b.id = t.booking_id;
  if v is null then perform private.raise_code('TOKEN_INVALID'); end if;
  return v;
end $$;

-- ─── Safe merge / link (Part 2 §2.3 "Merging duplicates safely") ───────────
-- Links a business customer record to a platform user. If the user already has a record at this
-- business, the given record is merged into it: bookings and notes re-pointed, record archived with
-- merged_into_id, stats recomputed. Sets NO customer_user_id (callers do that for claimed bookings
-- only). Returns the surviving record id.
create function private.link_business_customer(p_bc_id uuid, p_uid uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_bc public.business_customers; v_own public.business_customers;
begin
  select * into v_bc from public.business_customers where id = p_bc_id for update;
  if v_bc.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if v_bc.user_id = p_uid then return v_bc.id; end if;
  if v_bc.user_id is not null then perform private.raise_code('CLAIM_CONFLICT'); end if;
  if v_bc.merged_into_id is not null then perform private.raise_code('NOT_FOUND'); end if;

  select * into v_own from public.business_customers
   where business_id = v_bc.business_id and user_id = p_uid for update;

  if v_own.id is null then
    update public.business_customers set user_id = p_uid, claimed_at = now() where id = v_bc.id;
    return v_bc.id;
  end if;

  -- Merge v_bc (shadow) into v_own (survivor). The survivor keeps its business-entered name.
  update public.bookings set business_customer_id = v_own.id where business_customer_id = v_bc.id;
  update public.customer_notes set business_customer_id = v_own.id where business_customer_id = v_bc.id;
  if lower(btrim(v_bc.display_name)) <> lower(btrim(v_own.display_name)) then
    insert into public.customer_notes (business_id, business_customer_id, author_user_id, is_system, body)
    values (v_own.business_id, v_own.id, null, true, left('Also known as ' || v_bc.display_name, 1000));
  end if;
  update public.business_customers set
    claimed_at       = coalesce(claimed_at, now()),
    first_booking_id = coalesce((select b.id from public.bookings b where b.id in (v_own.first_booking_id, v_bc.first_booking_id)
                                 order by b.created_at limit 1), first_booking_id)
  where id = v_own.id;
  update public.business_customers set merged_into_id = v_own.id, archived_at = now() where id = v_bc.id;
  update private.possible_duplicates set resolved_at = now()
   where business_id = v_bc.business_id and resolved_at is null
     and a_id = least(v_bc.id, v_own.id) and b_id = greatest(v_bc.id, v_own.id);

  perform private.recompute_business_customer_stats(v_own.id);
  perform private.recompute_business_customer_stats(v_bc.id);
  return v_own.id;
end $$;

-- ─── Flow B candidates ─────────────────────────────────────────────────────
-- Bookings in the last 12 months whose customer record carries the caller's verified phone, not
-- linked to any account, whose record isn't claimed by someone else (recycled numbers), at
-- businesses the caller hasn't dismissed since (a visit recorded after a dismissal is offered again).
create function private.claimable_candidates(p_uid uuid, p_phone text)
returns table (booking_id uuid, business_id uuid, business_customer_id uuid, starts_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, b.business_id, b.business_customer_id, b.starts_at
  from public.business_customers bc
  join public.bookings b on b.business_customer_id = bc.id
  where p_phone is not null
    and bc.phone_e164 = p_phone
    and (bc.user_id is null or bc.user_id = p_uid)
    and bc.merged_into_id is null
    and b.customer_user_id is null
    and b.status in ('confirmed', 'completed', 'no_show')
    and b.starts_at >= now() - interval '12 months'
    and not exists (select 1 from private.claim_dismissals d
                    where d.user_id = p_uid and d.business_id = b.business_id and b.created_at <= d.dismissed_at)
$$;

-- Offers reveal the minimum: business name/area, visit count, latest month. No services, staff,
-- prices or exact dates before the customer confirms (Part 7 §6 test 36).
create function public.get_claimable_visits()
returns table (business_id uuid, business_name text, area_name text, visit_count int, latest_month date)
language plpgsql stable security definer set search_path = '' as $$
declare v_phone text := private.require_verified_customer();
begin
  return query
  select c.business_id, z.name, min(a.name_en), count(*)::int,
         date_trunc('month', max(c.starts_at) at time zone 'Asia/Beirut')::date
  from private.claimable_candidates(private.uid(), v_phone) c
  join public.businesses z on z.id = c.business_id
  left join public.business_locations l on l.business_id = z.id and l.status = 'live'
  left join public.areas a on a.id = l.area_id
  group by c.business_id, z.name
  order by max(c.starts_at) desc;
end $$;

-- ─── Flow A: claim_booking(token) ──────────────────────────────────────────
create function public.claim_booking(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_phone text := private.require_verified_customer();
  v_uid uuid := private.uid();
  t private.access_tokens; v_b public.bookings; v_bc public.business_customers; v_survivor uuid;
begin
  perform private.hit_rate_limit('claim', v_uid::text, 20, interval '1 hour');
  select * into t from private.access_tokens where token_hash = private.token_hash(p_token) for update;
  if t.id is null or t.purpose <> 'claim_visit' then perform private.raise_code('TOKEN_INVALID'); end if;

  select * into v_b from public.bookings where id = t.booking_id for update;
  if v_b.id is null then perform private.raise_code('TOKEN_INVALID'); end if;

  -- Idempotent retry by the same customer
  if t.used_at is not null then
    if t.used_by = v_uid and v_b.customer_user_id = v_uid then
      return jsonb_build_object('booking_id', v_b.id, 'business_id', v_b.business_id, 'already_claimed', true);
    end if;
    perform private.raise_code('TOKEN_USED');
  end if;
  if t.expires_at <= now() then perform private.raise_code('TOKEN_EXPIRED'); end if;

  select * into v_bc from public.business_customers where id = v_b.business_customer_id;
  -- The caller's OTP-verified phone must match the token AND the booking's customer record
  if v_phone is distinct from t.phone_e164 or v_phone is distinct from v_bc.phone_e164 then
    perform private.raise_code('CLAIM_PHONE_MISMATCH');
  end if;
  if v_b.starts_at < now() - interval '12 months' then perform private.raise_code('CLAIM_TOO_OLD'); end if;
  if v_b.customer_user_id is not null and v_b.customer_user_id <> v_uid then perform private.raise_code('CLAIM_CONFLICT'); end if;

  -- The relationship (with merge) and THIS booking only
  v_survivor := private.link_business_customer(v_bc.id, v_uid);
  update public.bookings set customer_user_id = v_uid where id = v_b.id and customer_user_id is null;
  perform private.log_booking_event(v_b.id, 'claimed', 'customer', v_b.status, v_b.status,
                                    jsonb_build_object('via', 'token'));
  update private.access_tokens set used_at = now(), used_by = v_uid where id = t.id;
  perform private.recompute_business_customer_stats(v_survivor);

  return jsonb_build_object(
    'booking_id', v_b.id, 'business_id', v_b.business_id, 'already_claimed', false,
    'offers', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from public.get_claimable_visits() o));
end $$;

-- ─── Flow B: claim_visits / dismiss_claimable_visits ───────────────────────
create function public.claim_visits(p_business_ids uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_phone text := private.require_verified_customer();
  v_uid uuid := private.uid();
  r record; v_survivor uuid; v_count int := 0; v_result jsonb := '{}'::jsonb;
begin
  perform private.hit_rate_limit('claim', v_uid::text, 20, interval '1 hour');
  -- one customer record at a time; bookings of that record claimed in the same call
  for r in
    select c.business_id, c.business_customer_id, array_agg(c.booking_id) as bookings
    from private.claimable_candidates(v_uid, v_phone) c
    where c.business_id = any (coalesce(p_business_ids, '{}'))
    group by c.business_id, c.business_customer_id
    order by c.business_id, c.business_customer_id
  loop
    v_survivor := private.link_business_customer(r.business_customer_id, v_uid);
    with claimed as (
      update public.bookings set customer_user_id = v_uid
      where id = any (r.bookings) and customer_user_id is null and starts_at >= now() - interval '12 months'
      returning id, status
    )
    select count(*) into v_count from (
      select private.log_booking_event(c.id, 'claimed', 'customer', c.status, c.status, '{"via":"offer"}')
      from claimed c
    ) x;
    perform private.recompute_business_customer_stats(v_survivor);
    v_result := jsonb_set(v_result, array[r.business_id::text],
                          to_jsonb(coalesce((v_result ->> r.business_id::text)::int, 0) + v_count));
  end loop;
  return jsonb_build_object('claimed', v_result);
end $$;

create function public.dismiss_claimable_visits(p_business_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_phone text := private.require_verified_customer();
begin
  insert into private.claim_dismissals (user_id, business_id, dismissed_at)
  select private.uid(), c.business_id, now()
  from (select distinct business_id from private.claimable_candidates(private.uid(), v_phone)) c
  where c.business_id = any (coalesce(p_business_ids, '{}'))
  on conflict (user_id, business_id) do update set dismissed_at = excluded.dismissed_at;
end $$;

-- ─── Grants ────────────────────────────────────────────────────────────────
grant execute on function public.resolve_access_token(text)          to anon, authenticated;
grant execute on function public.get_claimable_visits()              to authenticated;
grant execute on function public.claim_booking(text)                 to authenticated;
grant execute on function public.claim_visits(uuid[])                to authenticated;
grant execute on function public.dismiss_claimable_visits(uuid[])    to authenticated;

select private.assign_app_ownership();
