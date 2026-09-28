-- M5 · Customer list (B6) and notes — role-projected RPCs
-- Spec: Phase 3 Part 5 §4 (biz_search_customers, biz_upsert_customer, notes RPCs), Part 6 §3.4,
--       Phase 2 B6. Reception sees spend only if reception_sees_revenue; staff see only customers
--       with an upcoming booking with them (name + visits; phone only if staff_see_customer_phone).
--       Reviews and cross-business data are never included.

create function public.biz_search_customers(
  p_business_id uuid, p_q text default null, p_sort text default 'recent',
  p_limit int default 50, p_offset int default 0)
returns table (id uuid, display_name text, phone_e164 text, visit_count int, last_visit_at timestamptz,
               lifetime_spend numeric, preferred_staff_name text, reliability_label text,
               acquired_via public.acquisition_channel, is_claimed boolean, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.business_role := private.my_role(p_business_id);
  v_set public.business_settings;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text := regexp_replace(private.normalize_digits(coalesce(p_q, '')), '\D', '', 'g');
  v_staff uuid;
begin
  if v_role is null then perform private.raise_code('FORBIDDEN'); end if;
  select * into v_set from public.business_settings where business_id = p_business_id;
  v_staff := case when v_role = 'staff' then private.my_staff_id(p_business_id) end;
  -- Lebanese local format: 03 123 456 → search 3123456 (the E.164 form has no trunk 0)
  if v_digits like '0%' then v_digits := substr(v_digits, 2); end if;

  return query
  with base as (
    select bc.*
    from public.business_customers bc
    where bc.business_id = p_business_id and bc.merged_into_id is null and bc.archived_at is null
      and (v_role <> 'staff' or exists (
            select 1 from public.bookings b join public.booking_items bi on bi.booking_id = b.id
            where b.business_customer_id = bc.id and bi.staff_id = v_staff
              and b.status in ('pending', 'confirmed') and b.starts_at > now()))
      and (v_q = ''
           or (v_digits <> '' and v_q ~ '^[+0-9٠-٩۰-۹ ()-]+$' and bc.phone_e164 like '%' || v_digits || '%')
           or private.normalize_text(bc.display_name) like '%' || private.normalize_text(v_q) || '%')
  )
  select b.id, b.display_name,
         case when v_role <> 'staff' or v_set.staff_see_customer_phone then b.phone_e164 end,
         b.visit_count, b.last_visit_at,
         case when v_role in ('owner', 'manager') or (v_role = 'reception' and v_set.reception_sees_revenue)
              then b.lifetime_spend end,
         (select split_part(s.display_name, ' ', 1) from public.staff_members s where s.id = b.preferred_staff_id),
         case when v_role = 'staff' then null
              when b.user_id is null then 'new_customer'
              else case private.reliability_tier(b.user_id)
                     when 'new' then 'new_customer' when 'reliable' then 'reliable'
                     else 'some_missed_appointments' end end,
         b.acquired_via, b.user_id is not null,
         count(*) over ()
  from base b
  order by
    case when p_sort = 'name'   then private.normalize_text(b.display_name) end asc,
    case when p_sort = 'visits' then b.visit_count end desc,
    case when p_sort = 'spend' and v_role in ('owner', 'manager') then b.lifetime_spend end desc,
    b.last_visit_at desc nulls last, b.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Add or edit a customer the business knows (B6 "+ Add customer"; name/phone edits).
-- A phone already used by another customer of this business → DUPLICATE_CUSTOMER {id, display_name}.
create function public.biz_upsert_customer(p_business_id uuid, p_display_name text, p_phone text default null,
                                           p_id uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_phone text; v_name text := left(btrim(coalesce(p_display_name, '')), 80); v_dup record; v_id uuid;
begin
  if not private.has_business_role(p_business_id, '{owner,manager,reception}') then perform private.raise_code('FORBIDDEN'); end if;
  if v_name = '' then perform private.raise_code('NAME_REQUIRED'); end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    v_phone := private.normalize_phone(private.normalize_digits(p_phone));
    if v_phone is null then perform private.raise_code('INVALID_PHONE'); end if;
    select bc.id, bc.display_name into v_dup from public.business_customers bc
     where bc.business_id = p_business_id and bc.phone_e164 = v_phone and bc.merged_into_id is null
       and bc.archived_at is null and bc.id is distinct from p_id
     limit 1;
    if v_dup.id is not null then
      perform private.raise_code('DUPLICATE_CUSTOMER', jsonb_build_object('id', v_dup.id, 'display_name', v_dup.display_name));
    end if;
  end if;

  if p_id is null then
    insert into public.business_customers (business_id, display_name, phone_e164, acquired_via)
    values (p_business_id, v_name, v_phone, 'manual') returning id into v_id;
  else
    update public.business_customers set display_name = v_name, phone_e164 = v_phone
     where id = p_id and business_id = p_business_id and merged_into_id is null
    returning id into v_id;
    if v_id is null then perform private.raise_code('FORBIDDEN'); end if;
  end if;
  return v_id;
end $$;

-- ─── Notes (private to the business; pinned notes show on the calendar in M6) ──
create function public.biz_add_note(p_business_id uuid, p_customer_id uuid, p_body text,
                                    p_pinned boolean default false, p_visible_to_staff boolean default false)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.has_business_role(p_business_id, '{owner,manager,reception}') then perform private.raise_code('FORBIDDEN'); end if;
  if not exists (select 1 from public.business_customers where id = p_customer_id and business_id = p_business_id) then
    perform private.raise_code('FORBIDDEN');
  end if;
  insert into public.customer_notes (business_id, business_customer_id, author_user_id, body, is_pinned, visible_to_staff)
  values (p_business_id, p_customer_id, private.uid(), btrim(p_body), coalesce(p_pinned, false), coalesce(p_visible_to_staff, false))
  returning id into v_id;
  return v_id;
end $$;

create function public.biz_update_note(p_note_id uuid, p_body text, p_pinned boolean, p_visible_to_staff boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare n public.customer_notes;
begin
  select * into n from public.customer_notes where id = p_note_id and deleted_at is null for update;
  if n.id is null or n.is_system or not private.has_business_role(n.business_id, '{owner,manager,reception}') then
    perform private.raise_code('FORBIDDEN');
  end if;
  update public.customer_notes set body = btrim(p_body), is_pinned = coalesce(p_pinned, is_pinned),
                                   visible_to_staff = coalesce(p_visible_to_staff, visible_to_staff)
   where id = p_note_id;
end $$;

create function public.biz_delete_note(p_note_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare n public.customer_notes;
begin
  select * into n from public.customer_notes where id = p_note_id and deleted_at is null for update;
  if n.id is null or not private.has_business_role(n.business_id, '{owner,manager,reception}') then
    perform private.raise_code('FORBIDDEN');
  end if;
  update public.customer_notes set deleted_at = now() where id = p_note_id;
end $$;

grant execute on function public.biz_search_customers(uuid, text, text, int, int)       to authenticated;
grant execute on function public.biz_upsert_customer(uuid, text, text, uuid)            to authenticated;
grant execute on function public.biz_add_note(uuid, uuid, text, boolean, boolean)       to authenticated;
grant execute on function public.biz_update_note(uuid, text, boolean, boolean)          to authenticated;
grant execute on function public.biz_delete_note(uuid)                                  to authenticated;

select private.assign_app_ownership();
