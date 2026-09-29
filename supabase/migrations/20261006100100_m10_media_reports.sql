-- M10 · Reports on customer photos ("inappropriate", "not a real result", "that's my photo") and a
--      guard so media cases are decided through admin_decide_media_case. Same M9 functions otherwise.

create or replace function public.report_content(p_subject_type public.report_subject, p_subject_id uuid, p_reason public.report_reason,
                                      p_parts text[] default '{whole}', p_details text default null,
                                      p_as_business_id uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid(); v_cfg jsonb := private.trust_config(); r public.reviews; v_biz uuid; v_id uuid;
  v_case uuid; v_dispute uuid; v_subject public.moderation_subject; rmd public.review_media;
begin
  if v_uid is null or coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) then perform private.raise_code('AUTH_REQUIRED'); end if;
  if p_subject_type = 'review' then
    select * into r from public.reviews where id = p_subject_id;
    if r.id is null then perform private.raise_code('NOT_FOUND'); end if;
    v_biz := r.business_id;
  elsif p_subject_type = 'review_reply' then
    select business_id into v_biz from public.review_replies where id = p_subject_id;
  elsif p_subject_type = 'review_media' then
    select * into rmd from public.review_media where id = p_subject_id;
    if rmd.id is null then perform private.raise_code('NOT_FOUND'); end if;
    v_biz := rmd.business_id;
  elsif p_subject_type = 'business' then
    v_biz := p_subject_id;
  end if;
  if p_as_business_id is not null then
    if not private.has_business_role(p_as_business_id, '{owner,manager}') or v_biz is distinct from p_as_business_id then
      perform private.raise_code('FORBIDDEN');
    end if;
    if (select count(*) from public.reports where reporter_business_id = p_as_business_id and status in ('open', 'in_review'))
       >= coalesce((v_cfg #>> '{limits,business_open_reports}')::int, 10) then
      perform private.raise_code('REPORT_LIMIT');
    end if;
  end if;

  insert into public.reports (reporter_user_id, reporter_kind, reporter_business_id, subject_type, subject_id, subject_business_id,
                              reason, parts, details)
  values (v_uid, case when p_as_business_id is null then 'customer' else 'business' end, p_as_business_id, p_subject_type,
          p_subject_id, v_biz, p_reason, coalesce(p_parts, '{whole}'), left(p_details, 1000))
  returning id into v_id;

  if p_subject_type = 'review' and p_reason = 'never_attended' then
    insert into public.disputes (type, booking_id, review_id, business_id, customer_user_id, opened_by_user_id, opened_by_kind, due_at)
    values ('review_attendance', r.booking_id, r.id, r.business_id, r.author_user_id, v_uid,
            case when p_as_business_id is null then 'customer' else 'business' end::public.actor_kind, now() + interval '48 hours')
    returning id into v_dispute;
    update public.reports set dispute_id = v_dispute, status = 'in_review' where id = v_id;
  else
    v_subject := case p_subject_type when 'review_reply' then 'reply_text' when 'review_media' then 'review_media'
                                     else 'review_text' end::public.moderation_subject;
    -- M10: photo cases are keyed by the media asset; "that's my photo" goes to the top of the queue
    insert into public.moderation_cases (subject_type, subject_id, business_id, author_user_id, source, report_id, reasons, priority, sla_due_at)
    values (v_subject, case when p_subject_type = 'review_media' then rmd.media_asset_id else p_subject_id end, v_biz,
            case when p_subject_type = 'review' then r.author_user_id
                 when p_subject_type = 'review_media' then (select uploader_user_id from public.media_assets where id = rmd.media_asset_id) end,
            'report', v_id, array[p_reason::text], case when p_reason = 'my_photo' then 90 else 70 end,
            now() + make_interval(hours => coalesce((v_cfg #>> '{sla_hours,report}')::int, 24)))
    on conflict (subject_type, subject_id) where state in ('open', 'claimed', 'escalated')
    do update set priority = public.moderation_cases.priority + 20,
                  reasons = array(select distinct unnest(public.moderation_cases.reasons || excluded.reasons))
    returning id into v_case;
    update public.reports set moderation_case_id = v_case, status = 'in_review' where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.admin_decide_case(p_case_id uuid, p_decision public.moderation_decision, p_reason_code text,
                                         p_note text default null, p_redaction jsonb default null, p_user_action text default 'none')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.moderation_cases; v_role public.admin_role; r public.reviews; v_before jsonb; v_after jsonb; v_review uuid;
begin
  if not private.is_admin('{moderator,support}') then perform private.raise_code('FORBIDDEN'); end if;
  select role into v_role from public.admin_users where user_id = private.uid();
  select * into c from public.moderation_cases where id = p_case_id for update;
  if c.id is null then perform private.raise_code('NOT_FOUND'); end if;
  -- M10: photo cases have their own decision (publish / remove derivatives)
  if c.subject_type in ('review_media', 'business_media') then perform private.raise_code('USE_MEDIA_DECISION'); end if;
  if c.state = 'decided' or (c.state = 'claimed' and c.claimed_by <> private.uid() and c.claimed_at > now() - interval '15 minutes') then
    perform private.raise_code('CASE_TAKEN');
  end if;
  if nullif(btrim(coalesce(p_reason_code, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  if p_user_action = 'suspend' and v_role not in ('support', 'superadmin') then perform private.raise_code('FORBIDDEN'); end if;

  if p_decision = 'escalate' then
    update public.moderation_cases set state = 'escalated', note = p_note where id = c.id;
    return;
  end if;

  if c.subject_type = 'reply_text' then
    select to_jsonb(rp) into v_before from public.review_replies rp where rp.id = c.subject_id;
    update public.review_replies set
      text_state = case p_decision when 'approve' then 'approved' when 'approve_redacted' then 'approved_redacted'
                                   when 'reject' then 'rejected' else 'removed' end::public.content_state,
      text_display = case when p_decision = 'approve_redacted' then p_redaction ->> 'text' else text_display end,
      published_at = case when p_decision in ('approve', 'approve_redacted') then now() end
     where id = c.subject_id;
    select to_jsonb(rp), rp.review_id into v_after, v_review from public.review_replies rp where rp.id = c.subject_id;
  else
    select * into r from public.reviews where id = c.subject_id for update;
    v_before := to_jsonb(r);
    if c.source = 'fraud' then
      -- fraud investigation: approve = dismiss (restore); remove_review = confirm
      if p_decision in ('approve', 'approve_redacted') then
        update private.fraud_signals set status = 'dismissed', reviewed_by = private.uid(), reviewed_at = now()
         where subject_type = 'review' and subject_id = r.id and status = 'open';
        update public.reviews set rating_state = 'active', fraud_multiplier = 1, status = 'published',
               published_at = coalesce(published_at, now()) where id = r.id;
      elsif p_decision = 'remove_review' then
        update private.fraud_signals set status = 'actioned', reviewed_by = private.uid(), reviewed_at = now()
         where subject_type = 'review' and subject_id = r.id and status = 'open';
        update public.reviews set rating_state = 'removed', status = 'removed', removed_at = now(), removed_reason = p_reason_code,
               text_state = case when text_state is not null then 'removed'::public.content_state end where id = r.id;
      end if;
    else
      update public.reviews set
        text_state = case p_decision
                       when 'approve' then 'approved' when 'approve_redacted' then 'approved_redacted'
                       when 'reject' then 'rejected' when 'remove_text' then 'removed'
                       when 'remove_review' then 'removed' else text_state::text end::public.content_state,
        text_display = case when p_decision = 'approve_redacted' then p_redaction ->> 'text' else text_display end,
        rating_state = case when p_decision = 'remove_review' then 'removed' else rating_state end,
        status = case when p_decision = 'remove_review' then 'removed' else status end,
        removed_at = case when p_decision = 'remove_review' then now() else removed_at end,
        removed_reason = case when p_decision = 'remove_review' then p_reason_code else removed_reason end
       where id = r.id and r.text_state is not null or (id = r.id and p_decision = 'remove_review');
    end if;
    select to_jsonb(x) into v_after from public.reviews x where x.id = r.id;
    v_review := r.id;
  end if;

  update public.moderation_cases set state = 'decided', decided_by = private.uid(), decided_at = now(), decision = p_decision,
         decision_reason_code = p_reason_code, note = p_note, redaction = p_redaction, user_action = coalesce(p_user_action, 'none')
   where id = c.id;
  update public.reports set status = case when p_decision in ('approve') then 'resolved_no_action' else 'resolved_action' end::public.report_status,
         resolved_by = private.uid(), resolved_at = now(), resolution_note = p_note
   where moderation_case_id = c.id and status in ('open', 'in_review');
  if p_user_action = 'warn' then
    update public.profiles set status = 'warned' where id = c.author_user_id and status = 'active';
  elsif p_user_action = 'suspend' then
    update public.profiles set status = 'suspended' where id = c.author_user_id;
  end if;
  insert into audit.admin_actions (actor_user_id, actor_role, action, subject_type, subject_id, business_id, reason_code, note, before, after)
  values (private.uid(), v_role, 'moderation.decide', c.subject_type::text, c.subject_id, c.business_id, p_reason_code, p_note, v_before, v_after);
  if v_review is not null then
    perform private.recompute_rating_summary((select business_id from public.reviews where id = v_review));
  end if;
end $$;

select private.assign_app_ownership();
