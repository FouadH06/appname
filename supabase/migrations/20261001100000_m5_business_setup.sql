-- M5 · Business setup: create (ops), go-live checklist, publish, pause online booking, slug change,
--      staff archive/restore, "I also take appointments"
-- Spec: Phase 3 Part 6 §3.3 (status fields change only via RPC), Part 2 §5, staff model §7,
--       Phase 2 B1 (onboarding, go-live minimum), B9 (archive), B12 (danger zone).

-- ─── Assisted onboarding (Phase 2 B1 / A4) ─────────────────────────────────
-- Ops creates the business as a draft and becomes a temporary MANAGER so the wizard's RLS-protected
-- writes work. The owner's first active membership (accepting the owner invite) marks the business
-- claimed and ends the ops helper membership automatically.
create function public.admin_create_business(
  p_name text, p_slug text, p_category_slug text, p_area_id uuid,
  p_address_line text, p_lat double precision, p_lng double precision, p_phone text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.uid(); v_biz uuid; v_loc uuid; v_phone text;
begin
  if not private.is_admin('{ops}') then perform private.raise_code('FORBIDDEN'); end if;
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
  return jsonb_build_object('business_id', v_biz, 'location_id', v_loc);
exception when unique_violation then
  perform private.raise_code('SLUG_UNAVAILABLE', jsonb_build_object('slug', lower(btrim(p_slug))));
  return null;   -- not reached (raise_code raises)
end $$;

create function private.on_owner_joined() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_creator uuid;
begin
  if new.role = 'owner' and new.status = 'active' then
    update public.businesses set claimed_at = coalesce(claimed_at, now()) where id = new.business_id
    returning created_by into v_creator;
    -- the ops helper membership ends when the owner arrives (unless the creator IS the owner)
    update public.business_members m set status = 'revoked'
     where m.business_id = new.business_id and m.user_id = v_creator and m.user_id <> new.user_id
       and m.role <> 'owner' and m.status = 'active'
       and exists (select 1 from public.admin_users a where a.user_id = v_creator);
  end if;
  return null;
end $$;
create trigger business_members_owner_joined after insert or update of role, status on public.business_members
  for each row execute function private.on_owner_joined();

-- ─── Slugs ─────────────────────────────────────────────────────────────────
create function private.valid_slug(p_slug text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$', false)
$$;

-- SlugField availability check with suggestions (Phase 2 B1 step 2)
create function public.check_slug(p_slug text, p_business_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v text := lower(btrim(coalesce(p_slug, ''))); v_free boolean; v_sugg text[] := '{}'::text[]; i int := 2; c text;
begin
  if private.uid() is null then perform private.raise_code('AUTH_REQUIRED'); end if;
  if not private.valid_slug(v) then
    return jsonb_build_object('available', false, 'reason', 'invalid', 'suggestions', '[]'::jsonb);
  end if;
  v_free := not exists (select 1 from public.reserved_slugs where slug = v)
        and not exists (select 1 from public.businesses where slug = v and id is distinct from p_business_id)
        and not exists (select 1 from public.business_slug_history where old_slug = v and business_id is distinct from p_business_id);
  if not v_free then
    while cardinality(v_sugg) < 3 and i < 50 loop
      c := left(v, 46) || '-' || i;
      if not exists (select 1 from public.reserved_slugs where slug = c)
         and not exists (select 1 from public.businesses where slug = c)
         and not exists (select 1 from public.business_slug_history where old_slug = c) then
        v_sugg := v_sugg || c;
      end if;
      i := i + 1;
    end loop;
  end if;
  return jsonb_build_object('available', v_free,
                            'reason', case when v_free then null
                                           when exists (select 1 from public.reserved_slugs where slug = v) then 'reserved'
                                           else 'taken' end,
                            'suggestions', to_jsonb(v_sugg));
end $$;

create function public.change_business_slug(p_business_id uuid, p_slug text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v text := lower(btrim(coalesce(p_slug, '')));
begin
  if not (private.has_business_role(p_business_id, '{owner,manager}') or private.is_admin('{ops}')) then
    perform private.raise_code('FORBIDDEN');
  end if;
  if not private.valid_slug(v) then perform private.raise_code('INVALID_SLUG'); end if;
  perform private.hit_rate_limit('slug_change', p_business_id::text, 5, interval '1 day');
  update public.businesses set slug = v where id = p_business_id;   -- trigger keeps history (redirects)
  return v;
exception when unique_violation then
  perform private.raise_code('SLUG_UNAVAILABLE', jsonb_build_object('slug', v));
  return null;   -- not reached
end $$;

-- ─── Go-live checklist and publish (Phase 2 B1 "Go-live minimum") ──────────
-- name, category, area + pin (always set at creation), hours, ≥1 online-bookable priced service
-- performed by an active staff member at the location, ≥1 staff member with weekly hours, cover.
create function public.get_go_live_checklist(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_loc uuid;
begin
  if not (private.has_business_role(p_business_id) or private.is_admin('{ops,support}')) then
    perform private.raise_code('FORBIDDEN');
  end if;
  select id into v_loc from public.business_locations where business_id = p_business_id order by created_at limit 1;
  return jsonb_build_array(
    jsonb_build_object('key', 'location', 'ok', v_loc is not null),
    jsonb_build_object('key', 'hours', 'ok', exists (select 1 from public.location_hours where location_id = v_loc)),
    jsonb_build_object('key', 'service', 'ok', exists (
      select 1 from public.services s
      join public.staff_services ss on ss.service_id = s.id
      join public.staff_members st on st.id = ss.staff_id and st.status = 'active'
      join public.staff_locations sl on sl.staff_id = st.id and sl.location_id = v_loc
      where s.business_id = p_business_id and s.status = 'active' and s.is_online_bookable
        and s.price_type <> 'on_consultation')),
    jsonb_build_object('key', 'staff_hours', 'ok', exists (
      select 1 from public.staff_weekly_hours w
      join public.staff_members st on st.id = w.staff_id and st.status = 'active'
      where w.location_id = v_loc and (w.effective_to is null or w.effective_to > current_date))),
    jsonb_build_object('key', 'cover', 'ok', exists (
      select 1 from public.business_media m
      where m.business_id = p_business_id and m.kind = 'cover' and m.state = 'approved')));
end $$;

create function public.publish_business(p_business_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_list jsonb; v_missing jsonb; v_status public.business_status;
begin
  if not (private.has_business_role(p_business_id, '{owner,manager}') or private.is_admin('{ops}')) then
    perform private.raise_code('FORBIDDEN');
  end if;
  select status into v_status from public.businesses where id = p_business_id for update;
  if v_status not in ('draft', 'paused', 'live') then perform private.raise_code('FORBIDDEN'); end if;
  v_list := public.get_go_live_checklist(p_business_id);
  select coalesce(jsonb_agg(e -> 'key'), '[]') into v_missing from jsonb_array_elements(v_list) e where not (e ->> 'ok')::boolean;
  if jsonb_array_length(v_missing) > 0 then
    perform private.raise_code('GO_LIVE_BLOCKED', jsonb_build_object('missing', v_missing));
  end if;
  update public.businesses set status = 'live', published_at = coalesce(published_at, now()) where id = p_business_id;
  update public.business_locations set status = 'live' where business_id = p_business_id and status in ('draft', 'paused');
  return jsonb_build_object('status', 'live');
end $$;

-- Danger zone (owner only): online booking off, profile stays visible with contact options (B12)
create function public.pause_online_booking(p_business_id uuid, p_paused boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not (private.has_business_role(p_business_id, '{owner}') or private.is_admin('{ops}')) then
    perform private.raise_code('FORBIDDEN');
  end if;
  update public.business_settings set allow_online_booking = not p_paused where business_id = p_business_id;
end $$;

-- ─── Staff lifecycle (staff model §7, Phase 2 B9) ──────────────────────────
create function public.archive_staff(p_staff_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s public.staff_members; v_future int;
begin
  select * into s from public.staff_members where id = p_staff_id for update;
  if s.id is null or not private.has_business_role(s.business_id, '{owner,manager}') then
    perform private.raise_code('FORBIDDEN');
  end if;
  select count(*) into v_future
  from public.booking_items bi join public.bookings b on b.id = bi.booking_id
  where bi.staff_id = p_staff_id and b.status in ('held', 'pending', 'confirmed') and bi.ends_at > now();
  if v_future > 0 then
    perform private.raise_code('STAFF_HAS_FUTURE_BOOKINGS', jsonb_build_object('count', v_future));
  end if;
  update public.staff_members
     set status = 'archived', archived_at = now(), publicly_bookable = false, accepts_any_assignment = false
   where id = p_staff_id;
end $$;

create function public.restore_staff(p_staff_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare s public.staff_members;
begin
  select * into s from public.staff_members where id = p_staff_id for update;
  if s.id is null or not private.has_business_role(s.business_id, '{owner,manager}') then
    perform private.raise_code('FORBIDDEN');
  end if;
  update public.staff_members set status = 'active', archived_at = null where id = p_staff_id;
end $$;

-- "I also take appointments" (B1 step 6): a staff profile linked to the caller's own login
create function public.create_my_staff_profile(p_business_id uuid, p_display_name text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.uid(); v_id uuid; v_base text; v_slug text; i int := 1;
begin
  if not private.has_business_role(p_business_id, '{owner,manager}') then perform private.raise_code('FORBIDDEN'); end if;
  select id into v_id from public.staff_members where business_id = p_business_id and user_id = v_uid;
  if v_id is not null then return v_id; end if;
  v_base := coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(p_display_name, '')), '[^a-z0-9]+', '-', 'g')), ''), 'me');
  v_slug := v_base;
  while exists (select 1 from public.staff_members where business_id = p_business_id and slug = v_slug) loop
    i := i + 1; v_slug := v_base || '-' || i;
  end loop;
  insert into public.staff_members (business_id, user_id, display_name, slug)
  values (p_business_id, v_uid, left(btrim(p_display_name), 60), v_slug)
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.admin_create_business(text, text, text, uuid, text, double precision, double precision, text) to authenticated;
grant execute on function public.check_slug(text, uuid)                   to authenticated;
grant execute on function public.change_business_slug(uuid, text)         to authenticated;
grant execute on function public.get_go_live_checklist(uuid)              to authenticated;
grant execute on function public.publish_business(uuid)                   to authenticated;
grant execute on function public.pause_online_booking(uuid, boolean)      to authenticated;
grant execute on function public.archive_staff(uuid)                      to authenticated;
grant execute on function public.restore_staff(uuid)                      to authenticated;
grant execute on function public.create_my_staff_profile(uuid, text)      to authenticated;

select private.assign_app_ownership();
