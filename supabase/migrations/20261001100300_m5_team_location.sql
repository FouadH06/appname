-- M5 · Team list for Settings › Team & roles, and readable map-pin coordinates
-- Profiles are private (own row only), so owners/managers see teammates through this projection:
-- first name, last initial, masked phone, role, linked staff profile. Nothing else.

create function public.list_members(p_business_id uuid)
returns table (user_id uuid, role public.business_role, display_name text, phone_hint text,
               staff_id uuid, staff_name text, is_me boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_business_role(p_business_id, '{owner,manager}') or private.is_admin('{ops}')) then
    perform private.raise_code('FORBIDDEN');
  end if;
  return query
  select m.user_id, m.role,
         coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(left(p.last_name, 1) || '.', '')), ''), 'Team member'),
         private.mask_phone(p.phone_e164),
         s.id, s.display_name, m.user_id = private.uid(), m.created_at
  from public.business_members m
  left join public.profiles p on p.id = m.user_id
  left join public.staff_members s on s.business_id = m.business_id and s.user_id = m.user_id
  where m.business_id = p_business_id and m.status = 'active'
  order by case m.role when 'owner' then 0 when 'manager' then 1 when 'reception' then 2 else 3 end, m.created_at;
end $$;
grant execute on function public.list_members(uuid) to authenticated;

-- Computed columns for PostgREST: select=*,lat,lng on business_locations (members only via RLS)
create function public.lat(l public.business_locations) returns double precision
language sql stable set search_path = '' as $$ select extensions.st_y(l.geo::extensions.geometry) $$;
create function public.lng(l public.business_locations) returns double precision
language sql stable set search_path = '' as $$ select extensions.st_x(l.geo::extensions.geometry) $$;
grant execute on function public.lat(public.business_locations), public.lng(public.business_locations) to authenticated;

select private.assign_app_ownership();
