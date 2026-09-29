-- M9 · Text moderation + translation workers (service_role only, called by the `moderate` Edge
--      Function every minute via pg_cron → Vault → pg_net), the "comment needs changes" message,
--      public translations, and the rating on the business page.
-- Spec: Phase 3 Part 4 §3 (text pipeline), §6 (translations); Part 7 §7.

-- ─── Moderation queue ──────────────────────────────────────────────────────
-- Claims up to p_limit jobs (hidden for p_vt seconds while the worker runs). Jobs whose text is no
-- longer pending (edited again, deleted, decided by a moderator) are dropped here. A job that keeps
-- failing (read 5+ times) goes to a human instead of looping.
create function public.moderation_claim(p_limit int default 20, p_vt int default 120) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m record; v_out jsonb := '[]'::jsonb; v_text text; v_biz uuid; v_ctx jsonb; v_locale text; v_author uuid;
begin
  for m in select * from pgmq.read('moderation', greatest(coalesce(p_vt, 120), 30), least(greatest(coalesce(p_limit, 20), 1), 100)) loop
    v_text := null;
    if m.message ->> 'subject' = 'review_text' then
      select r.text_original, r.business_id, r.author_user_id,
             jsonb_build_object('service', s.name, 'staff', st.display_name)
        into v_text, v_biz, v_author, v_ctx
      from public.reviews r
      join public.services s on s.id = r.service_id
      join public.staff_members st on st.id = r.staff_id
      where r.id = (m.message ->> 'id')::uuid and r.text_state = 'pending' and r.status <> 'deleted_by_author';
    elsif m.message ->> 'subject' = 'reply_text' then
      select rp.text_original, rp.business_id, rp.author_user_id, jsonb_build_object('reply_to', r.text_original)
        into v_text, v_biz, v_author, v_ctx
      from public.review_replies rp join public.reviews r on r.id = rp.review_id
      where rp.id = (m.message ->> 'id')::uuid and rp.text_state = 'pending';
    end if;

    if v_text is null then
      perform pgmq.delete('moderation', m.msg_id);
      continue;
    end if;
    if m.read_ct > 5 then
      perform private.moderation_to_human((m.message ->> 'subject')::public.moderation_subject, (m.message ->> 'id')::uuid,
                                          '{worker_failed}', null);
      perform pgmq.delete('moderation', m.msg_id);
      continue;
    end if;

    select coalesce(p.locale::text, 'en') into v_locale from public.profiles p where p.id = v_author;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'msg_id', m.msg_id, 'subject', m.message ->> 'subject', 'id', m.message ->> 'id', 'run_id', m.message ->> 'run_id',
      'attempt', m.read_ct, 'text', v_text, 'text_hash', md5(v_text), 'locale', coalesce(v_locale, 'en'),
      'config', coalesce(private.trust_config() -> 'text', '{}'),
      'context', v_ctx || jsonb_build_object(
        'business', (select z.name from public.businesses z where z.id = v_biz),
        -- names that make a comment "about a person" (targeted), for the rules and the classifier
        'people', (select coalesce(jsonb_agg(distinct split_part(st.display_name, ' ', 1)), '[]')
                   from public.staff_members st where st.business_id = v_biz and btrim(st.display_name) <> ''))));
  end loop;
  return v_out;
end $$;

-- Opens (or keeps) the one open case for this text and marks the text as waiting for a human
create function private.moderation_to_human(p_subject public.moderation_subject, p_id uuid, p_reasons text[], p_confidence real)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_biz uuid; v_author uuid; v_hours int := coalesce((private.trust_config() #>> '{sla_hours,pipeline}')::int, 24);
begin
  if p_subject = 'review_text' then
    update public.reviews set text_state = 'manual_review' where id = p_id returning business_id, author_user_id into v_biz, v_author;
  else
    update public.review_replies set text_state = 'manual_review' where id = p_id returning business_id, author_user_id into v_biz, v_author;
  end if;
  insert into public.moderation_cases (subject_type, subject_id, business_id, author_user_id, source, reasons,
                                       auto_decision, auto_confidence, priority, sla_due_at)
  values (p_subject, p_id, v_biz, v_author, 'pipeline', coalesce(p_reasons, '{}'), 'escalate', p_confidence,
          case when 'worker_failed' = any(p_reasons) then 40 else 50 end, now() + make_interval(hours => v_hours))
  on conflict (subject_type, subject_id) where state in ('open', 'claimed', 'escalated') do nothing;
end $$;

-- Records one worker run: every stage result, the private classifier output, and the decision —
-- applied only while the text is exactly what was classified and still pending.
-- p_decision: approve · approve_redacted (p_text_display = redacted text) · reject · manual_review
create function public.moderation_record(p_msg_id bigint, p_subject public.moderation_subject, p_id uuid, p_run_id uuid,
                                         p_text_hash text, p_decision text, p_text_display text default null,
                                         p_stages jsonb default '[]', p_normalized text default null,
                                         p_pii_spans jsonb default '[]', p_classifier jsonb default null,
                                         p_langs text[] default '{}', p_confidence real default null,
                                         p_reasons text[] default '{}')
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_current text; v_state public.content_state; s jsonb;
begin
  if p_decision not in ('approve', 'approve_redacted', 'reject', 'manual_review') then
    perform private.raise_code('INVALID_INPUT', '{"field":"decision"}');
  end if;
  if p_decision = 'approve_redacted' and nullif(btrim(coalesce(p_text_display, '')), '') is null then
    perform private.raise_code('INVALID_INPUT', '{"field":"text_display"}');
  end if;

  for s in select * from jsonb_array_elements(coalesce(p_stages, '[]')) loop
    insert into private.moderation_results (subject_type, subject_id, run_id, stage, outcome, scores, labels, model, model_version, latency_ms)
    values (p_subject, p_id, p_run_id, (s ->> 'stage')::public.moderation_stage, s ->> 'outcome', coalesce(s -> 'scores', '{}'),
            coalesce((select array_agg(x) from jsonb_array_elements_text(s -> 'labels') x), '{}'),
            s ->> 'model', s ->> 'model_version', (s ->> 'latency_ms')::int);
  end loop;

  if p_subject = 'review_text' then
    select text_original, text_state into v_current, v_state from public.reviews where id = p_id for update;
  else
    select text_original, text_state into v_current, v_state from public.review_replies where id = p_id for update;
  end if;
  if v_current is null or v_state <> 'pending' or md5(v_current) <> p_text_hash then
    perform pgmq.delete('moderation', p_msg_id);
    return 'stale';
  end if;

  if p_subject = 'review_text' then
    insert into private.review_text_private (review_id, text_normalized, pii_spans, classifier)
    values (p_id, p_normalized, coalesce(p_pii_spans, '[]'), p_classifier)
    on conflict (review_id) do update set text_normalized = excluded.text_normalized, pii_spans = excluded.pii_spans,
      classifier = excluded.classifier, updated_at = now();
    update public.reviews set detected_langs = coalesce(p_langs, '{}') where id = p_id;
  end if;

  if p_decision = 'manual_review' then
    perform private.moderation_to_human(p_subject, p_id, p_reasons, p_confidence);
  elsif p_subject = 'review_text' then
    update public.reviews set text_state = case p_decision when 'reject' then 'rejected' when 'approve' then 'approved' else 'approved_redacted' end::public.content_state,
           text_display = case when p_decision = 'approve_redacted' then p_text_display end
     where id = p_id;
  else
    update public.review_replies set text_state = case p_decision when 'reject' then 'rejected' when 'approve' then 'approved' else 'approved_redacted' end::public.content_state,
           text_display = case when p_decision = 'approve_redacted' then p_text_display end,
           published_at = case when p_decision in ('approve', 'approve_redacted') then now() end
     where id = p_id;
  end if;
  perform pgmq.delete('moderation', p_msg_id);
  return p_decision;
end $$;

-- "Your comment couldn't be published as written": whenever a review's text is rejected (by the
-- pipeline or a moderator) while the author can still edit it. The star rating stays live.
create function private.on_review_text_rejected() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.text_state = 'rejected' and old.text_state is distinct from 'rejected'
     and new.edit_count = 0 and now() < new.editable_until and new.status not in ('removed', 'deleted_by_author') then
    perform private.notify_customer('review_needs_changes', new.booking_id,
                                    private.review_link_payload(new.booking_id) || jsonb_build_object('review_id', new.id),
                                    'review_needs_changes:' || new.id);
  end if;
  return null;
end $$;
create trigger reviews_text_rejected after update of text_state on public.reviews
  for each row execute function private.on_review_text_rejected();

-- ─── Translations (Part 4 §6): on demand, cached per text and language ─────
create table private.translation_requests (
  subject_type   text not null,
  subject_id     uuid not null,
  target_locale  public.app_locale not null,
  requested_at   timestamptz not null default now(),
  failed         boolean not null default false,
  primary key (subject_type, subject_id, target_locale)
);
alter table private.translation_requests enable row level security;

-- The text a visitor may see (null when it isn't public)
create function private.translatable_text(p_subject_type text, p_subject_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case p_subject_type
    when 'review' then (select coalesce(r.text_display, r.text_original) from public.reviews r
                        where r.id = p_subject_id and private.rating_is_counted(r) and r.text_state in ('approved', 'approved_redacted'))
    when 'reply' then (select coalesce(rp.text_display, rp.text_original) from public.review_replies rp join public.reviews r on r.id = rp.review_id
                       where rp.id = p_subject_id and rp.text_state in ('approved', 'approved_redacted') and private.rating_is_counted(r))
  end
$$;

-- {state: ready, text} from the cache, or {state: pending} while the worker translates (poll).
-- Cost is bounded per text: one job per text and language, retried at most every 10 minutes.
create function public.request_translation(p_subject_type text, p_subject_id uuid, p_locale public.app_locale) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_text text; t public.content_translations; q private.translation_requests;
begin
  v_text := private.translatable_text(p_subject_type, p_subject_id);
  if v_text is null then perform private.raise_code('NOT_FOUND'); end if;
  select * into t from public.content_translations
   where subject_type = p_subject_type and subject_id = p_subject_id and target_locale = p_locale;
  if t.subject_id is not null then return jsonb_build_object('state', 'ready', 'text', t.text, 'source_langs', t.source_langs); end if;

  select * into q from private.translation_requests
   where subject_type = p_subject_type and subject_id = p_subject_id and target_locale = p_locale for update;
  if q.subject_id is null or q.requested_at < now() - interval '10 minutes' then
    insert into private.translation_requests (subject_type, subject_id, target_locale) values (p_subject_type, p_subject_id, p_locale)
    on conflict (subject_type, subject_id, target_locale) do update set requested_at = now(), failed = false;
    perform pgmq.send('translate', jsonb_build_object('subject_type', p_subject_type, 'id', p_subject_id, 'locale', p_locale));
    return jsonb_build_object('state', 'pending');
  end if;
  return jsonb_build_object('state', case when q.failed then 'unavailable' else 'pending' end);
end $$;

create function public.translation_claim(p_limit int default 20, p_vt int default 120) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare m record; v_out jsonb := '[]'::jsonb; v_text text;
begin
  for m in select * from pgmq.read('translate', greatest(coalesce(p_vt, 120), 30), least(greatest(coalesce(p_limit, 20), 1), 100)) loop
    v_text := private.translatable_text(m.message ->> 'subject_type', (m.message ->> 'id')::uuid);
    if v_text is null or exists (select 1 from public.content_translations c where c.subject_type = m.message ->> 'subject_type'
                                   and c.subject_id = (m.message ->> 'id')::uuid and c.target_locale = (m.message ->> 'locale')::public.app_locale) then
      perform pgmq.delete('translate', m.msg_id);
      continue;
    end if;
    if m.read_ct > 3 then
      update private.translation_requests set failed = true
       where subject_type = m.message ->> 'subject_type' and subject_id = (m.message ->> 'id')::uuid
         and target_locale = (m.message ->> 'locale')::public.app_locale;
      perform pgmq.delete('translate', m.msg_id);
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('msg_id', m.msg_id, 'subject_type', m.message ->> 'subject_type',
               'id', m.message ->> 'id', 'locale', m.message ->> 'locale', 'text', v_text));
  end loop;
  return v_out;
end $$;

create function public.translation_record(p_msg_id bigint, p_subject_type text, p_subject_id uuid, p_locale public.app_locale,
                                          p_text text, p_source_langs text[], p_model text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if nullif(btrim(coalesce(p_text, '')), '') is not null then
    insert into public.content_translations (subject_type, subject_id, target_locale, text, source_langs, model)
    values (p_subject_type, p_subject_id, p_locale, p_text, coalesce(p_source_langs, '{}'), p_model)
    on conflict (subject_type, subject_id, target_locale) do nothing;
  end if;
  perform pgmq.delete('translate', p_msg_id);
end $$;

-- Edited or removed texts drop their cached translations
create function private.drop_stale_translations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.text_original is distinct from old.text_original or new.text_display is distinct from old.text_display then
    delete from public.content_translations where subject_type = tg_argv[0] and subject_id = new.id;
    delete from private.translation_requests where subject_type = tg_argv[0] and subject_id = new.id;
  end if;
  return null;
end $$;
create trigger reviews_drop_translations after update of text_original, text_display on public.reviews
  for each row execute function private.drop_stale_translations('review');
create trigger replies_drop_translations after update of text_original, text_display on public.review_replies
  for each row execute function private.drop_stale_translations('reply');

-- ─── Worker job: pg_cron → moderate (URL + shared secret from Vault) ──────
-- Same pattern as app_notify_dispatch: nothing is called when both queues are empty or when the
-- environment has no Vault entries (local/CI run the worker directly).
select cron.schedule('app_moderate', '* * * * *', $job$
  select net.http_post(
           url := u.decrypted_secret, body := '{}'::jsonb,
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-moderate-secret', s.decrypted_secret),
           timeout_milliseconds := 55000)
  from vault.decrypted_secrets u, vault.decrypted_secrets s
  where u.name = 'moderate_url' and s.name = 'moderate_secret'
    and (exists (select 1 from pgmq.q_moderation where vt <= now()) or exists (select 1 from pgmq.q_translate where vt <= now()))
$job$);

-- ─── Grants ────────────────────────────────────────────────────────────────
revoke execute on function public.moderation_claim(int, int),
  public.moderation_record(bigint, public.moderation_subject, uuid, uuid, text, text, text, jsonb, text, jsonb, jsonb, text[], real, text[]),
  public.translation_claim(int, int), public.translation_record(bigint, text, uuid, public.app_locale, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.moderation_claim(int, int),
  public.moderation_record(bigint, public.moderation_subject, uuid, uuid, text, text, text, jsonb, text, jsonb, jsonb, text[], real, text[]),
  public.translation_claim(int, int), public.translation_record(bigint, text, uuid, public.app_locale, text, text[], text)
  to service_role;
revoke execute on function public.request_translation(text, uuid, public.app_locale) from public;
grant execute on function public.request_translation(text, uuid, public.app_locale) to anon, authenticated;

select private.assign_app_ownership();
