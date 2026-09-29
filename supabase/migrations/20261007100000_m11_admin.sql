-- M11 · Admin console: businesses, customers + reliability, reviews (quarantine / restore / remove),
--       audit read, admin search, overview. Every mutating admin RPC writes exactly one audit row.
-- Spec: Phase 2 Part 4 (A1, A4–A6, A10); Phase 3 Part 5 §8, Part 6 §5; Part 7 §8 #56–57.
-- Role matrix: moderator = content; support = customers, disputes, content; ops = businesses, catalog;
-- superadmin = everything (ranking publish, legal). All require aal2 (private.is_admin).

-- ─── Helpers ───────────────────────────────────────────────────────────────
-- Caller's admin role, or FORBIDDEN (not an admin / wrong role / no MFA).
create function private.admin_caller(p_roles public.admin_role[] default null) returns public.admin_role
language plpgsql stable security definer set search_path = '' as $$
declare v public.admin_role;
begin
  if not private.is_admin(p_roles) then perform private.raise_code('FORBIDDEN'); end if;
  select role into v from public.admin_users where user_id = private.uid();
  return v;
end $$;

-- One audit row per admin action; a reason code is always required (Phase 2 Part 4: no silent edits).
create function private.admin_log(p_role public.admin_role, p_action text, p_subject_type text, p_subject_id uuid,
                                  p_business_id uuid, p_reason text, p_note text default null,
                                  p_before jsonb default null, p_after jsonb default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  insert into audit.admin_actions (actor_user_id, actor_role, action, subject_type, subject_id, business_id,
                                   reason_code, note, before, after)
  values (private.uid(), p_role, p_action, p_subject_type, p_subject_id, p_business_id, left(btrim(p_reason), 80),
          nullif(left(btrim(coalesce(p_note, '')), 1000), ''), p_before, p_after);
end $$;

-- PII masking for non-superadmin audit readers (A10): phone/email/IP/device keys at any depth.
create function private.mask_pii(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; out jsonb;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'object' then
    out := '{}';
    for k, v in select * from jsonb_each(p) loop
      out := out || jsonb_build_object(k, case
        when k ~* '(phone|email|ip_hash|user_agent|token|device)' and v <> 'null'::jsonb then to_jsonb('•••'::text)
        else private.mask_pii(v) end);
    end loop;
    return out;
  elsif jsonb_typeof(p) = 'array' then
    return coalesce((select jsonb_agg(private.mask_pii(e)) from jsonb_array_elements(p) e), '[]');
  end if;
  return p;
end $$;

-- ─── Audit gaps from earlier milestones ────────────────────────────────────
-- Case claim / release / escalation (M9/M10 RPCs change state without an audit row; decisions are
-- already audited by the decide functions). Only admin callers: system updates never pass here.
create function private.audit_case_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role public.admin_role; v_action text;
begin
  select role into v_role from public.admin_users where user_id = private.uid();
  if v_role is null then return new; end if;
  v_action := case
    when new.state = 'claimed' and old.state is distinct from 'claimed' then 'moderation.claim'
    when new.state = 'escalated' and old.state is distinct from 'escalated' then 'moderation.escalate'
    when new.state = 'open' and old.state = 'claimed' then 'moderation.release'
  end;
  if v_action is null then return new; end if;
  insert into audit.admin_actions (actor_user_id, actor_role, action, subject_type, subject_id, business_id, reason_code, note,
                                   before, after)
  values (private.uid(), v_role, v_action, new.subject_type::text, new.subject_id, new.business_id,
          replace(v_action, 'moderation.', ''), new.note,
          jsonb_build_object('case_id', old.id, 'state', old.state), jsonb_build_object('case_id', new.id, 'state', new.state));
  return new;
end $$;
create trigger moderation_cases_admin_audit after update of state on public.moderation_cases
  for each row execute function private.audit_case_transition();

-- Assisted onboarding (M5) now writes its audit row (same function otherwise).
create or replace function public.admin_create_business(
  p_name text, p_slug text, p_category_slug text, p_area_id uuid,
  p_address_line text, p_lat double precision, p_lng double precision, p_phone text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.uid(); v_biz uuid; v_loc uuid; v_phone text; v_role public.admin_role;
begin
  if not private.is_admin('{ops}') then perform private.raise_code('FORBIDDEN'); end if;
  select role into v_role from public.admin_users where user_id = v_uid;
  if p_lat is null or p_lng is null or p_lat not between 33.0 and 34.8 or p_lng not between 35.0 and 36.7 then
    perform private.raise_code('PIN_OUTSIDE_LEBANON');
  end if;
  v_phone := case when nullif(btrim(p_phone), '') is not null
                  then private.normalize_phone(private.normalize_digits(p_phone)) end;
  if p_phone is not null and btrim(p_phone) <> '' and v_phone is null then perform private.raise_code('INVALID_PHONE'); end if;

  insert into public.businesses (slug, name, primary_category_id, status, created_by)
  select lower(btrim(p_slug)), btrim(p_name), c.id, 'draft', v_uid
  from public.categories c where c.slug = p_category_slug
  returning id into v_biz;
  if v_biz is null then perform private.raise_code('NOT_FOUND', '{"field":"category"}'); end if;

  insert into public.business_locations (business_id, area_id, address_line, geo, phone_e164, whatsapp_e164, status)
  values (v_biz, p_area_id, left(btrim(p_address_line), 200),
          extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
          v_phone, v_phone, 'draft')
  returning id into v_loc;

  insert into public.business_members (business_id, user_id, role, invited_by) values (v_biz, v_uid, 'manager', v_uid);
  perform private.admin_log(v_role, 'business.create', 'business', v_biz, v_biz, 'assisted_onboarding', null, null,
                            jsonb_build_object('name', btrim(p_name), 'slug', lower(btrim(p_slug)), 'category', p_category_slug));
  return jsonb_build_object('business_id', v_biz, 'location_id', v_loc);
exception when unique_violation then
  perform private.raise_code('SLUG_UNAVAILABLE', jsonb_build_object('slug', lower(btrim(p_slug))));
  return null;   -- not reached (raise_code raises)
end $$;

-- ═══ A4 Businesses ═════════════════════════════════════════════════════════
create function private.business_cluster(p_business_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name_en)
  from public.business_locations l
  join public.cluster_areas ca on ca.area_id = l.area_id
  join public.clusters c on c.id = ca.cluster_id
  where l.business_id = p_business_id order by l.created_at limit 1
$$;

create function public.admin_list_businesses(p_q text default null, p_status public.business_status default null,
                                             p_cluster_id uuid default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform private.admin_caller('{moderator,support,ops}');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.name)
    from (
      select b.id, b.name, b.slug, b.status, b.is_test, b.verification_status, b.published_at,
             (select c.name_en from public.categories c where c.id = b.primary_category_id) as category,
             (select a.name_en from public.business_locations l join public.areas a on a.id = l.area_id
               where l.business_id = b.id order by l.created_at limit 1) as area,
             private.business_cluster(b.id) as cluster,
             (select count(*) from public.bookings k where k.business_id = b.id and k.status in ('confirmed', 'completed', 'no_show')
               and k.starts_at > now() - interval '30 days')::int as bookings_30d,
             (select s.display_rating from public.business_rating_summary s where s.business_id = b.id) as rating,
             (select count(*) from public.reports r where r.subject_business_id = b.id and r.status in ('open', 'in_review'))::int as open_reports,
             exists (select 1 from public.business_members m where m.business_id = b.id and m.role = 'owner' and m.status = 'active') as owner_claimed
      from public.businesses b
      where (p_status is null or b.status = p_status)
        and (v_q is null or b.name ilike '%' || v_q || '%' or b.slug::text ilike '%' || v_q || '%'
             or exists (select 1 from public.business_locations l where l.business_id = b.id
                        and l.phone_e164 like '%' || private.normalize_digits(v_q) || '%' and length(private.normalize_digits(v_q)) >= 6))
        and (p_cluster_id is null or exists (select 1 from public.business_locations l join public.cluster_areas ca on ca.area_id = l.area_id
                                             where l.business_id = b.id and ca.cluster_id = p_cluster_id))
      order by b.name
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
    ) x), '[]');
end $$;

create function public.admin_get_business(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.businesses; v_role public.admin_role;
begin
  v_role := private.admin_caller('{moderator,support,ops}');
  select * into b from public.businesses where id = p_business_id;
  if b.id is null then perform private.raise_code('NOT_FOUND'); end if;
  return jsonb_build_object(
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status, 'status_reason', b.status_reason,
                                   'verification_status', b.verification_status, 'verified_at', b.verified_at, 'is_test', b.is_test,
                                   'published_at', b.published_at, 'created_at', b.created_at,
                                   'category', (select c.name_en from public.categories c where c.id = b.primary_category_id),
                                   'cluster', private.business_cluster(b.id)),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'area', a.name_en, 'address', l.address_line,
                                   'phone', case when v_role in ('support', 'ops', 'superadmin') then l.phone_e164 end, 'status', l.status)
                                   order by l.created_at)
                           from public.business_locations l join public.areas a on a.id = l.area_id where l.business_id = b.id), '[]'),
    'checklist', public.get_go_live_checklist(b.id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'status', m.status,
                                   'name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
                                   'phone', case when v_role in ('support', 'ops', 'superadmin') then p.phone_e164 end) order by m.role)
                         from public.business_members m left join public.profiles p on p.id = m.user_id
                         where m.business_id = b.id), '[]'),
    'stats', jsonb_build_object(
      'upcoming', (select count(*) from public.bookings k where k.business_id = b.id and k.status in ('confirmed', 'pending') and k.starts_at > now())::int,
      'bookings_30d', (select count(*) from public.bookings k where k.business_id = b.id and k.status in ('confirmed', 'completed', 'no_show')
                        and k.starts_at > now() - interval '30 days')::int,
      'completed_30d', (select count(*) from public.bookings k where k.business_id = b.id and k.status = 'completed'
                         and k.starts_at > now() - interval '30 days')::int,
      'no_shows_30d', (select count(*) from public.bookings k where k.business_id = b.id and k.status = 'no_show'
                        and k.starts_at > now() - interval '30 days')::int,
      'rating', (select to_jsonb(s) - 'business_id' from public.business_rating_summary s where s.business_id = b.id)),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'status', r.status, 'subject_type', r.subject_type,
                                   'created_at', r.created_at) order by r.created_at desc)
                         from (select * from public.reports r where r.subject_business_id = b.id or r.reporter_business_id = b.id
                               order by r.created_at desc limit 20) r), '[]'),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'status', d.status, 'outcome', d.outcome,
                                   'created_at', d.created_at) order by d.created_at desc)
                          from (select * from public.disputes d where d.business_id = b.id and (d.type <> 'legal' or v_role = 'superadmin')
                                order by d.created_at desc limit 20) d), '[]'));
end $$;

-- Publish / pause / suspend / close. Suspending or closing a business with upcoming bookings needs an
-- explicit choice (A4): 'keep' (bookings stay valid) or 'cancel' (cancelled by the business, customers told).
create function public.admin_set_business_status(p_business_id uuid, p_status public.business_status, p_reason text,
                                                 p_note text default null, p_upcoming text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role public.admin_role; b public.businesses; v_upcoming int; v_missing jsonb; v_cancelled int := 0; k record;
begin
  v_role := private.admin_caller('{ops}');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  select * into b from public.businesses where id = p_business_id for update;
  if b.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if p_status = 'draft' or p_status = b.status then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;

  if p_status = 'live' then
    select coalesce(jsonb_agg(e -> 'key'), '[]') into v_missing
    from jsonb_array_elements(public.get_go_live_checklist(b.id)) e where not (e ->> 'ok')::boolean;
    if jsonb_array_length(v_missing) > 0 then
      perform private.raise_code('GO_LIVE_BLOCKED', jsonb_build_object('missing', v_missing));
    end if;
  end if;

  if p_status in ('suspended', 'closed') then
    select count(*) into v_upcoming from public.bookings
     where business_id = b.id and status in ('confirmed', 'pending') and starts_at > now();
    if v_upcoming > 0 and coalesce(p_upcoming, '') not in ('keep', 'cancel') then
      perform private.raise_code('UPCOMING_BOOKINGS', jsonb_build_object('count', v_upcoming));
    end if;
    if v_upcoming > 0 and p_upcoming = 'cancel' then
      for k in select id, status from public.bookings
                where business_id = b.id and status in ('confirmed', 'pending') and starts_at > now() for update loop
        update public.bookings set status = 'cancelled', cancelled_by_kind = 'business',
               cancel_reason = 'The business is no longer taking bookings.' where id = k.id;
        -- the M7/M9 event trigger sends "cancelled by the business" to the customer
        perform private.log_booking_event(k.id, 'cancelled', 'admin', k.status, 'cancelled',
          jsonb_build_object('reason', 'The business is no longer taking bookings.', 'notify', true, 'admin_status', p_status));
        v_cancelled := v_cancelled + 1;
      end loop;
    end if;
  end if;

  update public.businesses set status = p_status, status_reason = left(btrim(p_reason), 200),
         published_at = case when p_status = 'live' then coalesce(published_at, now()) else published_at end
   where id = b.id;
  update public.business_locations set status = case when p_status = 'live' then 'live' else 'paused' end::public.location_status
   where business_id = b.id and status <> 'closed' and (p_status <> 'live' or status in ('draft', 'paused'));
  perform private.admin_log(v_role, 'business.status', 'business', b.id, b.id, p_reason, p_note,
                            jsonb_build_object('status', b.status),
                            jsonb_build_object('status', p_status, 'upcoming', coalesce(p_upcoming, 'none'), 'cancelled', v_cancelled));
  return jsonb_build_object('status', p_status, 'cancelled', v_cancelled);
end $$;

-- Verification is a placeholder (Soon): a flag + timestamp, audited.
create function public.admin_verify_business(p_business_id uuid, p_verified boolean, p_reason text, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; b public.businesses;
begin
  v_role := private.admin_caller('{ops}');
  select * into b from public.businesses where id = p_business_id for update;
  if b.id is null then perform private.raise_code('NOT_FOUND'); end if;
  update public.businesses set verification_status = case when p_verified then 'verified' else 'unverified' end::public.verification_status,
         verified_at = case when p_verified then now() end where id = b.id;
  perform private.admin_log(v_role, 'business.verify', 'business', b.id, b.id, p_reason, p_note,
                            jsonb_build_object('verification_status', b.verification_status),
                            jsonb_build_object('verification_status', case when p_verified then 'verified' else 'unverified' end));
end $$;

-- Test businesses are excluded from overview counts (A1) and later from discovery.
create function public.admin_set_business_test(p_business_id uuid, p_is_test boolean, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; b public.businesses;
begin
  v_role := private.admin_caller('{ops}');
  select * into b from public.businesses where id = p_business_id for update;
  if b.id is null then perform private.raise_code('NOT_FOUND'); end if;
  update public.businesses set is_test = p_is_test where id = b.id;
  perform private.admin_log(v_role, 'business.test_flag', 'business', b.id, b.id, p_reason, null,
                            jsonb_build_object('is_test', b.is_test), jsonb_build_object('is_test', p_is_test));
end $$;

-- ═══ A5 Customers ══════════════════════════════════════════════════════════
create function public.admin_search_customers(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := btrim(coalesce(p_q, '')); v_digits text := private.normalize_digits(btrim(coalesce(p_q, '')));
begin
  perform private.admin_caller('{support}');
  if length(v_q) < 2 then return '[]'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x))
    from (
      select p.id, nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as name,
             p.phone_e164 as phone, p.status, p.created_at,
             (select count(*) from public.bookings k where k.customer_user_id = p.id)::int as bookings
      from public.profiles p
      where p.status <> 'deleted'
        and ((length(v_digits) >= 6 and p.phone_e164 like '%' || v_digits || '%')
             or (p.first_name || ' ' || coalesce(p.last_name, '')) ilike '%' || v_q || '%'
             or p.id in (select k.customer_user_id from public.bookings k where k.ref = upper(v_q)))
      order by p.created_at desc limit 25) x), '[]');
end $$;

create function public.admin_get_customer(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; r private.customer_reliability;
begin
  perform private.admin_caller('{support}');
  select * into p from public.profiles where id = p_user_id;
  if p.id is null then perform private.raise_code('NOT_FOUND'); end if;
  select * into r from private.customer_reliability where user_id = p.id;
  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'phone', p.phone_e164,
                                  'status', p.status, 'status_reason', p.status_reason, 'created_at', p.created_at,
                                  'is_admin', exists (select 1 from public.admin_users a where a.user_id = p.id and a.is_active)),
    -- internals: admin only (a business sees just the coarse label)
    'reliability', jsonb_build_object('score', coalesce(r.score, 0), 'tier', coalesce(r.tier::text, 'new'), 'computed_at', r.computed_at,
      'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'weight', e.weight, 'occurred_at', e.occurred_at,
                                   'booking_id', e.booking_id, 'booking_ref', k.ref, 'business', z.name, 'note', e.note)
                                   order by e.occurred_at desc)
                          from private.reliability_events e
                          left join public.bookings k on k.id = e.booking_id
                          left join public.businesses z on z.id = k.business_id
                          where e.user_id = p.id and e.occurred_at > now() - interval '180 days'), '[]')),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'ref', k.ref, 'business', z.name, 'starts_at', k.starts_at,
                                   'status', k.status, 'source', k.source, 'no_show_disputed', k.no_show_disputed,
                                   'forgiven', exists (select 1 from private.reliability_events e where e.booking_id = k.id
                                                       and e.kind in ('forgiven', 'dispute_overturned')))
                                   order by k.starts_at desc)
                          from (select * from public.bookings k where k.customer_user_id = p.id order by k.starts_at desc limit 50) k
                          join public.businesses z on z.id = k.business_id), '[]'),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'business', z.name, 'overall', v.overall, 'status', v.status,
                                   'rating_state', v.rating_state, 'text_state', v.text_state, 'created_at', v.created_at)
                                   order by v.created_at desc)
                         from public.reviews v join public.businesses z on z.id = v.business_id where v.author_user_id = p.id), '[]'),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'status', d.status, 'outcome', d.outcome,
                                   'created_at', d.created_at) order by d.created_at desc)
                          from public.disputes d where d.customer_user_id = p.id and d.type <> 'legal'), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'status', n.status, 'channel', n.channel_override,
                                   'attempts', n.attempts, 'last_error', n.last_error, 'created_at', n.created_at, 'sent_at', n.sent_at)
                                   order by n.created_at desc)
                               from (select * from public.notifications n where n.recipient_user_id = p.id
                                     order by n.created_at desc limit 50) n), '[]'));
end $$;

-- Warn / suspend / reactivate. Admin accounts are managed by a superadmin only; nobody changes their own.
create function public.admin_set_user_status(p_user_id uuid, p_status public.user_status, p_reason text, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; p public.profiles;
begin
  v_role := private.admin_caller('{support}');
  if p_status not in ('active', 'warned', 'suspended') then perform private.raise_code('INVALID_INPUT', '{"field":"status"}'); end if;
  if p_user_id = private.uid() then perform private.raise_code('FORBIDDEN'); end if;
  if exists (select 1 from public.admin_users a where a.user_id = p_user_id and a.is_active) and v_role <> 'superadmin' then
    perform private.raise_code('FORBIDDEN');
  end if;
  select * into p from public.profiles where id = p_user_id for update;
  if p.id is null or p.status = 'deleted' then perform private.raise_code('NOT_FOUND'); end if;
  update public.profiles set status = p_status, status_reason = left(btrim(coalesce(p_reason, '')), 200) where id = p.id;
  perform private.admin_log(v_role, 'user.status', 'user', p.id, null, p_reason, p_note,
                            jsonb_build_object('status', p.status), jsonb_build_object('status', p_status));
end $$;

-- Forgive a no-show: exact reversal (same occurred_at as the penalty, so decay matches — as undo_no_show).
create function public.admin_forgive_reliability(p_booking_id uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; k public.bookings; v_before jsonb; v_tier public.reliability_tier;
begin
  v_role := private.admin_caller('{support}');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  select * into k from public.bookings where id = p_booking_id for update;
  if k.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if k.status <> 'no_show' or k.customer_user_id is null then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  if exists (select 1 from private.reliability_events e where e.booking_id = k.id and e.kind in ('forgiven', 'dispute_overturned')) then
    perform private.raise_code('ALREADY_DONE');
  end if;
  select to_jsonb(r) into v_before from private.customer_reliability r where r.user_id = k.customer_user_id;
  perform private.add_reliability_event(k.customer_user_id, k.id, 'forgiven', k.starts_at, 'admin: ' || left(btrim(p_reason), 60));
  v_tier := private.reliability_tier(k.customer_user_id);
  perform private.admin_log(v_role, 'reliability.forgive', 'booking', k.id, k.business_id, p_reason, p_note, v_before,
                            (select to_jsonb(r) from private.customer_reliability r where r.user_id = k.customer_user_id));
  return jsonb_build_object('tier', v_tier);
end $$;

-- ═══ A6 Reviews ════════════════════════════════════════════════════════════
create function public.admin_list_reviews(p_business_id uuid default null, p_status public.review_status default null,
                                          p_rating_state public.rating_state default null, p_stars int default null,
                                          p_q text default null, p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform private.admin_caller('{moderator,support}');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select v.id, v.created_at, v.overall, v.trust_tier, v.base_weight, v.fraud_multiplier, v.status, v.rating_state, v.text_state,
             left(coalesce(v.text_display, v.text_original), 140) as snippet, v.business_id, z.name as business,
             nullif(btrim(coalesce(p.first_name, '') || ' ' || left(coalesce(p.last_name, ''), 1)), '') as author
      from public.reviews v
      join public.businesses z on z.id = v.business_id
      left join public.profiles p on p.id = v.author_user_id
      where (p_business_id is null or v.business_id = p_business_id)
        and (p_status is null or v.status = p_status)
        and (p_rating_state is null or v.rating_state = p_rating_state)
        and (p_stars is null or v.overall = p_stars)
        and (v_q is null or z.name ilike '%' || v_q || '%' or v.text_original ilike '%' || v_q || '%')
      order by v.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x), '[]');
end $$;

create function public.admin_get_review(p_review_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.reviews; v_half numeric;
begin
  perform private.admin_caller('{moderator,support}');
  select * into v from public.reviews where id = p_review_id;
  if v.id is null then perform private.raise_code('NOT_FOUND'); end if;
  v_half := 180;   -- ranking v1 half-life (the ranking config owns it from M12)
  return jsonb_build_object(
    'review', to_jsonb(v) - 'idempotency_key',
    'business', (select jsonb_build_object('id', z.id, 'name', z.name, 'slug', z.slug) from public.businesses z where z.id = v.business_id),
    'service', (select s.name from public.services s where s.id = v.service_id),
    'staff', (select st.display_name from public.staff_members st where st.id = v.staff_id),
    'ratings', coalesce((select jsonb_object_agg(d.key, rr.score) from public.review_ratings rr
                         join public.rating_dimensions d on d.id = rr.dimension_id where rr.review_id = v.id), '{}'),
    'author', (select jsonb_build_object('id', p.id, 'name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
                                         'status', p.status, 'joined', p.created_at,
                                         'reviews', (select count(*) from public.reviews x where x.author_user_id = p.id)::int)
               from public.profiles p where p.id = v.author_user_id),
    'weight', jsonb_build_object('base', v.base_weight, 'fraud_multiplier', v.fraud_multiplier,
                                 'decay', round(power(0.5, extract(epoch from (now() - v.visit_at)) / 86400.0 / v_half)::numeric, 3),
                                 'counted', private.rating_is_counted(v)),
    'fraud_signals', coalesce((select jsonb_agg(jsonb_build_object('signal', f.signal, 'score', f.score, 'status', f.status,
                                     'created_at', f.created_at) order by f.created_at)
                               from private.fraud_signals f where f.subject_type = 'review' and f.subject_id = v.id), '[]'),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('stage', m.stage, 'outcome', m.outcome, 'labels', m.labels, 'model', m.model,
                              'created_at', m.created_at) order by m.created_at)
                        from private.moderation_results m where m.subject_type = 'review_text' and m.subject_id = v.id), '[]'),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'source', c.source, 'state', c.state, 'decision', c.decision,
                             'reason', c.decision_reason_code, 'created_at', c.created_at) order by c.created_at)
                       from public.moderation_cases c where c.subject_id = v.id), '[]'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'status', r.status, 'reporter', r.reporter_kind,
                               'created_at', r.created_at) order by r.created_at)
                         from public.reports r where r.subject_id = v.id), '[]'),
    'booking_events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'actor', e.actor_kind, 'to', e.to_status,
                                      'created_at', e.created_at) order by e.created_at)
                                from public.booking_events e where e.booking_id = v.booking_id), '[]'));
end $$;

-- Quarantine = weight 0 while investigating (hidden like an M9 fraud hold); reversible.
create function public.admin_quarantine_review(p_review_id uuid, p_reason text, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v public.reviews; v_after jsonb;
begin
  v_role := private.admin_caller('{moderator,support}');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  select * into v from public.reviews where id = p_review_id for update;
  if v.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if v.rating_state not in ('pending_check', 'active') then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  update public.reviews set rating_state = 'quarantined', fraud_multiplier = 0,
         status = case when status = 'published' then 'pending'::public.review_status else status end
   where id = v.id returning jsonb_build_object('status', status, 'rating_state', rating_state, 'fraud_multiplier', fraud_multiplier) into v_after;
  perform private.recompute_rating_summary(v.business_id);
  perform private.admin_log(v_role, 'review.quarantine', 'review', v.id, v.business_id, p_reason, p_note,
                            jsonb_build_object('status', v.status, 'rating_state', v.rating_state, 'fraud_multiplier', v.fraud_multiplier), v_after);
end $$;

-- Restore a quarantined or admin-removed review (never one its author deleted).
create function public.admin_restore_review(p_review_id uuid, p_reason text, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v public.reviews; v_after jsonb;
begin
  v_role := private.admin_caller('{moderator,support}');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  select * into v from public.reviews where id = p_review_id for update;
  if v.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if v.status = 'deleted_by_author' or v.rating_state not in ('quarantined', 'removed') then
    perform private.raise_code('TRANSITION_NOT_ALLOWED');
  end if;
  update public.reviews set rating_state = 'active', fraud_multiplier = 1, status = 'published',
         published_at = coalesce(published_at, now()), removed_at = null, removed_reason = null
   where id = v.id returning jsonb_build_object('status', status, 'rating_state', rating_state, 'fraud_multiplier', fraud_multiplier) into v_after;
  update private.fraud_signals set status = 'dismissed', reviewed_by = private.uid(), reviewed_at = now()
   where subject_type = 'review' and subject_id = v.id and status = 'open';
  perform private.recompute_rating_summary(v.business_id);
  perform private.admin_log(v_role, 'review.restore', 'review', v.id, v.business_id, p_reason, p_note,
                            jsonb_build_object('status', v.status, 'rating_state', v.rating_state, 'fraud_multiplier', v.fraud_multiplier), v_after);
end $$;

-- Remove the comment only (stars stay) or the whole review.
create function public.admin_remove_review(p_review_id uuid, p_part text, p_reason text, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v public.reviews; v_after jsonb;
begin
  v_role := private.admin_caller('{moderator,support}');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  if p_part not in ('text', 'review') then perform private.raise_code('INVALID_INPUT', '{"field":"part"}'); end if;
  select * into v from public.reviews where id = p_review_id for update;
  if v.id is null or v.status = 'deleted_by_author' then perform private.raise_code('NOT_FOUND'); end if;
  if p_part = 'text' then
    if v.text_state is null or v.text_state = 'removed' then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
    update public.reviews set text_state = 'removed' where id = v.id
    returning jsonb_build_object('text_state', text_state) into v_after;
  else
    if v.status = 'removed' then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
    update public.reviews set status = 'removed', rating_state = 'removed', removed_at = now(), removed_reason = left(btrim(p_reason), 80),
           text_state = case when text_state is not null then 'removed'::public.content_state end
     where id = v.id returning jsonb_build_object('status', status, 'rating_state', rating_state, 'text_state', text_state) into v_after;
  end if;
  perform private.recompute_rating_summary(v.business_id);
  perform private.admin_log(v_role, 'review.remove_' || p_part, 'review', v.id, v.business_id, p_reason, p_note,
                            jsonb_build_object('status', v.status, 'rating_state', v.rating_state, 'text_state', v.text_state), v_after);
end $$;

-- ═══ A10 Audit log (unified, append-only sources) ══════════════════════════
-- Sources: admin actions, entity changes (business-side config, catalog, members, admin users), booking
-- events. Cursor = created_at of the last row. PII masked for everyone but superadmin.
create function public.admin_get_audit(p_filters jsonb default '{}', p_before timestamptz default null, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role; f jsonb := coalesce(p_filters, '{}'); v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_source text := f ->> 'source'; v_subject uuid := (f ->> 'subject_id')::uuid; v_biz uuid := (f ->> 'business_id')::uuid;
  v_actor uuid := (f ->> 'actor_user_id')::uuid; v_action text := nullif(f ->> 'action', '');
  v_type text := nullif(f ->> 'subject_type', ''); v_from timestamptz := (f ->> 'from')::timestamptz;
  v_to timestamptz := coalesce(p_before, (f ->> 'to')::timestamptz, now() + interval '1 minute');
  v_rows jsonb;
begin
  v_role := private.admin_caller();
  with a as (
    select 'admin'::text as source, x.created_at, x.id::text as id, x.actor_user_id, x.actor_role::text as actor_role, x.action,
           x.subject_type, x.subject_id, x.business_id, x.reason_code as reason, x.note, x.before, x.after
    from audit.admin_actions x
    where (v_source is null or v_source = 'admin') and x.created_at < v_to and (v_from is null or x.created_at >= v_from)
      and (v_subject is null or x.subject_id = v_subject) and (v_biz is null or x.business_id = v_biz)
      and (v_actor is null or x.actor_user_id = v_actor) and (v_action is null or x.action like v_action || '%')
      and (v_type is null or x.subject_type = v_type)
    order by x.created_at desc limit v_limit
  ), e as (
    select case when x.actor_kind = 'system' then 'system' when x.actor_kind = 'admin' then 'admin' else 'business' end as source,
           x.created_at, 'e' || x.id, x.actor_user_id, x.actor_kind::text, x.table_name || '.' || lower(x.op),
           x.table_name, x.row_id, x.business_id, null::text, null::text, null::jsonb, x.changed
    from audit.entity_changes x
    where (v_source is null or v_source = case when x.actor_kind = 'system' then 'system' when x.actor_kind = 'admin' then 'admin' else 'business' end)
      and x.created_at < v_to and (v_from is null or x.created_at >= v_from)
      and (v_subject is null or x.row_id = v_subject) and (v_biz is null or x.business_id = v_biz)
      and (v_actor is null or x.actor_user_id = v_actor) and (v_action is null or (x.table_name || '.' || lower(x.op)) like v_action || '%')
      and (v_type is null or x.table_name = v_type)
    order by x.created_at desc limit v_limit
  ), k as (
    select case x.actor_kind when 'customer' then 'customer' when 'system' then 'system' when 'admin' then 'admin' else 'business' end,
           x.created_at, 'b' || x.id, x.actor_user_id, x.actor_kind::text, 'booking.' || x.event,
           'booking', x.booking_id, x.business_id, null::text, null::text,
           jsonb_build_object('status', x.from_status), jsonb_build_object('status', x.to_status) || x.data
    from public.booking_events x
    where (v_source is null or v_source = case x.actor_kind when 'customer' then 'customer' when 'system' then 'system'
                                                            when 'admin' then 'admin' else 'business' end)
      and x.created_at < v_to and (v_from is null or x.created_at >= v_from)
      and (v_subject is null or x.booking_id = v_subject) and (v_biz is null or x.business_id = v_biz)
      and (v_actor is null or x.actor_user_id = v_actor) and (v_action is null or ('booking.' || x.event) like v_action || '%')
      and (v_type is null or v_type = 'booking')
    order by x.created_at desc limit v_limit
  ), u as (select * from a union all select * from e union all select * from k order by created_at desc limit v_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', u.source, 'id', u.id, 'created_at', u.created_at, 'actor_user_id', u.actor_user_id, 'actor_role', u.actor_role,
           'actor', (select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') from public.profiles p where p.id = u.actor_user_id),
           'action', u.action, 'subject_type', u.subject_type, 'subject_id', u.subject_id, 'business_id', u.business_id,
           'business', (select z.name from public.businesses z where z.id = u.business_id),
           'reason', u.reason, 'note', u.note,
           'before', case when v_role = 'superadmin' then u.before else private.mask_pii(u.before) end,
           'after', case when v_role = 'superadmin' then u.after else private.mask_pii(u.after) end)
         order by u.created_at desc), '[]')
    into v_rows from u;
  return v_rows;
end $$;

-- ═══ Admin search (header search box) ══════════════════════════════════════
create function public.admin_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.admin_role; v_q text := btrim(coalesce(p_q, '')); v_digits text;
begin
  v_role := private.admin_caller();
  if length(v_q) < 2 then return jsonb_build_object('businesses', '[]'::jsonb, 'customers', '[]'::jsonb, 'bookings', '[]'::jsonb); end if;
  v_digits := private.normalize_digits(v_q);
  return jsonb_build_object(
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'status', b.status))
                            from (select * from public.businesses b
                                  where b.name ilike '%' || v_q || '%' or b.slug::text ilike '%' || v_q || '%'
                                  order by b.name limit 8) b), '[]'),
    'customers', case when v_role in ('support', 'superadmin') then coalesce((
                   select jsonb_agg(jsonb_build_object('id', p.id, 'phone', p.phone_e164, 'status', p.status,
                                    'name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')))
                   from (select * from public.profiles p where p.status <> 'deleted'
                           and ((length(v_digits) >= 6 and p.phone_e164 like '%' || v_digits || '%')
                                or (p.first_name || ' ' || coalesce(p.last_name, '')) ilike '%' || v_q || '%')
                         order by p.created_at desc limit 8) p), '[]') else '[]' end,
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'ref', k.ref, 'business_id', k.business_id, 'status', k.status,
                                  'starts_at', k.starts_at, 'customer_user_id', case when v_role in ('support', 'superadmin') then k.customer_user_id end))
                          from (select * from public.bookings k where k.ref = upper(v_q) limit 5) k), '[]'));
end $$;

-- ═══ A1 Overview ═══════════════════════════════════════════════════════════
create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.admin_role; v_day timestamptz := date_trunc('day', now() at time zone 'Asia/Beirut') at time zone 'Asia/Beirut';
begin
  v_role := private.admin_caller();
  return jsonb_build_object(
    'queues', jsonb_build_object(
      'images', (select jsonb_build_object('count', count(*), 'oldest', min(created_at), 'overdue', count(*) filter (where sla_due_at < now()))
                 from public.moderation_cases where state in ('open', 'claimed', 'escalated') and subject_type in ('review_media', 'business_media')),
      'text', (select jsonb_build_object('count', count(*), 'oldest', min(created_at), 'overdue', count(*) filter (where sla_due_at < now()))
               from public.moderation_cases where state in ('open', 'claimed', 'escalated') and subject_type in ('review_text', 'reply_text', 'staff_bio', 'business_text')),
      'reports', (select jsonb_build_object('count', count(*), 'oldest', min(created_at)) from public.reports where status in ('open', 'in_review')),
      'disputes', (select jsonb_build_object('count', count(*), 'oldest', min(created_at), 'overdue', count(*) filter (where due_at < now()),
                                             'by_type', coalesce(jsonb_object_agg(t, n) filter (where t is not null), '{}'))
                   from (select d.type::text as t, count(*) over (partition by d.type) as n, d.created_at, d.due_at
                         from public.disputes d where d.status in ('open', 'awaiting_info')
                           and (d.type <> 'legal' or v_role = 'superadmin')) s)),
    'clusters', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name_en, 'target', c.target_businesses,
               'live', (select count(distinct b.id) from public.businesses b join public.business_locations l on l.business_id = b.id
                        join public.cluster_areas ca on ca.area_id = l.area_id
                        where ca.cluster_id = c.id and b.status = 'live' and not b.is_test),
               'by_category', coalesce((select jsonb_object_agg(cat, n) from (
                        select cg.name_en as cat, count(distinct b.id) as n from public.businesses b
                        join public.categories cg on cg.id = b.primary_category_id
                        join public.business_locations l on l.business_id = b.id join public.cluster_areas ca on ca.area_id = l.area_id
                        where ca.cluster_id = c.id and b.status = 'live' and not b.is_test group by cg.name_en) q), '{}'),
               'bookings_today', (select count(*) from public.bookings k join public.business_locations l on l.id = k.location_id
                        join public.cluster_areas ca on ca.area_id = l.area_id join public.businesses b on b.id = k.business_id
                        where ca.cluster_id = c.id and not b.is_test and k.created_at >= v_day and k.status <> 'held'),
               'bookings_7d', (select count(*) from public.bookings k join public.business_locations l on l.id = k.location_id
                        join public.cluster_areas ca on ca.area_id = l.area_id join public.businesses b on b.id = k.business_id
                        where ca.cluster_id = c.id and not b.is_test and k.created_at >= now() - interval '7 days' and k.status <> 'held'),
               'completion_rate', (select round(avg((k.status = 'completed')::int)::numeric, 2) from public.bookings k
                        join public.business_locations l on l.id = k.location_id join public.cluster_areas ca on ca.area_id = l.area_id
                        join public.businesses b on b.id = k.business_id
                        where ca.cluster_id = c.id and not b.is_test and k.status in ('completed', 'no_show') and k.starts_at > now() - interval '30 days'),
               'marketplace_share', (select round(avg((k.source::text like 'marketplace%')::int)::numeric, 2) from public.bookings k
                        join public.business_locations l on l.id = k.location_id join public.cluster_areas ca on ca.area_id = l.area_id
                        join public.businesses b on b.id = k.business_id
                        where ca.cluster_id = c.id and not b.is_test and k.created_at > now() - interval '30 days'
                          and k.status in ('confirmed', 'completed', 'no_show')))
             order by c.sort)
      from public.clusters c), '[]'),
    'alerts', jsonb_build_object(
      'notifications_failed_24h', (select count(*) from public.notifications where status = 'failed' and created_at > now() - interval '24 hours'),
      'notifications_total_24h', (select count(*) from public.notifications where created_at > now() - interval '24 hours'),
      'notifications_stuck', (select count(*) from public.notifications where status = 'queued' and scheduled_for < now() - interval '15 minutes'),
      'media_errors_24h', (select count(*) from public.moderation_cases where 'processing_error' = any (reasons)
                           and created_at > now() - interval '24 hours')),
    'today', jsonb_build_object(
      'new_customers', (select count(*) from public.profiles where created_at >= v_day),
      'new_bookings', (select count(*) from public.bookings k join public.businesses b on b.id = k.business_id
                       where k.created_at >= v_day and k.status <> 'held' and not b.is_test),
      'reviews', (select count(*) from public.reviews where created_at >= v_day),
      'results', (select count(*) from public.review_media where created_at >= v_day)));
end $$;

-- ─── Grants ────────────────────────────────────────────────────────────────
revoke execute on function private.admin_caller(public.admin_role[]), private.admin_log(public.admin_role, text, text, uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_list_businesses(text, public.business_status, uuid, int, int) to authenticated;
grant execute on function public.admin_get_business(uuid) to authenticated;
grant execute on function public.admin_set_business_status(uuid, public.business_status, text, text, text) to authenticated;
grant execute on function public.admin_verify_business(uuid, boolean, text, text) to authenticated;
grant execute on function public.admin_set_business_test(uuid, boolean, text) to authenticated;
grant execute on function public.admin_search_customers(text) to authenticated;
grant execute on function public.admin_get_customer(uuid) to authenticated;
grant execute on function public.admin_set_user_status(uuid, public.user_status, text, text) to authenticated;
grant execute on function public.admin_forgive_reliability(uuid, text, text) to authenticated;
grant execute on function public.admin_list_reviews(uuid, public.review_status, public.rating_state, int, text, int, int) to authenticated;
grant execute on function public.admin_get_review(uuid) to authenticated;
grant execute on function public.admin_quarantine_review(uuid, text, text) to authenticated;
grant execute on function public.admin_restore_review(uuid, text, text) to authenticated;
grant execute on function public.admin_remove_review(uuid, text, text, text) to authenticated;
grant execute on function public.admin_get_audit(jsonb, timestamptz, int) to authenticated;
grant execute on function public.admin_search(text) to authenticated;
grant execute on function public.admin_overview() to authenticated;

select private.assign_app_ownership();
