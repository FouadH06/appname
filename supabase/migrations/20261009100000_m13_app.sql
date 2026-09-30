-- M13 · Customer app backend: favorite places, rebook suggestions ("Book again with {staff}"), push
--       tokens + the push channel in the dispatcher, inbox refinements.
-- Spec: Phase 4 M13; Phase 2 C2, C14, C17, C18; Phase 3 Part 5 §5 (favorites & rebooking), §6 (routing).

-- ═══ Favorites (places) ════════════════════════════════════════════════════
create table public.favorite_businesses (
  user_id      uuid not null references auth.users(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index on public.favorite_businesses (business_id);
alter table public.favorite_businesses enable row level security;
grant select on public.favorite_businesses to authenticated;
create policy favorite_businesses_own on public.favorite_businesses for select to authenticated
  using (user_id = (select auth.uid()));

-- Signed-in, non-anonymous customers only (favorites sync across web and app).
create function public.toggle_favorite_business(p_business_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.uid(); v_on boolean;
begin
  if v_uid is null or private.is_anonymous() then perform private.raise_code('AUTH_REQUIRED'); end if;
  if not exists (select 1 from public.businesses where id = p_business_id and status in ('live', 'paused')) then
    perform private.raise_code('NOT_FOUND');
  end if;
  delete from public.favorite_businesses where user_id = v_uid and business_id = p_business_id;
  v_on := not found;
  if v_on then
    insert into public.favorite_businesses (user_id, business_id) values (v_uid, p_business_id);
  end if;
  return jsonb_build_object('favorited', v_on);
end $$;

-- C14 Places: newest first, with next availability; a business that is no longer publicly visible stays
-- listed but dimmed (state 'unavailable') so the customer can remove it.
create function public.get_my_favorites() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.uid();
begin
  if v_uid is null or private.is_anonymous() then perform private.raise_code('AUTH_REQUIRED'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'business_id', b.id, 'slug', b.slug, 'name', b.name, 'saved_at', f.created_at,
             'state', case when d.location_id is null then 'unavailable' else 'ok' end,
             'area', (select a.name_en from public.areas a where a.id = d.area_id),
             'display_rating', d.display_rating, 'review_count', coalesce(d.review_count, 0), 'price_level', d.price_level,
             'cover_path', d.cover_path, 'next_available_at', d.next_available_at, 'labels', coalesce(to_jsonb(d.labels), '[]'))
           order by f.created_at desc, b.name)
    from public.favorite_businesses f
    join public.businesses b on b.id = f.business_id
    left join lateral (select * from public.search_documents x where x.business_id = b.id order by x.next_available_at nulls last limit 1) d on true
    where f.user_id = v_uid), '[]');
end $$;

create function public.is_favorite_business(p_business_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.favorite_businesses where user_id = private.uid() and business_id = p_business_id)
$$;

-- ═══ Rebooking (C2 "Book again with {staff}") ══════════════════════════════
-- The last completed visit per business + service (up to p_limit), staff-first: the same person when
-- they are still active, public and doing that service; otherwise "Any available" (staff dropped, flow
-- starts at the staff step). Businesses that are no longer bookable are skipped.
create function public.get_rebook_suggestions(p_limit int default 3) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.uid();
begin
  if v_uid is null or private.is_anonymous() then return '[]'; end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'last_visit_at') desc)
    from (
      select jsonb_build_object(
               'booking_id', v.booking_id, 'business_id', v.business_id, 'slug', b.slug, 'business', b.name,
               'location_id', v.location_id, 'service_id', v.service_id, 'service', s.name,
               'staff_id', case when st_ok then v.staff_id end,
               'staff', case when st_ok then split_part(st.display_name, ' ', 1) end,
               'last_staff', split_part(st.display_name, ' ', 1),
               'last_visit_at', v.starts_at,
               'cover_path', private.business_media_path(b.id, 'cover'),
               'next_available_at', public.get_next_available(v.location_id, v.service_id, case when st_ok then v.staff_id end)) as x
      from (
        select distinct on (k.business_id, i.service_id) k.id as booking_id, k.business_id, k.location_id, i.service_id, i.staff_id, k.starts_at
        from public.bookings k join public.booking_items i on i.booking_id = k.id
        where k.customer_user_id = v_uid and k.status = 'completed'
        order by k.business_id, i.service_id, k.starts_at desc
      ) v
      join public.businesses b on b.id = v.business_id and b.status = 'live'
      join public.services s on s.id = v.service_id and s.status = 'active' and s.is_online_bookable
      left join public.staff_members st on st.id = v.staff_id
      cross join lateral (select coalesce(st.status = 'active' and st.publicly_bookable
                                          and exists (select 1 from public.staff_services ss where ss.staff_id = st.id and ss.service_id = s.id), false) as st_ok) q
      order by v.starts_at desc
      limit least(greatest(coalesce(p_limit, 3), 1), 10)
    ) z), '[]');
end $$;

-- ═══ Push tokens ═══════════════════════════════════════════════════════════
-- One Expo token per device; a device that signs into another account moves to that account.
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.uid();
begin
  if v_uid is null or private.is_anonymous() then perform private.raise_code('AUTH_REQUIRED'); end if;
  if p_platform not in ('ios', 'android') or p_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,}\]$' then
    perform private.raise_code('INVALID_INPUT', '{"field":"token"}');
  end if;
  insert into public.push_tokens (user_id, expo_token, platform, last_seen_at, disabled_at)
  values (v_uid, p_token, p_platform, now(), null)
  on conflict (expo_token) do update set user_id = v_uid, platform = excluded.platform, last_seen_at = now(), disabled_at = null;
end $$;

-- Sign-out on a device: that device stops receiving this account's pushes.
create function public.unregister_push_token(p_token text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.push_tokens set disabled_at = now() where expo_token = p_token and user_id = private.uid()
$$;

-- Dispatcher (service role): Expo reported these tokens as no longer registered.
create function public.push_tokens_invalid(p_tokens text[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  update public.push_tokens set disabled_at = now() where expo_token = any (coalesce(p_tokens, '{}')) and disabled_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create function private.has_push(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
     and exists (select 1 from public.push_tokens t where t.user_id = p_user_id and t.disabled_at is null)
     and not exists (select 1 from public.notification_preferences p where p.user_id = p_user_id and p.channel = 'push' and not p.enabled)
$$;

-- Routing (Part 5 §6): review / result / dispute messages go by push to app users, WhatsApp to web-only
-- customers. '{push,whatsapp}' means "push when the customer has the app, else WhatsApp".
update private.notification_routes set primary_channels = '{push,whatsapp}'
 where type in ('review_request', 'review_published', 'review_needs_changes', 'result_published', 'result_rejected', 'dispute_update');

-- Claim: rows for app-only customers (no phone, a push token) are due too; channels resolve push vs WhatsApp.
create or replace function public.notify_claim(p_limit int default 50) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  update public.notifications n set status = 'cancelled'
  from public.bookings b
  where n.booking_id = b.id and n.status = 'queued' and n.scheduled_for <= now()
    and n.type in ('booking_reminder_24h', 'booking_reminder_2h')
    and (b.status <> 'confirmed' or (n.payload ->> 'starts_at')::timestamptz <> b.starts_at);

  with due as (
    select id from public.notifications
    where status = 'queued' and scheduled_for <= now()
      and (recipient_phone is not null or private.has_push(recipient_user_id))
    order by scheduled_for limit least(greatest(coalesce(p_limit, 50), 1), 500)
    for update skip locked
  ), claimed as (
    update public.notifications n set status = 'processing', attempts = n.attempts + 1
    from due where n.id = due.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'type', c.type, 'locale', c.locale, 'phone', c.recipient_phone, 'attempts', c.attempts,
           'payload', c.payload || jsonb_build_object('booking_id', c.booking_id), 'critical', coalesce(r.critical, false),
           'channels', (select coalesce(jsonb_agg(ch order by o), '[]') from unnest(
                          case when c.channel_override is not null then array[c.channel_override]
                               when 'push' = any (coalesce(r.primary_channels, '{}')) and private.has_push(c.recipient_user_id)
                                 then array['push'::public.notification_channel]
                               else array(select x from unnest(coalesce(r.primary_channels, '{whatsapp}')) x where x <> 'push')
                                    || case when coalesce(r.critical, false) then r.fallback_channels else '{}' end end)
                          with ordinality u(ch, o)
                        where ch in ('whatsapp', 'sms', 'push')
                          and (ch <> 'push' or private.has_push(c.recipient_user_id))
                          and (ch = 'push' or c.recipient_phone is not null)
                          and not exists (select 1 from public.notification_preferences p
                                          where p.user_id = c.recipient_user_id and p.channel = ch and not p.enabled)),
           'push_tokens', (select coalesce(jsonb_agg(t.expo_token), '[]') from public.push_tokens t
                           where t.user_id = c.recipient_user_id and t.disabled_at is null),
           'templates', (select coalesce(jsonb_object_agg(t.channel, to_jsonb(t) - 'created_at'), '{}')
                         from (select distinct on (t.channel) t.*
                               from public.notification_templates t
                               where t.type = c.type and t.is_active and t.locale in (c.locale, 'en')
                               order by t.channel, (t.status = 'approved') desc, (t.locale = c.locale) desc) t))), '[]')
    into v
  from claimed c left join private.notification_routes r on r.type = c.type;
  return v;
end $$;

-- ═══ Inbox (C17): customer messages only, 90 days; unread count for the bell ═
create or replace function public.get_my_notifications(p_before timestamptz default null, p_limit int default 30)
returns table (id uuid, type public.notification_type, booking_id uuid, payload jsonb, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.type, n.booking_id, n.payload - 'dashboard_link' - 'dashboard_path', n.created_at, n.read_at
  from public.notifications n
  where n.recipient_user_id = private.uid() and n.status <> 'cancelled' and n.scheduled_for <= now()
    and n.type::text not like 'biz\_%' and n.type <> 'otp'
    and n.created_at > now() - interval '90 days'
    and (p_before is null or n.created_at < p_before)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

create function public.get_unread_notification_count() returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.notifications n
  where n.recipient_user_id = private.uid() and n.status <> 'cancelled' and n.scheduled_for <= now()
    and n.read_at is null and n.type::text not like 'biz\_%' and n.type <> 'otp'
    and n.created_at > now() - interval '90 days'
$$;

-- /captcha is the app's captcha bridge on the web; /sign-in is an app route
insert into public.reserved_slugs (slug) values ('captcha'), ('sign-in') on conflict do nothing;

-- ─── Grants ────────────────────────────────────────────────────────────────
revoke execute on function public.push_tokens_invalid(text[]) from public, anon, authenticated;
grant execute on function public.push_tokens_invalid(text[]) to service_role;
grant execute on function public.toggle_favorite_business(uuid) to authenticated;
grant execute on function public.get_my_favorites() to authenticated;
grant execute on function public.is_favorite_business(uuid) to authenticated;
grant execute on function public.get_rebook_suggestions(int) to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;

select private.assign_app_ownership();
