-- M9 · The business page shows the verified rating (display only from 5 counted reviews; the
--      page's 1-minute cache applies). Same function as M8 except the 'rating' field.

create or replace function public.get_business_page(p_slug text) returns jsonb
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
    'rating', public.get_business_rating_summary(b.id),          -- M9: {review_count, display_rating (5+), dimensions}
    'price_from', (select min(sv.price_min) from public.services sv
                   where sv.business_id = b.id and sv.status = 'active' and sv.is_online_bookable));
end $$;

select private.assign_app_ownership();
