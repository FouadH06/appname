-- M11 · Disputes (A7): list / detail with evidence, info requests, resolution with effects, default
--       rules job. No-show contests (M8) and "never attended" review disputes (M9) are resolved here.
-- Spec: Phase 2 A7; Phase 3 Part 4 §5; Part 7 §7 (dispute outcome effects). Legal disputes: superadmin.

-- Which outcomes fit which dispute type
create function private.dispute_outcome_ok(p_type public.dispute_type, p_outcome public.dispute_outcome) returns boolean
language sql immutable set search_path = '' as $$
  select case p_type
    when 'no_show' then p_outcome in ('no_show_upheld', 'no_show_overturned', 'voided')
    when 'review_attendance' then p_outcome in ('review_kept', 'review_text_removed', 'review_removed', 'voided')
    when 'legal' then p_outcome in ('legal_kept', 'legal_removed', 'voided')
    when 'ownership' then p_outcome in ('ownership_transferred', 'ownership_denied', 'voided')
  end
$$;

-- Effects (Part 7 §7), shared by the admin decision and the default-rules job. Caller has locked the row.
--   no_show_upheld      booking stays no-show (the customer's penalty stands)
--   no_show_overturned  booking → completed, penalty reversed exactly + visit credited, review eligibility
--   voided (no-show)    penalty reversed, booking stays as marked (neither side penalized)
--   review_*            keep / remove comment / remove review (rating summary recomputed)
--   legal_removed       the review is removed and kept under legal hold
create function private.apply_dispute_outcome(p_dispute_id uuid, p_outcome public.dispute_outcome, p_note text,
                                              p_actor public.actor_kind)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare d public.disputes; k public.bookings; v_booking uuid; v_notify boolean := true;
begin
  select * into d from public.disputes where id = p_dispute_id;
  if d.status not in ('open', 'awaiting_info') then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  if not private.dispute_outcome_ok(d.type, p_outcome) then perform private.raise_code('INVALID_INPUT', '{"field":"outcome"}'); end if;

  if d.type = 'no_show' then
    select * into k from public.bookings where id = d.booking_id for update;
    v_booking := k.id;
    if p_outcome = 'no_show_overturned' and k.status = 'no_show' then
      update public.bookings set status = 'completed', completed_by_kind = p_actor, completed_at = now(),
             review_eligible_until = case when customer_user_id is not null then now() + interval '30 days' end
       where id = k.id;
      perform private.add_reliability_event(k.customer_user_id, k.id, 'dispute_overturned', k.starts_at, 'dispute ' || d.id);
      perform private.add_reliability_event(k.customer_user_id, k.id, 'completed', now(), 'dispute ' || d.id);
      perform private.recompute_business_customer_stats(k.business_customer_id);
    elsif p_outcome = 'voided' and not exists (select 1 from private.reliability_events e where e.booking_id = k.id
                                                and e.kind in ('forgiven', 'dispute_overturned')) then
      perform private.add_reliability_event(k.customer_user_id, k.id, 'forgiven', k.starts_at, 'dispute voided ' || d.id);
    end if;
    perform private.log_booking_event(k.id, 'no_show_resolved', p_actor, k.status,
                                      case when p_outcome = 'no_show_overturned' then 'completed'::public.booking_status else k.status end,
                                      jsonb_build_object('dispute_id', d.id, 'outcome', p_outcome));
  elsif d.review_id is not null and p_outcome in ('review_text_removed', 'review_removed', 'legal_removed') then
    update public.reviews set
      text_state = case when text_state is not null then 'removed'::public.content_state end,
      status = case when p_outcome = 'review_text_removed' then status else 'removed' end,
      rating_state = case when p_outcome = 'review_text_removed' then rating_state else 'removed' end,
      removed_at = case when p_outcome = 'review_text_removed' then removed_at else now() end,
      removed_reason = case when p_outcome = 'review_text_removed' then removed_reason else 'dispute_outcome' end,
      legal_hold = legal_hold or p_outcome = 'legal_removed'
     where id = d.review_id and status <> 'deleted_by_author'
    returning booking_id into v_booking;
    perform private.recompute_rating_summary(d.business_id);
  end if;
  if v_booking is null and d.review_id is not null then
    select booking_id into v_booking from public.reviews where id = d.review_id;
  end if;

  update public.disputes set status = 'resolved', outcome = p_outcome, resolved_by = case when p_actor = 'admin' then private.uid() end,
         resolved_at = now(), resolution_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         legal_hold = legal_hold or d.type = 'legal'
   where id = d.id;
  update public.reports set status = case when p_outcome in ('review_kept', 'no_show_upheld', 'legal_kept') then 'resolved_no_action'
                                          else 'resolved_action' end::public.report_status,
         resolved_by = private.uid(), resolved_at = now()
   where subject_type = 'review' and subject_id = d.review_id and reason = 'never_attended' and status in ('open', 'in_review');

  -- both sides hear the outcome (legal and ownership cases are handled by hand)
  v_notify := d.type in ('no_show', 'review_attendance') and v_booking is not null;
  if v_notify then
    perform private.notify_customer('dispute_update', v_booking,
      jsonb_build_object('dispute_outcome', p_outcome, 'audience', 'customer', 'dispute_id', d.id), 'dispute:' || d.id || ':customer');
    perform private.notify_business('biz_report_resolved', v_booking,
      jsonb_build_object('dispute_outcome', p_outcome, 'audience', 'business', 'dispute_id', d.id));
  end if;
  return jsonb_build_object('outcome', p_outcome, 'booking_id', v_booking);
end $$;

-- ─── Admin RPCs ────────────────────────────────────────────────────────────
create function public.admin_list_disputes(p_type public.dispute_type default null, p_status public.dispute_status default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role public.admin_role;
begin
  v_role := private.admin_caller('{support}');
  if p_type = 'legal' and v_role <> 'superadmin' then perform private.raise_code('FORBIDDEN'); end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.due_at)
    from (
      select d.id, d.type, d.status, d.outcome, d.due_at, d.created_at, d.legal_hold, z.name as business,
             k.ref as booking_ref, (select count(*) from public.dispute_messages m where m.dispute_id = d.id)::int as messages
      from public.disputes d
      join public.businesses z on z.id = d.business_id
      left join public.bookings k on k.id = d.booking_id
      where (p_type is null or d.type = p_type)
        and (p_status is null or d.status = p_status)
        and (p_status is not null or d.status in ('open', 'awaiting_info'))
        and (d.type <> 'legal' or v_role = 'superadmin')
      order by d.due_at limit 200) x), '[]');
end $$;

create function public.admin_get_dispute(p_dispute_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.admin_role; d public.disputes; v_booking uuid;
begin
  v_role := private.admin_caller('{support}');
  select * into d from public.disputes where id = p_dispute_id;
  if d.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if d.type = 'legal' and v_role <> 'superadmin' then perform private.raise_code('FORBIDDEN'); end if;
  v_booking := coalesce(d.booking_id, (select booking_id from public.reviews where id = d.review_id));
  return jsonb_build_object(
    'dispute', to_jsonb(d),
    'business', (select jsonb_build_object('id', z.id, 'name', z.name, 'slug', z.slug,
                   -- win/loss pattern: many no-show marks later overturned is a signal (A7)
                   'history', (select coalesce(jsonb_object_agg(o, n), '{}') from (
                                 select coalesce(x.outcome::text, 'open') as o, count(*) as n from public.disputes x
                                 where x.business_id = z.id and x.type = 'no_show' group by 1) h),
                   'no_shows_90d', (select count(*) from public.bookings b where b.business_id = z.id and b.status = 'no_show'
                                    and b.starts_at > now() - interval '90 days'))
                 from public.businesses z where z.id = d.business_id),
    'customer', (select jsonb_build_object('id', p.id, 'name', nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
                   'phone', p.phone_e164, 'status', p.status,
                   'reliability', (select jsonb_build_object('score', r.score, 'tier', r.tier) from private.customer_reliability r where r.user_id = p.id),
                   'disputes', (select count(*) from public.disputes x where x.customer_user_id = p.id)::int)
                 from public.profiles p where p.id = d.customer_user_id),
    'booking', (select jsonb_build_object('id', k.id, 'ref', k.ref, 'status', k.status, 'starts_at', k.starts_at, 'source', k.source,
                   'created_by_kind', k.created_by_kind, 'no_show_at', k.no_show_at,
                   'services', (select coalesce(jsonb_agg(s.name order by i.starts_at), '[]') from public.booking_items i
                                join public.services s on s.id = i.service_id where i.booking_id = k.id))
                from public.bookings k where k.id = v_booking),
    -- the key evidence: who did what, when (reminders, confirmations, status changes)
    'events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'actor', e.actor_kind, 'from', e.from_status, 'to', e.to_status,
                          'data', e.data, 'created_at', e.created_at) order by e.created_at)
                        from public.booking_events e where e.booking_id = v_booking), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'status', n.status, 'sent_at', n.sent_at,
                                 'read_at', n.read_at, 'created_at', n.created_at) order by n.created_at)
                               from public.notifications n where n.booking_id = v_booking and n.recipient_user_id is not distinct from d.customer_user_id), '[]'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_kind', m.author_kind, 'visibility', m.visibility,
                            'body', m.body, 'created_at', m.created_at) order by m.created_at)
                          from public.dispute_messages m where m.dispute_id = d.id), '[]'),
    'review', (select jsonb_build_object('id', v.id, 'overall', v.overall, 'text', coalesce(v.text_display, v.text_original),
                 'status', v.status, 'text_state', v.text_state, 'rating_state', v.rating_state)
               from public.reviews v where v.id = d.review_id));
end $$;

-- Internal note, or a message to the parties (optionally asking for more information → awaiting_info).
create function public.admin_add_dispute_message(p_dispute_id uuid, p_body text, p_internal boolean default true,
                                                 p_request_info boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; d public.disputes; v_booking uuid;
begin
  v_role := private.admin_caller('{support}');
  select * into d from public.disputes where id = p_dispute_id for update;
  if d.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if d.type = 'legal' and v_role <> 'superadmin' then perform private.raise_code('FORBIDDEN'); end if;
  if d.status not in ('open', 'awaiting_info') then perform private.raise_code('TRANSITION_NOT_ALLOWED'); end if;
  if char_length(btrim(coalesce(p_body, ''))) < 2 then perform private.raise_code('REASON_REQUIRED'); end if;
  insert into public.dispute_messages (dispute_id, author_user_id, author_kind, visibility, body)
  values (d.id, private.uid(), 'admin', case when p_internal then 'internal' else 'parties' end, left(btrim(p_body), 2000));
  if p_request_info and not p_internal then
    update public.disputes set status = 'awaiting_info', due_at = greatest(due_at, now() + interval '48 hours') where id = d.id;
    v_booking := coalesce(d.booking_id, (select booking_id from public.reviews where id = d.review_id));
    if v_booking is not null then
      perform private.notify_customer('dispute_update', v_booking,
        jsonb_build_object('dispute_outcome', 'awaiting_info', 'audience', 'customer', 'dispute_id', d.id));
    end if;
  end if;
  perform private.admin_log(v_role, case when p_request_info and not p_internal then 'dispute.request_info' else 'dispute.message' end,
                            'dispute', d.id, d.business_id, case when p_internal then 'internal_note' else 'message_to_parties' end,
                            left(btrim(p_body), 1000), jsonb_build_object('status', d.status),
                            jsonb_build_object('status', case when p_request_info and not p_internal then 'awaiting_info' else d.status end));
end $$;

create function public.admin_resolve_dispute(p_dispute_id uuid, p_outcome public.dispute_outcome, p_reason text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; d public.disputes; v jsonb;
begin
  v_role := private.admin_caller('{support}');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  select * into d from public.disputes where id = p_dispute_id for update;
  if d.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if d.type = 'legal' and v_role <> 'superadmin' then perform private.raise_code('FORBIDDEN'); end if;
  v := private.apply_dispute_outcome(d.id, p_outcome, coalesce(p_note, p_reason), 'admin');
  perform private.admin_log(v_role, 'dispute.resolve', 'dispute', d.id, d.business_id, p_reason, p_note,
                            jsonb_build_object('status', d.status, 'type', d.type),
                            jsonb_build_object('status', 'resolved', 'outcome', p_outcome, 'booking_id', v ->> 'booking_id'));
  return v;
end $$;

-- ─── Default rules (A7): no-show disputes nobody has acted on for 7 days ───
-- A reminder the customer confirmed is evidence they meant to come → overturn; otherwise void.
create function private.job_dispute_default_rules() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare d record; n int := 0;
begin
  for d in select x.id, x.booking_id from public.disputes x
            where x.type = 'no_show' and x.status in ('open', 'awaiting_info') and x.created_at < now() - interval '7 days'
              and not exists (select 1 from public.dispute_messages m where m.dispute_id = x.id and m.author_kind = 'admin'
                              and m.created_at > now() - interval '7 days')
            for update of x skip locked loop
    perform private.apply_dispute_outcome(d.id,
      case when exists (select 1 from public.booking_events e where e.booking_id = d.booking_id and e.event = 'customer_confirmed')
           then 'no_show_overturned' else 'voided' end::public.dispute_outcome,
      'Default rule: no action for 7 days', 'system');
    n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('app_dispute_default_rules', '15 6 * * *', 'select private.job_dispute_default_rules()');

grant execute on function public.admin_list_disputes(public.dispute_type, public.dispute_status) to authenticated;
grant execute on function public.admin_get_dispute(uuid) to authenticated;
grant execute on function public.admin_add_dispute_message(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.admin_resolve_dispute(uuid, public.dispute_outcome, text, text) to authenticated;

select private.assign_app_ownership();
