-- M8 follow-up · Customer reschedule with "Any available" (approval 2026-09-28)
-- Two steps so the customer sees who they'll be with before confirming:
--   preview_reschedule_any → the staff member the business rule picks for the new time (public
--                            staff who perform the service and accept automatic assignment,
--                            within hours, not on time off, free incl. buffers)
--   reschedule_my_booking_any → re-checks that person is still a free candidate, then moves the
--                            booking through the same atomic path as every reschedule
--                            (window, grid/notice/horizon, exclusion constraint).
-- Bookings with internal-only staff keep the "contact the business" path (not offered).

create function private.my_reschedule_context(p_booking_id uuid, out b public.bookings, out item public.booking_items,
                                              out rule public.assignment_rule)
language plpgsql volatile security definer set search_path = '' as $$
declare s public.business_settings; st public.staff_members;
begin
  select * into b from public.bookings where id = p_booking_id and customer_user_id = private.uid();
  if b.id is null then perform private.raise_code('FORBIDDEN'); end if;
  item := private.single_item(p_booking_id);
  select * into st from public.staff_members where id = item.staff_id;
  if not st.publicly_bookable then perform private.raise_code('NOT_SUPPORTED', '{"reason":"internal_staff"}'); end if;
  select * into s from public.business_settings where business_id = b.business_id;
  if s.staff_choice_mode = 'choose_only' then perform private.raise_code('NOT_BOOKABLE', '{"reason":"choose_only"}'); end if;
  rule := s.assignment_rule;
end $$;

create function public.preview_reschedule_any(p_booking_id uuid, p_new_start timestamptz)
returns table (staff_id uuid, staff_first_name text, price_type public.price_type, price_min numeric,
               price_max numeric, duration_min int)
language plpgsql volatile security definer set search_path = '' as $$
declare c record; v_sid uuid;
begin
  select * into c from private.my_reschedule_context(p_booking_id);
  if (c.b).status not in ('pending', 'confirmed') or (c.b).starts_at <= now() then
    perform private.raise_code('TRANSITION_NOT_ALLOWED');
  end if;
  select r.staff_id into v_sid
  from private.rank_free_staff((c.b).location_id, (c.item).service_id, p_new_start, 'public_any', c.rule) r
  order by r.rnk limit 1;
  if v_sid is null then perform private.raise_code('SLOT_TAKEN'); end if;
  return query
  select v_sid, split_part(s.display_name, ' ', 1), t.price_type, t.price_min, t.price_max, t.duration_min
  from public.staff_members s cross join lateral private.staff_service_terms(v_sid, (c.item).service_id) t
  where s.id = v_sid;
end $$;

create function public.reschedule_my_booking_any(p_booking_id uuid, p_new_start timestamptz, p_staff_id uuid)
returns public.bookings
language plpgsql volatile security definer set search_path = '' as $$
declare c record; v public.bookings;
begin
  select * into c from private.my_reschedule_context(p_booking_id);
  -- the previewed person must still be a free Any-candidate for that time (else: preview again)
  if not exists (select 1 from private.rank_free_staff((c.b).location_id, (c.item).service_id, p_new_start, 'public_any', c.rule) r
                 where r.staff_id = p_staff_id) then
    perform private.raise_code('STAFF_NOT_FREE');
  end if;
  v := private.do_reschedule(p_booking_id, p_new_start, p_staff_id, 'customer', false, true);
  -- an Any booking stays an Any booking (do_reschedule marks customer staff changes as "specific")
  update public.booking_items
     set selection_mode = 'any', requested_staff_id = null, assignment_rule_used = c.rule
   where id = (c.item).id;
  update public.staff_members set last_auto_assigned_at = now() where id = p_staff_id;
  return v;
end $$;

grant execute on function public.preview_reschedule_any(uuid, timestamptz)          to authenticated;
grant execute on function public.reschedule_my_booking_any(uuid, timestamptz, uuid) to authenticated;

select private.assign_app_ownership();
