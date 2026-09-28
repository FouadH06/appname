-- LOCAL ONLY. Creates (or reuses) a clearly fake demo barber for the M4 lab page
-- (/lab/booking?loc=…&svc=…): open around the clock, one stylist working all day, no notice.
--   docker exec -i supabase_db_app-name psql -U postgres -At < scripts/lab-demo-business.sql
-- Never run against staging/production (it commits data).
do $$
declare v_owner uuid; v_biz uuid; v_loc uuid; v_svc uuid; v_staff uuid;
begin
  if current_setting('server_version_num')::int < 150000 then raise exception 'unexpected server'; end if;
  select id into v_biz from public.businesses where slug = 'lab-demo-barber';
  if v_biz is null then
    insert into auth.users (id, aud, role, created_at, updated_at)
    values (gen_random_uuid(), 'authenticated', 'authenticated', now(), now()) returning id into v_owner;
    insert into public.businesses (slug, name, primary_category_id, status)
    select 'lab-demo-barber', 'Lab Demo Barber (test)', id, 'live' from public.categories where slug = 'barber'
    returning id into v_biz;
    insert into public.business_members (business_id, user_id, role) values (v_biz, v_owner, 'owner');
    update public.business_settings set min_notice_minutes = 0 where business_id = v_biz;
    insert into public.business_locations (business_id, area_id, address_line, geo, status)
    select v_biz, id, 'Test street', centroid, 'live' from public.areas where slug = 'hazmieh' returning id into v_loc;
    insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
    select v_loc, v_biz, d, 0, 1440 from generate_series(1, 7) d;
    insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
    select v_biz, id, 'Haircut', 'fixed', 15, 30 from public.canonical_services where slug = 'mens-haircut'
    returning id into v_svc;
    insert into public.staff_members (business_id, display_name, slug) values (v_biz, 'Karim Demo', 'karim') returning id into v_staff;
    insert into public.staff_locations (staff_id, location_id, business_id) values (v_staff, v_loc, v_biz);
    insert into public.staff_services (staff_id, service_id, business_id) values (v_staff, v_svc, v_biz);
    insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
    select v_staff, v_loc, v_biz, d, 0, 1440, current_date - 1 from generate_series(1, 7) d;
  end if;
end $$;
select '/lab/booking?loc=' || l.id || '&svc=' || s.id
from public.businesses b
join public.business_locations l on l.business_id = b.id
join public.services s on s.business_id = b.id
where b.slug = 'lab-demo-barber';
