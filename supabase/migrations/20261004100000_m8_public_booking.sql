-- M8 · Public web booking (acquisition product): business page, staff options, customer booking
--      read models, no-show contest (+ minimal disputes, admin UI in M11)
-- Spec: Phase 2 C1, C7–C13; Phase 3 Part 3 §4.2, Part 4 §5 (disputes), Part 5 §2.2, Part 6.
-- Non-leak rule (Part 7): public payloads never contain internal-only or archived staff.

-- ─── Disputes (no-show contests now; reviews/legal later) ─────────────────
create table public.disputes (
  id                 uuid primary key default gen_random_uuid(),
  type               public.dispute_type not null,
  booking_id         uuid references public.bookings(id),
  review_id          uuid,                             -- FK added with reviews (M9)
  business_id        uuid not null references public.businesses(id),
  customer_user_id   uuid references auth.users(id),
  opened_by_user_id  uuid not null references auth.users(id),
  opened_by_kind     public.actor_kind not null,
  status             public.dispute_status not null default 'open',
  outcome            public.dispute_outcome,
  legal_hold         boolean not null default false,
  due_at             timestamptz not null,
  assigned_to        uuid references auth.users(id),
  resolved_by        uuid references auth.users(id),
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz not null default now(),
  check (type <> 'no_show' or booking_id is not null),
  check ((status = 'resolved') = (outcome is not null))
);
create unique index disputes_one_open_no_show on public.disputes (booking_id)
  where type = 'no_show' and status in ('open', 'awaiting_info');
create index on public.disputes (status, due_at);

create table public.dispute_messages (
  id             uuid primary key default gen_random_uuid(),
  dispute_id     uuid not null references public.disputes(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  author_kind    public.actor_kind not null,
  visibility     text not null default 'parties' check (visibility in ('parties', 'internal')),
  body           text not null check (char_length(body) <= 2000),
  media_ids      uuid[] not null default '{}',
  created_at     timestamptz not null default now()
);

alter table public.disputes enable row level security;
alter table public.dispute_messages enable row level security;
revoke all on public.disputes, public.dispute_messages from anon, authenticated;

-- ─── Media URL helper (public bucket paths) ───────────────────────────────
create function private.business_media_path(p_business_id uuid, p_kind public.business_media_kind, p_staff_id uuid default null)
returns text language sql stable security definer set search_path = '' as $$
  select a.public_path from public.business_media m join public.media_assets a on a.id = m.media_asset_id
  where m.business_id = p_business_id and m.kind = p_kind and m.state in ('approved', 'approved_redacted')
    and (p_staff_id is null or m.staff_id = p_staff_id) and a.public_path is not null
  order by m.sort, m.created_at limit 1
$$;

-- ═══ C1 business page ═════════════════════════════════════════════════════
-- Everything the page needs in one payload (cacheable: no per-visitor data). Old slugs return
-- {redirect_to}; draft / suspended / closed businesses return {state: 'unavailable'}.
create function public.get_business_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  b public.businesses; l public.business_locations; s public.business_settings; v_new text;
begin
  select * into b from public.businesses where slug = v_slug::extensions.citext and not is_test;
  if b.id is null then
    select nb.slug into v_new from public.business_slug_history h join public.businesses nb on nb.id = h.business_id
     where h.old_slug = v_slug::extensions.citext and nb.status in ('live', 'paused');
    if v_new is not null then return jsonb_build_object('redirect_to', v_new); end if;
    return jsonb_build_object('state', 'not_found');
  end if;
  if b.status not in ('live', 'paused') then return jsonb_build_object('state', 'unavailable'); end if;
  select * into l from public.business_locations where business_id = b.id and status = 'live' order by created_at limit 1;
  if l.id is null then return jsonb_build_object('state', 'unavailable'); end if;
  select * into s from public.business_settings where business_id = b.id;

  return jsonb_build_object(
    'state', 'ok',
    'accepting', b.status = 'live' and s.allow_online_booking,
    'business', jsonb_build_object(
      'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'audience', b.audience,
      'price_level', b.price_level, 'instagram', b.instagram_handle,
      'category', (select jsonb_build_object('en', c.name_en, 'ar', c.name_ar) from public.categories c where c.id = b.primary_category_id),
      'cover_path', private.business_media_path(b.id, 'cover'),
      'portfolio', coalesce((select jsonb_agg(a.public_path order by m.sort, m.created_at)
                             from public.business_media m join public.media_assets a on a.id = m.media_asset_id
                             where m.business_id = b.id and m.kind = 'portfolio' and m.state in ('approved', 'approved_redacted')
                               and a.public_path is not null), '[]')),
    'location', jsonb_build_object(
      'id', l.id, 'area', (select jsonb_build_object('en', a.name_en, 'ar', a.name_ar) from public.areas a where a.id = l.area_id),
      'address_line', l.address_line, 'floor', l.floor, 'landmark', l.landmark,
      'lat', extensions.st_y(l.geo::extensions.geometry), 'lng', extensions.st_x(l.geo::extensions.geometry),
      'phone', l.phone_e164, 'whatsapp', coalesce(l.whatsapp_e164, l.phone_e164), 'timezone', l.timezone),
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', h.iso_weekday, 'start', h.start_minute, 'end', h.end_minute)
                                        order by h.iso_weekday, h.start_minute)
                       from public.location_hours h where h.location_id = l.id), '[]'),
    'closures', coalesce((select jsonb_agg(jsonb_build_object('start', lower(c.period), 'end', upper(c.period)) order by lower(c.period))
                          from public.location_closures c where c.location_id = l.id and upper(c.period) > now()
                            and lower(c.period) < now() + interval '30 days'), '[]'),
    'rules', jsonb_build_object(
      'booking_mode', s.booking_mode, 'staff_choice_mode', s.staff_choice_mode, 'min_notice_minutes', s.min_notice_minutes,
      'max_advance_days', s.max_advance_days, 'cancellation_window_minutes', s.cancellation_window_minutes,
      'show_staff_price_differences', s.show_staff_price_differences, 'request_expiry_minutes', s.request_expiry_minutes),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'name', sv.name, 'description', sv.description, 'group', g.name, 'group_sort', g.sort,
               'price_type', sv.price_type, 'price_min', sv.price_min, 'price_max', sv.price_max, 'currency', sv.currency,
               'duration_min', sv.duration_min, 'audience', sv.audience, 'is_combo', sv.is_combo,
               'online', sv.is_online_bookable and ps.n > 0,
               'popular_rank', pop.rnk,
               'staff_ids', ps.ids)
             order by pop.rnk nulls last, g.sort nulls last, sv.sort, sv.name)
      from public.services sv
      left join public.service_groups g on g.id = sv.group_id
      cross join lateral (
        select count(*) as n, coalesce(jsonb_agg(st.id), '[]') as ids
        from public.staff_services ss
        join public.staff_members st on st.id = ss.staff_id and st.status = 'active' and st.publicly_bookable
        join public.staff_locations sl on sl.staff_id = st.id and sl.location_id = l.id
        where ss.service_id = sv.id) ps
      left join lateral (
        select r.rnk from (
          select bi.service_id, row_number() over (order by count(*) desc) as rnk
          from public.booking_items bi join public.bookings bk on bk.id = bi.booking_id
          where bi.business_id = b.id and bk.status in ('confirmed', 'completed') and bk.starts_at > now() - interval '90 days'
          group by bi.service_id) r
        where r.service_id = sv.id and r.rnk <= 3) pop on true
      where sv.business_id = b.id and sv.status = 'active'), '[]'),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'name', st.display_name, 'role_title', st.role_title, 'bio', st.bio,
               'photo_path', private.business_media_path(b.id, 'staff_photo', st.id),
               'accepts_any', st.accepts_any_assignment,
               'specialties', (select coalesce(jsonb_agg(sv.name order by sv.sort), '[]') from public.staff_services ss
                               join public.services sv on sv.id = ss.service_id and sv.status = 'active'
                               where ss.staff_id = st.id and ss.is_specialty))
             order by st.display_order, st.display_name)
      from public.staff_members st
      join public.staff_locations sl on sl.staff_id = st.id and sl.location_id = l.id
      where st.business_id = b.id and st.status = 'active' and st.publicly_bookable), '[]'),
    'rating', null,                                             -- verified reviews arrive in M9
    'price_from', (select min(sv.price_min) from public.services sv
                   where sv.business_id = b.id and sv.status = 'active' and sv.is_online_bookable));
end $$;

-- C1 banner "You're booked Thu 4:30 PM · Manage" (per visitor, so outside the cached page)
create function public.get_my_next_booking_at(p_business_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'status', b.status)
  from public.bookings b
  where b.business_id = p_business_id and b.customer_user_id = private.uid()
    and b.status in ('pending', 'confirmed') and b.starts_at > now()
  order by b.starts_at limit 1
$$;

-- ═══ C8 staff options ═════════════════════════════════════════════════════
-- Public staff who perform the service: cards with specialties, next available, this person's
-- price/duration, appointment count (rounded, ≥ 20, business toggle); the Any card; and for a
-- signed-in customer the "Book again with …" shortcut.
create function public.get_staff_options(p_location_id uuid, p_service_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_biz uuid; s public.business_settings; v_uid uuid := private.uid(); v_rebook jsonb; sv public.services;
begin
  if not private.is_publicly_visible_location(p_location_id) then return jsonb_build_object('staff', '[]'::jsonb); end if;
  select business_id into v_biz from public.business_locations where id = p_location_id;
  select * into s from public.business_settings where business_id = v_biz;
  select * into sv from public.services where id = p_service_id and business_id = v_biz and status = 'active';
  if sv.id is null then return jsonb_build_object('staff', '[]'::jsonb); end if;

  if v_uid is not null and not coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) then
    select jsonb_build_object('staff_id', st.id, 'name', split_part(st.display_name, ' ', 1),
                              'last_visit_at', b.starts_at, 'same_service', bi.service_id = p_service_id)
      into v_rebook
    from public.bookings b
    join public.booking_items bi on bi.booking_id = b.id
    join public.staff_members st on st.id = bi.staff_id and st.status = 'active' and st.publicly_bookable
    join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
    join public.staff_locations sl on sl.staff_id = st.id and sl.location_id = p_location_id
    where b.business_id = v_biz and b.customer_user_id = v_uid and b.status = 'completed'
    order by (bi.service_id = p_service_id) desc, b.starts_at desc limit 1;
  end if;

  return jsonb_build_object(
    'choice_mode', s.staff_choice_mode,
    'any_next', public.get_next_available(p_location_id, p_service_id, null),
    'rebook', v_rebook,
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'name', st.display_name, 'role_title', st.role_title,
               'photo_path', private.business_media_path(v_biz, 'staff_photo', st.id),
               'accepts_any', st.accepts_any_assignment,
               'specialties', (select coalesce(jsonb_agg(x.name order by x.sort), '[]') from public.staff_services ss2
                               join public.services x on x.id = ss2.service_id and x.status = 'active'
                               where ss2.staff_id = st.id and ss2.is_specialty),
               'next_available', public.get_next_available(p_location_id, p_service_id, st.id),
               'price_type', t.price_type, 'price_min', t.price_min, 'price_max', t.price_max, 'duration_min', t.duration_min,
               'differs', s.show_staff_price_differences
                          and (t.price_min is distinct from sv.price_min or t.price_max is distinct from sv.price_max
                               or t.duration_min <> sv.duration_min),
               'appointments', case when s.show_staff_appointment_counts and coalesce(ss_stats.completed_count, 0) >= 20
                                    then (ss_stats.completed_count / 10) * 10 end)
             order by st.display_order, st.display_name)
      from public.staff_members st
      join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service_id
      join public.staff_locations sl on sl.staff_id = st.id and sl.location_id = p_location_id
      cross join lateral private.staff_service_terms(st.id, p_service_id) t
      left join public.staff_stats ss_stats on ss_stats.staff_id = st.id
      where st.business_id = v_biz and st.status = 'active' and st.publicly_bookable), '[]'));
end $$;

-- ═══ C12 / C13 customer read models ═══════════════════════════════════════
-- Staff first name is included for the customer's own bookings even for internal-only staff;
-- never a profile, photo or rating.
create function private.my_booking_card(p_booking_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
    'is_request', b.is_request, 'expires_at', b.expires_at, 'source', b.source,
    'booked_by_business', b.source in ('manual', 'walk_in'),
    'price_type', bi.price_type, 'price_min', bi.price_min, 'price_max', bi.price_max, 'currency', b.currency,
    'service_id', bi.service_id, 'service_name', sv.name, 'duration_min', bi.duration_min,
    'staff_id', case when st.publicly_bookable and st.status = 'active' then st.id end,
    'staff_first_name', split_part(st.display_name, ' ', 1),
    'staff_changed', exists (select 1 from public.booking_events e where e.booking_id = b.id and e.event = 'staff_changed'),
    'customer_note', b.customer_note, 'cancel_reason', case when b.cancelled_by_kind = 'business' then b.cancel_reason end,
    'cancelled_by', b.cancelled_by_kind, 'is_late_cancel', b.is_late_cancel,
    'customer_confirmed', b.customer_confirmed_at is not null, 'no_show_disputed', b.no_show_disputed,
    'cancellation_window_minutes', coalesce((b.policy_snapshot ->> 'cancellation_window_minutes')::int, 0),
    'can_cancel', b.status in ('pending', 'confirmed') and now() < b.starts_at,
    'can_reschedule', b.status in ('pending', 'confirmed')
                      and now() < b.starts_at - make_interval(mins => coalesce((b.policy_snapshot ->> 'cancellation_window_minutes')::int, 0)),
    'can_contest', b.status = 'no_show' and not b.no_show_disputed and b.no_show_at > now() - interval '7 days',
    'business', jsonb_build_object('id', z.id, 'name', z.name, 'slug', z.slug, 'live', z.status = 'live'),
    'location', jsonb_build_object('id', l.id, 'address_line', l.address_line, 'landmark', l.landmark,
                                   'area', (select a.name_en from public.areas a where a.id = l.area_id),
                                   'lat', extensions.st_y(l.geo::extensions.geometry), 'lng', extensions.st_x(l.geo::extensions.geometry),
                                   'phone', l.phone_e164, 'whatsapp', coalesce(l.whatsapp_e164, l.phone_e164)))
  from public.bookings b
  join public.booking_items bi on bi.booking_id = b.id and bi.position = 1
  join public.services sv on sv.id = bi.service_id
  join public.staff_members st on st.id = bi.staff_id
  join public.businesses z on z.id = b.business_id
  join public.business_locations l on l.id = b.location_id
  where b.id = p_booking_id
$$;

create function public.get_my_bookings(p_scope text default 'upcoming', p_before timestamptz default null, p_limit int default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.uid();
begin
  if v_uid is null or coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) then perform private.raise_code('AUTH_REQUIRED'); end if;
  return coalesce((
    select jsonb_agg(private.my_booking_card(b.id)
             order by case when p_scope = 'upcoming' then b.starts_at end asc, b.starts_at desc)
    from (select b.id, b.starts_at from public.bookings b
          where b.customer_user_id = v_uid and b.status <> 'held'
            and case when p_scope = 'upcoming' then b.status in ('pending', 'confirmed') and b.ends_at >= now()
                     else not (b.status in ('pending', 'confirmed') and b.ends_at >= now()) end
            and (p_before is null or b.starts_at < p_before)
          order by case when p_scope = 'upcoming' then b.starts_at end asc, b.starts_at desc
          limit least(greatest(coalesce(p_limit, 30), 1), 100)) b), '[]');
end $$;

-- Customer-visible history (no internal notes, no who-at-the-business)
create function public.get_my_booking(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.bookings where id = p_booking_id and customer_user_id = private.uid()) then
    perform private.raise_code('FORBIDDEN');
  end if;
  return private.my_booking_card(p_booking_id) || jsonb_build_object(
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('event', e.event, 'actor_kind', e.actor_kind, 'created_at', e.created_at,
                                          'new_start', e.data ->> 'new_start') order by e.created_at, e.id)
      from public.booking_events e
      where e.booking_id = p_booking_id
        and e.event in ('confirmed', 'requested', 'accepted', 'declined', 'expired', 'rescheduled', 'staff_changed',
                        'cancelled', 'completed', 'no_show_marked', 'no_show_contested', 'no_show_resolved',
                        'customer_confirmed', 'claimed')), '[]'),
    'reminders_sent', (select count(*) from public.notifications n
                       where n.booking_id = p_booking_id and n.type in ('booking_reminder_24h', 'booking_reminder_2h')
                         and n.status = 'sent'),
    'messages_failed', exists (select 1 from public.notifications n
                               where n.booking_id = p_booking_id and n.recipient_business_id is null and n.status = 'failed'));
end $$;

-- ═══ C13 no-show contest ═════════════════════════════════════════════════
-- Within 7 days of the no-show mark, once. Opens a dispute for APP_NAME support (M11 admin UI),
-- marks the booking disputed (reliability impact paused), logs no_show_contested.
create function public.contest_no_show(p_booking_id uuid, p_statement text, p_evidence_media_ids uuid[] default '{}')
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; v_id uuid; v_uid uuid := private.uid();
begin
  select * into b from public.bookings where id = p_booking_id and customer_user_id = v_uid for update;
  if b.id is null then perform private.raise_code('FORBIDDEN'); end if;
  if b.status <> 'no_show' or b.no_show_disputed then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  if b.no_show_at < now() - interval '7 days' then perform private.raise_code('OUTSIDE_WINDOW'); end if;
  if char_length(btrim(coalesce(p_statement, ''))) < 5 then perform private.raise_code('REASON_REQUIRED'); end if;
  insert into public.disputes (type, booking_id, business_id, customer_user_id, opened_by_user_id, opened_by_kind, due_at)
  values ('no_show', b.id, b.business_id, v_uid, v_uid, 'customer', now() + interval '48 hours')
  returning id into v_id;
  insert into public.dispute_messages (dispute_id, author_user_id, author_kind, body, media_ids)
  values (v_id, v_uid, 'customer', left(btrim(p_statement), 2000), coalesce(p_evidence_media_ids, '{}'));
  update public.bookings set no_show_disputed = true where id = b.id;
  perform private.log_booking_event(b.id, 'no_show_contested', 'customer', 'no_show', 'no_show', jsonb_build_object('dispute_id', v_id));
  return v_id;
end $$;

-- WhatsApp links (/m/{token}) open the booking after the phone is verified: the summary now carries
-- the booking id (useless without the matching verified account; get_my_booking checks ownership).
create or replace function public.resolve_access_token(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t private.access_tokens; v jsonb;
begin
  select * into t from private.access_tokens where token_hash = private.token_hash(p_token);
  if t.id is null or t.expires_at <= now() then perform private.raise_code('TOKEN_INVALID'); end if;

  select jsonb_build_object(
           'purpose', t.purpose,
           'booking_id', t.booking_id,               -- M8: lets the page open the booking after phone verification
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

grant execute on function public.get_business_page(text)                 to anon, authenticated;
grant execute on function public.get_staff_options(uuid, uuid)            to anon, authenticated;
grant execute on function public.get_my_next_booking_at(uuid)             to authenticated;
grant execute on function public.get_my_bookings(text, timestamptz, int)  to authenticated;
grant execute on function public.get_my_booking(uuid)                     to authenticated;
grant execute on function public.contest_no_show(uuid, text, uuid[])      to authenticated;

select private.assign_app_ownership();
