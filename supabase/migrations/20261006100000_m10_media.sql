-- M10 · Customer results & media pipeline: review media (private-first), the image worker contract
--      (processor-independent), hash / classify / publish stages, featuring, public results read
--      models, removal and retention jobs, business media safety check.
-- Spec: Phase 3 Part 4 §2 (2.1–2.6), §3.2; Part 6 storage; Part 7 §46, 46d, 47–49, 58; Phase 2 C6, C16.
-- Processor: the M10 benchmark chose the external worker (apps/media-worker) for the transform; it
-- claims jobs and reports through the same two RPCs an Edge processor would use.

-- ─── Config (media thresholds) ─────────────────────────────────────────────
insert into private.trust_config (version, config, is_active)
select 2, config || '{
  "media": {
    "min_side": 300, "max_per_review": 4, "upload_window_days": 30,
    "phash_near_dup": 6, "dup_lookback_days": 180,
    "relevance_reject": 0.40, "relevance_pass": 0.75,
    "safety_hard": 0.85, "safety_grey": 0.40,
    "retention_days": 30, "transform_retries": 3
  }}'::jsonb, false
from private.trust_config where is_active;
update private.trust_config set is_active = false where is_active;
update private.trust_config set is_active = true where version = 2;

-- ─── Schema ────────────────────────────────────────────────────────────────
alter table public.media_assets
  add column processor          text check (processor in ('edge', 'external')),
  add column processor_version  text,
  add column derivatives        jsonb,          -- [{name, path, width, height, bytes}] (staging, then public)
  add column rejected_reason    text,           -- category shown to the author (never safety details)
  add column legal_hold         boolean not null default false,
  add column purge_after        timestamptz;    -- private original kept for appeals, then deleted

create table public.review_media (
  id                    uuid primary key default gen_random_uuid(),
  review_id             uuid not null references public.reviews(id) on delete cascade,
  media_asset_id        uuid not null unique references public.media_assets(id),
  booking_item_id       uuid not null references public.booking_items(id),
  kind                  public.media_kind not null default 'result',
  pair_group            uuid,
  consent_version       text not null,
  consented_at          timestamptz not null,
  business_id           uuid not null references public.businesses(id),
  location_id           uuid not null,
  area_id               uuid not null references public.areas(id),
  staff_id              uuid not null,
  service_id            uuid not null,
  canonical_service_id  uuid not null references public.canonical_services(id),
  price_type            public.price_type not null,
  price_min             numeric(10,2),
  price_max             numeric(10,2),
  currency              char(3) not null default 'USD',
  visit_at              timestamptz not null,
  trust_tier            public.trust_tier not null,
  state                 public.content_state not null default 'pending',
  minor_flag            boolean not null default false,
  is_featured           boolean not null default false,
  featured_rank         smallint check (featured_rank between 1 and 6),
  featured_at           timestamptz,
  featured_by           uuid references auth.users(id),
  published_at          timestamptz,
  removed_at            timestamptz,
  removed_reason        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (kind = 'result' or pair_group is not null),
  check (not is_featured or (state = 'approved' and featured_rank is not null and not minor_flag)),
  check (is_featured or featured_rank is null)
);
create unique index review_media_featured_slot on public.review_media (business_id, featured_rank) where is_featured;
create index on public.review_media (review_id);
create index on public.review_media (business_id, published_at desc) where state = 'approved';
create index on public.review_media (staff_id, published_at desc) where state = 'approved';
create index on public.review_media (canonical_service_id, area_id, published_at desc) where state = 'approved';
create trigger review_media_updated_at before update on public.review_media for each row execute function private.set_updated_at();

-- ≤ 4 live media per review; before/after only where the canonical service allows it
create function private.check_review_media() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.review_media
      where review_id = new.review_id and id <> new.id and state not in ('removed', 'rejected'))
     >= coalesce((private.trust_config() #>> '{media,max_per_review}')::int, 4) then
    perform private.raise_code('MEDIA_LIMIT');
  end if;
  if new.kind <> 'result' and not exists (select 1 from public.canonical_services c
                                          where c.id = new.canonical_service_id and c.allows_before_after) then
    perform private.raise_code('INVALID_INPUT', '{"field":"kind"}');
  end if;
  return new;
end $$;
create trigger review_media_check before insert on public.review_media for each row execute function private.check_review_media();

-- One row per worker job: makes the processor callback idempotent per job_id (Part 7 §46d)
create table private.media_jobs (
  job_id        uuid primary key default gen_random_uuid(),
  media_id      uuid not null references public.media_assets(id) on delete cascade,
  subject       public.moderation_subject not null,
  state         text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  result        jsonb,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index on private.media_jobs (media_id);

-- queues: transform (worker) → classify → publish (orchestrator), cleanup (storage deletions).
-- Separate from the text `moderation` queue (its claimer only understands text subjects).
select pgmq.create('media_transform');
select pgmq.create('media_classify');
select pgmq.create('media_publish');
select pgmq.create('media_cleanup');
grant select, insert, update, delete on pgmq.q_media_transform, pgmq.a_media_transform, pgmq.q_media_classify,
  pgmq.a_media_classify, pgmq.q_media_publish, pgmq.a_media_publish, pgmq.q_media_cleanup, pgmq.a_media_cleanup to app_owner;
grant usage, select on all sequences in schema pgmq to app_owner;

alter table public.review_media enable row level security;
alter table private.media_jobs  enable row level security;
revoke all on public.review_media from anon, authenticated;

-- ─── Storage: private-first buckets (Part 6) ───────────────────────────────
-- ugc-private: originals, clients may only INSERT at a path registered to them (no read/update/delete)
-- ugc-staging: processed derivatives awaiting a decision (moderators may view)
-- ugc-public:  published derivatives only, written by the service role
create function private.can_upload_private_media(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.media_assets
                 where private_bucket = 'ugc-private' and private_path = p_name
                   and uploader_user_id = private.uid() and status = 'uploaded')
$$;
grant execute on function private.can_upload_private_media(text) to authenticated;

do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; ugc buckets not created';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('ugc-private', 'ugc-private', false, 12582912, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
    ('ugc-staging', 'ugc-staging', false, 12582912, array['image/webp']),
    ('ugc-public',  'ugc-public',  true,  12582912, array['image/webp'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;
  drop policy if exists ugc_private_insert on storage.objects;
  drop policy if exists ugc_staging_moderator_read on storage.objects;
  create policy ugc_private_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'ugc-private' and private.can_upload_private_media(name));
  create policy ugc_staging_moderator_read on storage.objects for select to authenticated
    using (bucket_id = 'ugc-staging' and private.is_admin('{moderator,support}'));
end
$do$;

-- ─── Helpers ───────────────────────────────────────────────────────────────
create function private.media_cfg(p_key text) returns numeric
language sql stable security definer set search_path = '' as $$
  select (private.trust_config() #>> array['media', p_key])::numeric
$$;

create function private.enqueue_media_cleanup(p_bucket text, p_paths text[]) returns void
language sql volatile security definer set search_path = '' as $$
  select pgmq.send('media_cleanup', jsonb_build_object('bucket', p_bucket, 'paths', to_jsonb(p_paths)))
  where coalesce(array_length(p_paths, 1), 0) > 0
$$;

create function private.derivative_paths(p_derivatives jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(d ->> 'path'), '{}') from jsonb_array_elements(coalesce(p_derivatives, '[]')) d
$$;

create function private.enqueue_media_transform(p_media_id uuid, p_subject public.moderation_subject) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare m public.media_assets; v_job uuid;
begin
  select * into m from public.media_assets where id = p_media_id;
  insert into private.media_jobs (media_id, subject) values (m.id, p_subject) returning job_id into v_job;
  perform pgmq.send('media_transform', jsonb_build_object(
    'job_id', v_job, 'media_id', m.id, 'subject', p_subject,
    'source', jsonb_build_object('bucket', m.private_bucket, 'path', m.private_path),
    'outputs', jsonb_build_object('bucket', 'ugc-staging', 'prefix', m.id || '/'),
    'derivatives', '[{"name":"thumb","max":320},{"name":"card","max":800},{"name":"full","max":2048}]'::jsonb,
    'format', 'webp', 'quality', 80, 'strip_metadata', true,
    'min_side', coalesce(private.media_cfg('min_side'), 300)));
  return v_job;
end $$;

-- Pipeline/human hand-off: one open case per media, the file stays private
create function private.media_to_human(p_media_id uuid, p_subject public.moderation_subject, p_reasons text[],
                                       p_minor boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.media_assets; rm public.review_media;
begin
  select * into m from public.media_assets where id = p_media_id;
  if p_subject = 'review_media' then
    update public.media_assets set status = 'manual_review' where id = m.id;
    update public.review_media set state = 'manual_review', minor_flag = minor_flag or coalesce(p_minor, false)
     where media_asset_id = m.id returning * into rm;
  end if;
  insert into public.moderation_cases (subject_type, subject_id, business_id, author_user_id, source, reasons,
                                       auto_decision, priority, sla_due_at)
  values (p_subject, m.id, m.business_id, case when p_subject = 'review_media' then m.uploader_user_id end, 'pipeline',
          coalesce(p_reasons, '{}'), 'escalate', case when coalesce(p_minor, false) then 70 else 50 end,
          now() + make_interval(hours => coalesce((private.trust_config() #>> '{sla_hours,pipeline}')::int, 24)))
  on conflict (subject_type, subject_id) where state in ('open', 'claimed', 'escalated') do nothing;
end $$;

-- Result messages to the author (WhatsApp; M7 outbox)
create function private.notify_result(p_type public.notification_type, p_review_media_id uuid, p_reason text default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare rm public.review_media; r public.reviews;
begin
  select * into rm from public.review_media where id = p_review_media_id;
  select * into r from public.reviews where id = rm.review_id;
  perform private.notify_customer(p_type, r.booking_id,
    jsonb_build_object('result_id', rm.id, 'photo_reason_code', p_reason, 'review_id', r.id)
      || case when p_type = 'result_rejected' then private.review_link_payload(r.booking_id) else '{}' end,
    p_type || ':' || rm.id);
end $$;

-- Removal: hidden at once (featured cleared); public + staging copies deleted by the cleanup job;
-- the private original is kept for appeals, then purged (unless legal hold)
create function private.remove_review_media(p_review_media_id uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare rm public.review_media; m public.media_assets;
begin
  update public.review_media set state = 'removed', removed_at = now(), removed_reason = p_reason,
         is_featured = false, featured_rank = null, featured_at = null, featured_by = null
   where id = p_review_media_id and state <> 'removed'
  returning * into rm;
  if rm.id is null then return; end if;
  update public.media_assets set status = 'removed',
         purge_after = now() + make_interval(days => coalesce(private.media_cfg('retention_days'), 30)::int)
   where id = rm.media_asset_id returning * into m;
  if m.public_path is not null then
    perform private.enqueue_media_cleanup('ugc-public', private.derivative_paths(m.derivatives));
    update public.media_assets set public_path = null where id = m.id;
  else
    perform private.enqueue_media_cleanup('ugc-staging', private.derivative_paths(m.derivatives));
  end if;
  update public.moderation_cases set state = 'decided', decided_at = now(), note = coalesce(note, 'removed: ' || p_reason)
   where subject_type = 'review_media' and subject_id = m.id and state in ('open', 'claimed', 'escalated');
end $$;

-- ─── C16 upload (private-first, Part 4 §2.3) ───────────────────────────────
create function public.request_review_media_upload(p_review_id uuid, p_items jsonb default '[{"kind":"result"}]',
                                                   p_consent_version text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid(); r public.reviews; bi public.booking_items; v_area uuid; v_currency char(3);
  it jsonb; v_media uuid; v_rm uuid; v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null or coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) then perform private.raise_code('AUTH_REQUIRED'); end if;
  select * into r from public.reviews where id = p_review_id and author_user_id = v_uid;
  if r.id is null or r.status in ('deleted_by_author', 'removed') then perform private.raise_code('FORBIDDEN'); end if;
  if now() > r.visit_at + make_interval(days => coalesce(private.media_cfg('upload_window_days'), 30)::int) then
    perform private.raise_code('OUTSIDE_WINDOW');
  end if;
  if nullif(btrim(coalesce(p_consent_version, '')), '') is null then perform private.raise_code('CONSENT_REQUIRED'); end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 4 then
    perform private.raise_code('INVALID_INPUT', '{"field":"items"}');
  end if;
  select * into bi from public.booking_items where id = r.booking_item_id;
  select area_id into v_area from public.business_locations where id = r.location_id;
  select currency into v_currency from public.services where id = r.service_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_media := gen_random_uuid();
    insert into public.media_assets (id, uploader_user_id, business_id, purpose, private_bucket, private_path, status)
    values (v_media, v_uid, r.business_id, 'review_media', 'ugc-private', v_uid || '/' || v_media, 'uploaded');
    insert into public.review_media (review_id, media_asset_id, booking_item_id, kind, pair_group, consent_version, consented_at,
                                     business_id, location_id, area_id, staff_id, service_id, canonical_service_id,
                                     price_type, price_min, price_max, currency, visit_at, trust_tier)
    values (r.id, v_media, r.booking_item_id, coalesce(it ->> 'kind', 'result')::public.media_kind, (it ->> 'pair_group')::uuid,
            left(p_consent_version, 40), now(), r.business_id, r.location_id, v_area, r.staff_id, r.service_id, r.canonical_service_id,
            bi.price_type, bi.price_min, bi.price_max, coalesce(v_currency, 'USD'), r.visit_at, r.trust_tier)
    returning id into v_rm;
    v_out := v_out || jsonb_build_array(jsonb_build_object('media_id', v_media, 'review_media_id', v_rm,
                                                           'bucket', 'ugc-private', 'upload_path', v_uid || '/' || v_media));
  end loop;
  return v_out;
end $$;

-- After the upload: queue the transform (the sweeper does this for uploads never finalized)
create function public.finalize_media_upload(p_media_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare m public.media_assets;
begin
  select * into m from public.media_assets where id = p_media_id and uploader_user_id = private.uid() for update;
  if m.id is null then perform private.raise_code('FORBIDDEN'); end if;
  if m.status <> 'uploaded' then return m.status::text; end if;
  update public.media_assets set status = 'processing' where id = m.id;
  perform private.enqueue_media_transform(m.id, 'review_media');
  return 'processing';
end $$;

create function public.delete_my_media(p_review_media_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare rm public.review_media;
begin
  select rm2.* into rm from public.review_media rm2 join public.reviews r on r.id = rm2.review_id
   where rm2.id = p_review_media_id and r.author_user_id = private.uid();
  if rm.id is null then perform private.raise_code('FORBIDDEN'); end if;
  perform private.remove_review_media(rm.id, 'deleted_by_author');
end $$;

create function public.get_my_review_media(p_review_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', rm.id, 'media_id', m.id, 'state', rm.state, 'status', m.status, 'kind', rm.kind,
           'reason', m.rejected_reason, 'created_at', rm.created_at,
           'thumb', (select d ->> 'path' from jsonb_array_elements(m.derivatives) d where d ->> 'name' = 'thumb' and m.public_path is not null))
         order by rm.created_at), '[]')
  from public.review_media rm join public.media_assets m on m.id = rm.media_asset_id
  join public.reviews r on r.id = rm.review_id
  where rm.review_id = p_review_id and r.author_user_id = private.uid() and rm.state <> 'removed'
$$;

-- Deleting a review removes its photos too (Part 7 §49)
create or replace function public.delete_my_review(p_review_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r public.reviews; v_rm uuid;
begin
  update public.reviews set status = 'deleted_by_author', deleted_at = now()
   where id = p_review_id and author_user_id = private.uid() and status <> 'deleted_by_author'
  returning * into r;
  if r.id is null then perform private.raise_code('FORBIDDEN'); end if;
  update public.moderation_cases set state = 'decided', decided_at = now(), note = 'deleted by author'
   where subject_id = r.id and state in ('open', 'claimed', 'escalated');
  for v_rm in select id from public.review_media where review_id = r.id and state <> 'removed' loop
    perform private.remove_review_media(v_rm, 'review_deleted');
  end loop;
  perform private.recompute_rating_summary(r.business_id);
end $$;

-- ─── Worker contract (service_role; Part 4 §2.6) ───────────────────────────
-- Transform jobs for the ImageProcessor (edge or external). A job whose media left 'processing'
-- (deleted, decided) is dropped; a job failing 3 times goes to a human ('processing_error').
create function public.media_claim_transform(p_limit int default 10, p_vt int default 180) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare msg record; v_out jsonb := '[]'::jsonb; m public.media_assets; v_live boolean;
begin
  for msg in select * from pgmq.read('media_transform', greatest(coalesce(p_vt, 180), 60), least(greatest(coalesce(p_limit, 10), 1), 50)) loop
    select * into m from public.media_assets where id = (msg.message ->> 'media_id')::uuid;
    v_live := case msg.message ->> 'subject'
                when 'review_media' then m.status = 'processing'
                when 'business_media' then m.status = 'approved' and exists (select 1 from public.business_media b where b.media_asset_id = m.id and b.state = 'approved')
                else false end;
    if not coalesce(v_live, false) then
      perform pgmq.delete('media_transform', msg.msg_id);
      continue;
    end if;
    if msg.read_ct > coalesce(private.media_cfg('transform_retries'), 3) then
      perform private.media_to_human(m.id, (msg.message ->> 'subject')::public.moderation_subject, '{processing_error}');
      update private.media_jobs set state = 'failed', completed_at = now() where job_id = (msg.message ->> 'job_id')::uuid;
      perform pgmq.delete('media_transform', msg.msg_id);
      continue;
    end if;
    v_out := v_out || jsonb_build_array(msg.message || jsonb_build_object('msg_id', msg.msg_id, 'attempt', msg.read_ct));
  end loop;
  return v_out;
end $$;

-- Processor callback: identical for processor = 'edge' | 'external'; idempotent per job_id; refuses
-- media not in 'processing'; derivatives must sit in ugc-staging under the media prefix.
create function public.media_processing_complete(p_job_id uuid, p_result jsonb, p_msg_id bigint default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  j private.media_jobs; m public.media_assets; rm public.review_media; v_bad boolean; v_dup text;
  v_near int := coalesce(private.media_cfg('phash_near_dup'), 6)::int; v_phash bigint; v_run uuid := gen_random_uuid();
  d jsonb;
begin
  select * into j from private.media_jobs where job_id = p_job_id for update;
  if j.job_id is null then perform private.raise_code('NOT_FOUND'); end if;
  if j.state <> 'queued' then
    if p_msg_id is not null then perform pgmq.delete('media_transform', p_msg_id); end if;
    return 'duplicate';
  end if;
  select * into m from public.media_assets where id = j.media_id for update;
  if j.subject = 'review_media' and m.status <> 'processing' then perform private.raise_code('NOT_PROCESSING'); end if;
  if coalesce(p_result ->> 'processor', '') not in ('edge', 'external') and coalesce((p_result ->> 'ok')::boolean, false) then
    perform private.raise_code('INVALID_INPUT', '{"field":"processor"}');
  end if;

  if not coalesce((p_result ->> 'ok')::boolean, false) then
    if coalesce((p_result ->> 'retryable')::boolean, false) then return 'retry'; end if;  -- message reappears after vt
    update private.media_jobs set state = 'done', result = p_result, completed_at = now() where job_id = j.job_id;
    insert into private.moderation_results (subject_type, subject_id, run_id, stage, outcome, labels)
    values (j.subject, m.id, v_run, 'validation', 'fail', array[coalesce(p_result ->> 'error_code', 'DECODE_FAILED')]);
    if j.subject = 'review_media' then
      update public.media_assets set status = 'rejected', processed_at = now(),
             rejected_reason = case p_result ->> 'error_code' when 'TOO_SMALL' then 'too_small'
                                    when 'MISSING_OBJECT' then 'upload_incomplete' else 'unsupported_file' end,
             purge_after = now() + make_interval(days => coalesce(private.media_cfg('retention_days'), 30)::int)
       where id = m.id;
      update public.review_media set state = 'rejected' where media_asset_id = m.id returning * into rm;
      if p_result ->> 'error_code' <> 'MISSING_OBJECT' then
        perform private.notify_result('result_rejected', rm.id, (select rejected_reason from public.media_assets where id = m.id));
      end if;
    end if;
    if p_msg_id is not null then perform pgmq.delete('media_transform', p_msg_id); end if;
    return 'rejected';
  end if;

  -- derivatives: private staging only, never public before approval
  select bool_or(coalesce(d2 ->> 'path', '') not like m.id::text || '/%') into v_bad
  from jsonb_array_elements(coalesce(p_result -> 'derivatives', '[]')) d2;
  if coalesce(v_bad, true) or coalesce(p_result #>> '{outputs,bucket}', 'ugc-staging') <> 'ugc-staging' then
    perform private.raise_code('INVALID_INPUT', '{"field":"derivatives"}');
  end if;
  v_phash := ('x' || lpad(coalesce(p_result ->> 'phash', ''), 16, '0'))::bit(64)::bigint;
  update public.media_assets set
    width = (p_result #>> '{original,width}')::int, height = (p_result #>> '{original,height}')::int,
    bytes = (p_result #>> '{original,bytes}')::int, mime = coalesce(p_result #>> '{original,mime}', mime),
    sha256 = decode(p_result #>> '{original,sha256}', 'hex'), phash = v_phash, blurhash = p_result ->> 'blurhash',
    processor = p_result ->> 'processor', processor_version = p_result ->> 'processor_version',
    derivatives = p_result -> 'derivatives', processed_at = now()
   where id = m.id returning * into m;
  insert into private.moderation_results (subject_type, subject_id, run_id, stage, outcome, labels, model, model_version, latency_ms)
  values (j.subject, m.id, v_run, 'sanitize', 'pass', '{metadata_stripped}', p_result ->> 'processor', p_result ->> 'processor_version',
          (p_result ->> 'duration_ms')::int);
  update private.media_jobs set state = 'done', result = p_result - 'derivatives', completed_at = now() where job_id = j.job_id;

  -- hash stage (review media): exact or near duplicate of the business's portfolio or of another
  -- customer's result → "not your result"; the uploader's own duplicate → skipped quietly
  if j.subject = 'review_media' then
    select rm2.* into rm from public.review_media rm2 where rm2.media_asset_id = m.id;
    select case
      when exists (select 1 from public.business_media b join public.media_assets a on a.id = b.media_asset_id
                   where b.business_id = m.business_id and b.state = 'approved' and a.id <> m.id
                     and (a.sha256 = m.sha256 or (a.phash is not null and bit_count((a.phash # m.phash)::bit(64)) <= v_near)))
        then 'portfolio'
      when exists (select 1 from public.media_assets a join public.review_media x on x.media_asset_id = a.id
                   where a.id <> m.id and a.uploader_user_id is distinct from m.uploader_user_id
                     and x.canonical_service_id = rm.canonical_service_id
                     and a.created_at > now() - make_interval(days => coalesce(private.media_cfg('dup_lookback_days'), 180)::int)
                     and a.status in ('approved', 'processing', 'manual_review')
                     and (a.sha256 = m.sha256 or (a.phash is not null and bit_count((a.phash # m.phash)::bit(64)) <= v_near)))
        then 'other_user'
      when exists (select 1 from public.media_assets a
                   where a.id <> m.id and a.uploader_user_id = m.uploader_user_id and a.purpose = 'review_media'
                     and a.status in ('approved', 'processing', 'manual_review')
                     and (a.sha256 = m.sha256 or (a.phash is not null and bit_count((a.phash # m.phash)::bit(64)) <= v_near)))
        then 'own' end
      into v_dup;
    insert into private.moderation_results (subject_type, subject_id, run_id, stage, outcome, labels)
    values ('review_media', m.id, v_run, 'hash', case when v_dup is null then 'pass' else 'fail' end, coalesce(array[v_dup], '{}'));
    if v_dup is not null then
      update public.media_assets set status = 'rejected',
             rejected_reason = case when v_dup = 'own' then 'duplicate' else 'not_your_result' end,
             purge_after = now() + make_interval(days => coalesce(private.media_cfg('retention_days'), 30)::int)
       where id = m.id;
      update public.review_media set state = 'rejected' where id = rm.id;
      perform private.enqueue_media_cleanup('ugc-staging', private.derivative_paths(m.derivatives));
      if v_dup <> 'own' then perform private.notify_result('result_rejected', rm.id, 'not_your_result'); end if;
      if p_msg_id is not null then perform pgmq.delete('media_transform', p_msg_id); end if;
      return 'rejected';
    end if;
  end if;

  perform pgmq.send('media_classify', jsonb_build_object('media_id', m.id, 'subject', j.subject, 'run_id', v_run));
  if p_msg_id is not null then perform pgmq.delete('media_transform', p_msg_id); end if;
  return 'classify';
end $$;

-- Classify jobs for the orchestrator's ImageClassifier (safety, OCR, relevance with booking context)
create function public.media_claim_classify(p_limit int default 10, p_vt int default 120) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare msg record; v_out jsonb := '[]'::jsonb; m public.media_assets; rm public.review_media; v_ctx jsonb;
begin
  for msg in select * from pgmq.read('media_classify', greatest(coalesce(p_vt, 120), 30), least(greatest(coalesce(p_limit, 10), 1), 50)) loop
    select * into m from public.media_assets where id = (msg.message ->> 'media_id')::uuid;
    rm := null;
    if msg.message ->> 'subject' = 'review_media' then
      select * into rm from public.review_media where media_asset_id = m.id;
      if m.status <> 'processing' or rm.state <> 'pending' then perform pgmq.delete('media_classify', msg.msg_id); continue; end if;
      select jsonb_build_object('service', s.name, 'canonical', cs.name_en, 'hints', to_jsonb(cs.relevance_hints),
                                'business', z.name, 'category', (select c.name_en from public.categories c where c.id = z.primary_category_id))
        into v_ctx
      from public.services s join public.canonical_services cs on cs.id = rm.canonical_service_id
      join public.businesses z on z.id = rm.business_id where s.id = rm.service_id;
    else
      if m.status <> 'approved' then perform pgmq.delete('media_classify', msg.msg_id); continue; end if;
      select jsonb_build_object('business', z.name, 'category', (select c.name_en from public.categories c where c.id = z.primary_category_id),
                                'kind', b.kind)
        into v_ctx
      from public.business_media b join public.businesses z on z.id = b.business_id where b.media_asset_id = m.id;
    end if;
    if msg.read_ct > 3 then
      perform private.media_to_human(m.id, (msg.message ->> 'subject')::public.moderation_subject, '{classifier_error}');
      perform pgmq.delete('media_classify', msg.msg_id);
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'msg_id', msg.msg_id, 'media_id', m.id, 'subject', msg.message ->> 'subject', 'run_id', msg.message ->> 'run_id',
      'attempt', msg.read_ct,
      'image', jsonb_build_object('bucket', 'ugc-staging',
                                  'path', (select d ->> 'path' from jsonb_array_elements(m.derivatives) d where d ->> 'name' = 'card')),
      'context', coalesce(v_ctx, '{}'), 'config', coalesce(private.trust_config() -> 'media', '{}')));
  end loop;
  return v_out;
end $$;

-- Records the classifier's stages and applies the decision:
--   approve → publish job (derivatives copied to ugc-public, then media_publish_complete)
--   manual_review → moderation case (file stays private; minors flagged)
--   reject → rejected, author told the reason category, staging copies deleted
create function public.media_classification_record(p_msg_id bigint, p_media_id uuid, p_run_id uuid, p_decision text,
                                                   p_reasons text[] default '{}', p_stages jsonb default '[]',
                                                   p_minor boolean default false, p_reason_code text default null)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare m public.media_assets; rm public.review_media; bm public.business_media; s jsonb; v_subject public.moderation_subject;
begin
  if p_decision not in ('approve', 'manual_review', 'reject') then perform private.raise_code('INVALID_INPUT', '{"field":"decision"}'); end if;
  select * into m from public.media_assets where id = p_media_id for update;
  select * into rm from public.review_media where media_asset_id = p_media_id for update;
  v_subject := case when rm.id is not null then 'review_media' else 'business_media' end::public.moderation_subject;
  if (v_subject = 'review_media' and (m.status <> 'processing' or rm.state <> 'pending'))
     or (v_subject = 'business_media' and m.status <> 'approved') then
    perform pgmq.delete('media_classify', p_msg_id);
    return 'stale';
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_stages, '[]')) loop
    insert into private.moderation_results (subject_type, subject_id, run_id, stage, outcome, scores, labels, model, latency_ms)
    values (v_subject, m.id, p_run_id, (s ->> 'stage')::public.moderation_stage, s ->> 'outcome', coalesce(s -> 'scores', '{}'),
            coalesce((select array_agg(x) from jsonb_array_elements_text(s -> 'labels') x), '{}'), s ->> 'model', (s ->> 'latency_ms')::int);
  end loop;

  if v_subject = 'business_media' then
    -- business media is already public: only a clear violation removes it; grey zone → human
    if p_decision = 'reject' then
      update public.business_media set state = 'removed' where media_asset_id = m.id returning * into bm;
      update public.media_assets set status = 'removed', rejected_reason = p_reason_code where id = m.id;
      update public.staff_members set photo_media_id = null where photo_media_id = bm.id;
      perform private.enqueue_media_cleanup('business-media', array[m.private_path]);
    elsif p_decision = 'manual_review' then
      perform private.media_to_human(m.id, 'business_media', p_reasons);
    end if;
    perform private.enqueue_media_cleanup('ugc-staging', private.derivative_paths(m.derivatives));
    perform pgmq.delete('media_classify', p_msg_id);
    return p_decision;
  end if;

  if p_decision = 'approve' then
    update public.review_media set minor_flag = false where id = rm.id;
    perform pgmq.send('media_publish', jsonb_build_object('media_id', m.id, 'derivatives', m.derivatives));
  elsif p_decision = 'manual_review' then
    perform private.media_to_human(m.id, 'review_media', p_reasons, p_minor);
  else
    update public.media_assets set status = 'rejected', rejected_reason = coalesce(p_reason_code, 'not_relevant'),
           purge_after = now() + make_interval(days => coalesce(private.media_cfg('retention_days'), 30)::int)
     where id = m.id;
    update public.review_media set state = 'rejected' where id = rm.id;
    perform private.enqueue_media_cleanup('ugc-staging', private.derivative_paths(m.derivatives));
    perform private.notify_result('result_rejected', rm.id, coalesce(p_reason_code, 'not_relevant'));
  end if;
  perform pgmq.delete('media_classify', p_msg_id);
  return p_decision;
end $$;

-- Publish jobs: the orchestrator copies staging → ugc-public, then confirms here
create function public.media_claim_publish(p_limit int default 20, p_vt int default 120) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare msg record; v_out jsonb := '[]'::jsonb;
begin
  for msg in select * from pgmq.read('media_publish', greatest(coalesce(p_vt, 120), 30), least(greatest(coalesce(p_limit, 20), 1), 50)) loop
    v_out := v_out || jsonb_build_array(msg.message || jsonb_build_object('msg_id', msg.msg_id, 'attempt', msg.read_ct));
  end loop;
  return v_out;
end $$;

create function public.media_publish_complete(p_msg_id bigint, p_media_id uuid, p_public jsonb) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare m public.media_assets; rm public.review_media; v_bad boolean; v_staging text[];
begin
  select * into m from public.media_assets where id = p_media_id for update;
  select * into rm from public.review_media where media_asset_id = p_media_id for update;
  if rm.id is null or m.status not in ('processing', 'manual_review') or rm.state not in ('pending', 'manual_review') then
    perform pgmq.delete('media_publish', p_msg_id);
    return 'stale';   -- the orchestrator deletes the copies it just made
  end if;
  select bool_or(coalesce(d ->> 'path', '') not like m.id::text || '/%') into v_bad from jsonb_array_elements(coalesce(p_public, '[]')) d;
  if coalesce(v_bad, true) then perform private.raise_code('INVALID_INPUT', '{"field":"public"}'); end if;
  v_staging := private.derivative_paths(m.derivatives);
  update public.media_assets set status = 'approved', derivatives = p_public,
         public_path = (select d ->> 'path' from jsonb_array_elements(p_public) d where d ->> 'name' = 'card')
   where id = m.id;
  update public.review_media set state = 'approved', published_at = now() where id = rm.id;
  perform private.enqueue_media_cleanup('ugc-staging', v_staging);
  perform private.notify_result('result_published', rm.id);
  perform pgmq.delete('media_publish', p_msg_id);
  return 'published';
end $$;

create function public.media_claim_cleanup(p_limit int default 20, p_vt int default 120) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare msg record; v_out jsonb := '[]'::jsonb;
begin
  for msg in select * from pgmq.read('media_cleanup', greatest(coalesce(p_vt, 120), 30), least(greatest(coalesce(p_limit, 20), 1), 50)) loop
    if msg.read_ct > 5 then perform pgmq.archive('media_cleanup', msg.msg_id); continue; end if;
    v_out := v_out || jsonb_build_array(msg.message || jsonb_build_object('msg_id', msg.msg_id));
  end loop;
  return v_out;
end $$;

create function public.media_cleanup_done(p_msg_id bigint) returns void
language sql volatile security definer set search_path = '' as $$
  select pgmq.delete('media_cleanup', p_msg_id)
$$;

-- ─── Business media: async safety check (M5 deviation closed) ──────────────
-- Business uploads stay published immediately; every new one gets a transform (hash + card image)
-- and a safety classification that can remove it.
create function private.on_business_media_registered() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'approved' then perform private.enqueue_media_transform(new.media_asset_id, 'business_media'); end if;
  return null;
end $$;
create trigger business_media_safety_check after insert on public.business_media
  for each row execute function private.on_business_media_registered();

-- ─── Featuring (Part 4 §2.4) ───────────────────────────────────────────────
create function public.feature_result(p_review_media_id uuid, p_rank int) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare rm public.review_media; r public.reviews;
begin
  select * into rm from public.review_media where id = p_review_media_id for update;
  if rm.id is null or not private.has_business_role(rm.business_id, '{owner,manager}') then perform private.raise_code('FORBIDDEN'); end if;
  select * into r from public.reviews where id = rm.review_id;
  if rm.state <> 'approved' or rm.minor_flag or not private.rating_is_counted(r) then perform private.raise_code('NOT_FEATURABLE'); end if;
  if p_rank is null or p_rank not between 1 and 6 then perform private.raise_code('INVALID_INPUT', '{"field":"rank"}'); end if;
  -- the slot's current photo goes back to the organic feed
  update public.review_media set is_featured = false, featured_rank = null, featured_at = null, featured_by = null
   where business_id = rm.business_id and featured_rank = p_rank and id <> rm.id;
  update public.review_media set is_featured = true, featured_rank = p_rank, featured_at = now(), featured_by = private.uid()
   where id = rm.id;
end $$;

create function public.unfeature_result(p_review_media_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare rm public.review_media;
begin
  select * into rm from public.review_media where id = p_review_media_id;
  if rm.id is null or not private.has_business_role(rm.business_id, '{owner,manager}') then perform private.raise_code('FORBIDDEN'); end if;
  update public.review_media set is_featured = false, featured_rank = null, featured_at = null, featured_by = null where id = rm.id;
end $$;

-- ─── Public read models (C1 strip, C6 grid + detail) ───────────────────────
-- Visible = approved media of a counted review of a live/paused business. Paths are ugc-public only.
create function private.result_visible(rm public.review_media) returns boolean
language sql stable security definer set search_path = '' as $$
  select rm.state = 'approved'
     and exists (select 1 from public.reviews r where r.id = rm.review_id and private.rating_is_counted(r))
     and exists (select 1 from public.businesses z where z.id = rm.business_id and z.status in ('live', 'paused'))
     and exists (select 1 from public.media_assets m where m.id = rm.media_asset_id and m.status = 'approved' and m.public_path is not null)
$$;

create function private.result_card(rm public.review_media) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', rm.id, 'kind', rm.kind, 'is_featured', rm.is_featured, 'featured_rank', rm.featured_rank,
    'images', (select jsonb_object_agg(d ->> 'name', jsonb_build_object('path', d ->> 'path', 'width', (d ->> 'width')::int,
                                                                        'height', (d ->> 'height')::int))
               from jsonb_array_elements(m.derivatives) d),
    'blurhash', m.blurhash, 'width', m.width, 'height', m.height,
    'service', (select s.name from public.services s where s.id = rm.service_id), 'service_id', rm.service_id,
    'staff', (select case when st.publicly_bookable and st.status = 'active' then split_part(st.display_name, ' ', 1)
                          when st.status <> 'active' then 'a former team member' else 'a team member' end
              from public.staff_members st where st.id = rm.staff_id),
    'staff_id', (select case when st.publicly_bookable and st.status = 'active' then st.id end from public.staff_members st where st.id = rm.staff_id),
    'price_type', rm.price_type, 'price_min', rm.price_min, 'price_max', rm.price_max, 'currency', rm.currency,
    'visit_at', rm.visit_at, 'trust_tier', rm.trust_tier, 'published_at', rm.published_at)
  from public.media_assets m where m.id = rm.media_asset_id
$$;

-- Featured row (business-chosen, labeled) + organic feed (platform order: newest first, never business-controlled)
create function public.get_business_results(p_business_id uuid, p_service_id uuid default null, p_staff_id uuid default null,
                                            p_before timestamptz default null, p_limit int default 24)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'featured', case when p_before is null and p_service_id is null and p_staff_id is null then coalesce((
      select jsonb_agg(private.result_card(rm) order by rm.featured_rank)
      from public.review_media rm where rm.business_id = p_business_id and rm.is_featured and private.result_visible(rm)), '[]') else '[]' end,
    'items', coalesce((
      select jsonb_agg(private.result_card(x) order by x.published_at desc)
      from (select * from public.review_media rm
            where rm.business_id = p_business_id and private.result_visible(rm)
              and (p_service_id is null or rm.service_id = p_service_id)
              and (p_staff_id is null or rm.staff_id = p_staff_id)
              and (p_before is null or rm.published_at < p_before)
            order by rm.published_at desc limit least(greatest(coalesce(p_limit, 24), 1), 60)) x), '[]'),
    'total', (select count(*) from public.review_media rm where rm.business_id = p_business_id and private.result_visible(rm)))
$$;

create function public.get_result(p_review_media_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare rm public.review_media; r public.reviews; v_prev uuid; v_next uuid;
begin
  select * into rm from public.review_media where id = p_review_media_id;
  if rm.id is null or not private.result_visible(rm) then return jsonb_build_object('state', 'removed'); end if;
  select * into r from public.reviews where id = rm.review_id;
  select x.id into v_prev from public.review_media x where x.business_id = rm.business_id and private.result_visible(x)
   and x.published_at > rm.published_at order by x.published_at asc limit 1;
  select x.id into v_next from public.review_media x where x.business_id = rm.business_id and private.result_visible(x)
   and x.published_at < rm.published_at order by x.published_at desc limit 1;
  return private.result_card(rm) || jsonb_build_object(
    'state', 'ok',
    'business', (select jsonb_build_object('id', z.id, 'name', z.name, 'slug', z.slug,
                                           'rating', public.get_business_rating_summary(z.id),
                                           'area', (select a.name_en from public.areas a where a.id = rm.area_id))
                 from public.businesses z where z.id = rm.business_id),
    'review', private.public_review_card(r),
    'more', coalesce((select jsonb_agg(private.result_card(x) order by x.created_at) from public.review_media x
                      where x.review_id = rm.review_id and x.id <> rm.id and private.result_visible(x)), '[]'),
    'prev_id', v_prev, 'next_id', v_next);
end $$;

-- B10: the business's approved results with featuring state (owner/manager)
create function public.biz_get_results(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_business_role(p_business_id, '{owner,manager}') then perform private.raise_code('FORBIDDEN'); end if;
  return coalesce((select jsonb_agg(private.result_card(rm) || jsonb_build_object('minor_flag', rm.minor_flag)
                                    order by rm.is_featured desc, rm.featured_rank, rm.published_at desc)
                   from public.review_media rm where rm.business_id = p_business_id and private.result_visible(rm)), '[]');
end $$;

-- ─── Admin: media cases (A2/A3; images blurred in the UI by default) ───────
create function public.admin_get_media_case(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.moderation_cases; m public.media_assets; rm public.review_media;
begin
  if not private.is_admin('{moderator,support}') then perform private.raise_code('FORBIDDEN'); end if;
  select * into c from public.moderation_cases where id = p_case_id and subject_type in ('review_media', 'business_media');
  if c.id is null then perform private.raise_code('NOT_FOUND'); end if;
  select * into m from public.media_assets where id = c.subject_id;
  select * into rm from public.review_media where media_asset_id = m.id;
  return jsonb_build_object(
    'case', to_jsonb(c),
    'media', jsonb_build_object('id', m.id, 'status', m.status, 'width', m.width, 'height', m.height, 'mime', m.mime,
                                'processor', m.processor, 'rejected_reason', m.rejected_reason,
                                'image', case when m.public_path is not null then jsonb_build_object('bucket', 'ugc-public', 'path', m.public_path)
                                              when c.subject_type = 'business_media' then jsonb_build_object('bucket', 'business-media', 'path', m.private_path)
                                              else jsonb_build_object('bucket', 'ugc-staging', 'path',
                                                     (select d ->> 'path' from jsonb_array_elements(m.derivatives) d where d ->> 'name' = 'card')) end),
    'result', case when rm.id is null then null else jsonb_build_object('id', rm.id, 'state', rm.state, 'minor_flag', rm.minor_flag,
                'kind', rm.kind, 'review_id', rm.review_id) end,
    'context', jsonb_build_object(
      'business', (select z.name from public.businesses z where z.id = m.business_id),
      'service', (select s.name from public.services s where s.id = rm.service_id),
      'canonical', (select cs.name_en from public.canonical_services cs where cs.id = rm.canonical_service_id),
      'staff', (select st.display_name from public.staff_members st where st.id = rm.staff_id)),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', x.stage, 'outcome', x.outcome, 'scores', x.scores, 'labels', x.labels,
                                                            'model', x.model) order by x.id)
                        from private.moderation_results x where x.subject_id = m.id), '[]'),
    'report', (select jsonb_build_object('reason', rep.reason, 'details', rep.details, 'reporter_kind', rep.reporter_kind)
               from public.reports rep where rep.id = c.report_id));
end $$;

-- approve → published by the orchestrator (publish job); reject / remove_media → hidden, author told;
-- minor_flag may be kept on approval (then never featured)
create function public.admin_decide_media_case(p_case_id uuid, p_decision public.moderation_decision, p_reason_code text,
                                               p_note text default null, p_keep_minor_flag boolean default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c public.moderation_cases; m public.media_assets; rm public.review_media; v_role public.admin_role;
begin
  if not private.is_admin('{moderator,support}') then perform private.raise_code('FORBIDDEN'); end if;
  select role into v_role from public.admin_users where user_id = private.uid();
  select * into c from public.moderation_cases where id = p_case_id and subject_type in ('review_media', 'business_media') for update;
  if c.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if c.state = 'decided' or (c.state = 'claimed' and c.claimed_by <> private.uid() and c.claimed_at > now() - interval '15 minutes') then
    perform private.raise_code('CASE_TAKEN');
  end if;
  if nullif(btrim(coalesce(p_reason_code, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  if p_decision not in ('approve', 'reject', 'remove_media', 'escalate') then perform private.raise_code('INVALID_INPUT', '{"field":"decision"}'); end if;
  if p_decision = 'escalate' then
    update public.moderation_cases set state = 'escalated', note = p_note where id = c.id;
    return;
  end if;
  select * into m from public.media_assets where id = c.subject_id for update;
  select * into rm from public.review_media where media_asset_id = m.id for update;

  if c.subject_type = 'review_media' then
    if p_decision = 'approve' then
      if rm.state = 'approved' then
        null;                                                   -- report dismissed: stays published
      else
        update public.review_media set minor_flag = coalesce(p_keep_minor_flag, minor_flag) where id = rm.id;
        perform pgmq.send('media_publish', jsonb_build_object('media_id', m.id, 'derivatives', m.derivatives));
      end if;
    elsif rm.state = 'approved' then
      perform private.remove_review_media(rm.id, p_reason_code);
    else
      update public.media_assets set status = 'rejected', rejected_reason = p_reason_code,
             purge_after = now() + make_interval(days => coalesce(private.media_cfg('retention_days'), 30)::int)
       where id = m.id;
      update public.review_media set state = 'rejected' where id = rm.id;
      perform private.enqueue_media_cleanup('ugc-staging', private.derivative_paths(m.derivatives));
      perform private.notify_result('result_rejected', rm.id, p_reason_code);
    end if;
  elsif p_decision in ('reject', 'remove_media') then
    update public.business_media set state = 'removed' where media_asset_id = m.id;
    update public.media_assets set status = 'removed', rejected_reason = p_reason_code where id = m.id;
    update public.staff_members set photo_media_id = null where photo_media_id = (select id from public.business_media where media_asset_id = m.id);
    perform private.enqueue_media_cleanup('business-media', array[m.private_path]);
  end if;

  update public.moderation_cases set state = 'decided', decided_by = private.uid(), decided_at = now(), decision = p_decision,
         decision_reason_code = p_reason_code, note = p_note where id = c.id;
  update public.reports set status = case when p_decision = 'approve' then 'resolved_no_action' else 'resolved_action' end::public.report_status,
         resolved_by = private.uid(), resolved_at = now(), resolution_note = p_note
   where moderation_case_id = c.id and status in ('open', 'in_review');
  insert into audit.admin_actions (actor_user_id, actor_role, action, subject_type, subject_id, business_id, reason_code, note, before, after)
  values (private.uid(), v_role, 'moderation.decide_media', c.subject_type::text, m.id, m.business_id, p_reason_code, p_note,
          jsonb_build_object('status', m.status, 'state', rm.state),
          (select jsonb_build_object('status', x.status) from public.media_assets x where x.id = m.id));
end $$;

-- ─── Jobs: sweeper (uploads never finalized) and retention purge ───────────
create function private.job_media_sweep() returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  -- uploaded but never finalized (tab closed): the worker reports MISSING_OBJECT if nothing arrived
  for v in select id from public.media_assets where purpose = 'review_media' and status = 'uploaded'
            and created_at < now() - interval '30 minutes' limit 200 loop
    update public.media_assets set status = 'processing' where id = v;
    perform private.enqueue_media_transform(v, 'review_media');
  end loop;
  -- private originals after the appeal window (never under legal hold)
  for v in select id from public.media_assets where status in ('removed', 'rejected') and purge_after < now()
            and not legal_hold and purpose = 'review_media' limit 200 loop
    perform private.enqueue_media_cleanup('ugc-private', array[(select private_path from public.media_assets where id = v)]);
    update public.media_assets set status = 'deleted', purge_after = null where id = v;
  end loop;
end $$;
select cron.schedule('app_media_sweep', '*/10 * * * *', 'select private.job_media_sweep()');

-- Orchestrator (classify, publish, cleanup): pg_cron → media-orchestrator via Vault, like the other workers
select cron.schedule('app_media_orchestrate', '* * * * *', $job$
  select net.http_post(
           url := u.decrypted_secret, body := '{}'::jsonb,
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-media-secret', s.decrypted_secret),
           timeout_milliseconds := 55000)
  from vault.decrypted_secrets u, vault.decrypted_secrets s
  where u.name = 'media_orchestrator_url' and s.name = 'media_orchestrator_secret'
    and (exists (select 1 from pgmq.q_media_classify where vt <= now()) or exists (select 1 from pgmq.q_media_publish where vt <= now())
         or exists (select 1 from pgmq.q_media_cleanup where vt <= now()))
$job$);

-- ─── Grants ────────────────────────────────────────────────────────────────
revoke execute on function public.media_claim_transform(int, int), public.media_processing_complete(uuid, jsonb, bigint),
  public.media_claim_classify(int, int), public.media_classification_record(bigint, uuid, uuid, text, text[], jsonb, boolean, text),
  public.media_claim_publish(int, int), public.media_publish_complete(bigint, uuid, jsonb),
  public.media_claim_cleanup(int, int), public.media_cleanup_done(bigint) from public, anon, authenticated;
grant execute on function public.media_claim_transform(int, int), public.media_processing_complete(uuid, jsonb, bigint),
  public.media_claim_classify(int, int), public.media_classification_record(bigint, uuid, uuid, text, text[], jsonb, boolean, text),
  public.media_claim_publish(int, int), public.media_publish_complete(bigint, uuid, jsonb),
  public.media_claim_cleanup(int, int), public.media_cleanup_done(bigint) to service_role;
revoke execute on function public.request_review_media_upload(uuid, jsonb, text), public.finalize_media_upload(uuid),
  public.delete_my_media(uuid), public.get_my_review_media(uuid), public.feature_result(uuid, int), public.unfeature_result(uuid),
  public.biz_get_results(uuid), public.admin_get_media_case(uuid),
  public.admin_decide_media_case(uuid, public.moderation_decision, text, text, boolean) from public;
grant execute on function public.request_review_media_upload(uuid, jsonb, text), public.finalize_media_upload(uuid),
  public.delete_my_media(uuid), public.get_my_review_media(uuid), public.feature_result(uuid, int), public.unfeature_result(uuid),
  public.biz_get_results(uuid), public.admin_get_media_case(uuid),
  public.admin_decide_media_case(uuid, public.moderation_decision, text, text, boolean) to authenticated;
grant execute on function public.get_business_results(uuid, uuid, uuid, timestamptz, int), public.get_result(uuid) to anon, authenticated;

select private.assign_app_ownership();
