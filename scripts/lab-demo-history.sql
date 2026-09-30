-- LOCAL ONLY. Adds ~45 days of fake booking history to the lab demo business (scripts/lab-demo-business.sql)
-- so the dashboard (Calendar, Customers, Analytics) has something to show. Deterministic; re-running is a
-- no-op once history exists. Never run against staging/production (it commits data).
--   docker exec -i supabase_db_app-name psql -U postgres -At < scripts/lab-demo-history.sql
do $$
declare
  v_biz uuid; v_loc uuid; v_karim uuid; v_maya uuid; v_cut uuid; v_beard uuid; v_combo uuid; v_kids uuid;
  v_cust uuid[] := '{}'; v_c uuid; v_bk uuid; d int; h int; s int; r double precision; v_staff uuid; v_svc uuid;
  v_price numeric; v_min int; v_start timestamptz; v_status public.booking_status; v_source public.booking_source;
  v_late boolean; names text[] := array['Rana Khoury','Sami Haddad','Lea Nassar','Omar Saad','Maya Aoun','Karl Fares',
    'Nour Hajj','Jad Karam','Tala Mansour','Ziad Chami','Yara Salameh','Elie Rizk','Hiba Daher','Rami Issa'];
  i int;
begin
  select id into v_biz from public.businesses where slug = 'lab-demo-barber';
  if v_biz is null then raise exception 'run scripts/lab-demo-business.sql first'; end if;
  if exists (select 1 from public.bookings where business_id = v_biz and starts_at < now() - interval '2 days') then
    raise notice 'history already loaded'; return;
  end if;
  select id into v_loc from public.business_locations where business_id = v_biz limit 1;
  select id into v_karim from public.staff_members where business_id = v_biz and slug = 'karim';
  select id into v_cut from public.services where business_id = v_biz and name = 'Haircut';
  update public.staff_weekly_hours set start_minute = 540, end_minute = 1140, effective_from = current_date - 60
   where staff_id = v_karim;

  insert into public.staff_members (business_id, display_name, slug) values (v_biz, 'Maya Demo', 'maya') returning id into v_maya;
  insert into public.staff_locations (staff_id, location_id, business_id) values (v_maya, v_loc, v_biz);
  insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
  select v_maya, v_loc, v_biz, d2, 600, 1200, current_date - 60 from generate_series(1, 6) d2;

  insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
  select v_biz, id, 'Beard trim', 'fixed', 10, 20 from public.canonical_services where slug = 'beard-trim' returning id into v_beard;
  insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
  select v_biz, id, 'Haircut & beard', 'fixed', 22, 45 from public.canonical_services where slug = 'haircut-beard' returning id into v_combo;
  insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
  select v_biz, id, 'Kids haircut', 'fixed', 10, 30 from public.canonical_services where slug = 'kids-haircut' returning id into v_kids;
  insert into public.staff_services (staff_id, service_id, business_id)
  select st, sv, v_biz from unnest(array[v_karim, v_maya]) st cross join unnest(array[v_cut, v_beard, v_combo, v_kids]) sv
  on conflict do nothing;

  for i in 1 .. array_length(names, 1) loop
    insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
    values (v_biz, '+9617099' || lpad(i::text, 4, '0'), names[i], 'manual') returning id into v_c;
    v_cust := v_cust || v_c;
  end loop;

  for d in -45 .. 6 loop
    for s in 1 .. 2 loop
      v_staff := case s when 1 then v_karim else v_maya end;
      if s = 2 and extract(isodow from current_date + d) = 7 then continue; end if;   -- Maya off on Sundays
      for h in 10 .. 17 loop
        r := ('x' || substr(md5(d || '-' || s || '-' || h), 1, 8))::bit(32)::bigint / 4294967295.0;
        if r > (case when extract(isodow from current_date + d) in (5, 6) then 0.75 else 0.5 end) then continue; end if;
        v_start := ((current_date + d)::timestamp + make_interval(hours => h)) at time zone 'Asia/Beirut';
        v_svc := case when r < 0.25 then v_cut when r < 0.38 then v_beard when r < 0.52 then v_combo when r < 0.58 then v_kids else v_cut end;
        select price_min, duration_min into v_price, v_min from public.services where id = v_svc;
        v_c := v_cust[1 + floor(r * 1000)::int % array_length(v_cust, 1)];
        v_late := false;
        if v_start > now() then v_status := 'confirmed';
        elsif (r * 100)::int % 14 = 3 then v_status := 'no_show';
        elsif (r * 100)::int % 12 = 5 then v_status := 'cancelled'; v_late := (r * 1000)::int % 3 = 0;
        else v_status := 'completed'; end if;
        v_source := case (r * 10000)::int % 10 when 0 then 'marketplace_search' when 1 then 'marketplace_search'
                         when 2 then 'marketplace_home' when 3 then 'business_link' when 4 then 'business_link'
                         when 5 then 'rebook' when 6 then 'walk_in' else 'manual' end;
        insert into public.bookings (business_id, location_id, business_customer_id, status, source, starts_at, ends_at,
                                     created_by_kind, total_price_min, total_price_max, confirmed_at, completed_at, no_show_at,
                                     cancelled_at, cancelled_by_kind, is_late_cancel, created_at)
        values (v_biz, v_loc, v_c, v_status, v_source, v_start, v_start + make_interval(mins => v_min),
                case when v_source in ('manual', 'walk_in') then 'business' else 'customer' end::public.actor_kind,
                v_price, v_price, v_start - interval '2 days',
                case when v_status = 'completed' then v_start + make_interval(mins => v_min) end,
                case when v_status = 'no_show' then v_start + make_interval(mins => v_min) end,
                case when v_status = 'cancelled' then v_start - interval '3 hours' end,
                case when v_status = 'cancelled' then 'customer' end::public.actor_kind,
                v_late, least(v_start - interval '2 days', now()))
        returning id into v_bk;
        insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id,
                                          selection_mode, starts_at, ends_at, occupied, duration_min, price_type, price_min)
        select v_bk, v_biz, v_loc, sv.id, sv.canonical_service_id, v_staff, 'business', v_start,
               v_start + make_interval(mins => v_min), tstzrange(v_start, v_start + make_interval(mins => v_min), '[)'),
               v_min, 'fixed', v_price
        from public.services sv where sv.id = v_svc;
      end loop;
    end loop;
  end loop;

  perform private.recompute_business_customer_stats(c) from unnest(v_cust) c;
  perform private.refresh_daily_metrics(current_date - 60, current_date - 1);
  raise notice 'loaded % bookings', (select count(*) from public.bookings where business_id = v_biz);
end $$;
