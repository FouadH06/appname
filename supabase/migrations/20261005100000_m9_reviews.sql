-- M9 · Verified reviews: reviews, dimensions, replies, translations, rating summary, eligibility,
--      submit/edit/delete with the synchronous fraud pre-check, reports, moderation cases, fraud
--      signals, public/business read models, admin decisions
-- Spec: Phase 3 Part 4 §1, §3–6; Part 7 §7; Phase 2 C15, B10, A2–A3.
-- Principles: verified-only, one review per booking, tier frozen at creation; rating, text and
-- each image moderated independently; businesses reply/report but never delete/hide/reorder.

-- ─── Config (versioned jsonb, cheap to tune) ───────────────────────────────
create table private.trust_config (
  version     int primary key,
  config      jsonb not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index on private.trust_config (is_active) where is_active;
insert into private.trust_config (version, config, is_active) values (1, '{
  "weights": {"verified_booking": 1.0, "verified_visit": 0.5},
  "fraud": {"investigation_threshold": 0.5},
  "text": {"llm_confidence_min": 0.70, "targeted_severity_min": 2, "min_length": 20, "max_length": 2000},
  "limits": {"reviews_per_day": 5, "business_open_reports": 10},
  "sla_hours": {"pipeline": 24, "report": 24, "fraud": 48}
}', true);

create function private.trust_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select config from private.trust_config where is_active
$$;

-- ─── Tables ────────────────────────────────────────────────────────────────
create table public.reviews (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null unique references public.bookings(id),
  booking_item_id       uuid not null references public.booking_items(id),
  business_id           uuid not null references public.businesses(id),
  location_id           uuid not null,
  staff_id              uuid not null,
  service_id            uuid not null,
  canonical_service_id  uuid not null references public.canonical_services(id),
  author_user_id        uuid not null references auth.users(id),
  trust_tier            public.trust_tier not null,
  visit_at              timestamptz not null,
  overall               smallint not null check (overall between 1 and 5),
  text_original         text check (char_length(text_original) between 20 and 2000),
  text_display          text,
  text_state            public.content_state,
  rating_state          public.rating_state not null default 'pending_check',
  fraud_checked_at      timestamptz,
  status                public.review_status not null default 'pending',
  base_weight           numeric(3,2) not null,
  fraud_multiplier      numeric(3,2) not null default 1.00 check (fraud_multiplier between 0 and 1),
  detected_langs        text[] not null default '{}',
  edit_count            smallint not null default 0 check (edit_count <= 1),
  editable_until        timestamptz not null,
  legal_hold            boolean not null default false,
  published_at          timestamptz,
  removed_at            timestamptz,
  removed_reason        text,
  deleted_at            timestamptz,
  idempotency_key       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (location_id, business_id) references public.business_locations (id, business_id),
  foreign key (staff_id, business_id)    references public.staff_members (id, business_id),
  foreign key (service_id, business_id)  references public.services (id, business_id),
  check ((text_original is null) = (text_state is null)),
  check (status <> 'deleted_by_author' or deleted_at is not null)
);
create index on public.reviews (business_id, published_at desc) where status = 'published';
create index on public.reviews (staff_id, published_at desc) where status = 'published';
create index on public.reviews (author_user_id, created_at desc);
create index on public.reviews (canonical_service_id) where status = 'published';
create trigger reviews_updated_at before update on public.reviews for each row execute function private.set_updated_at();

create function private.freeze_review_tier() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.trust_tier is distinct from old.trust_tier or new.booking_id is distinct from old.booking_id
     or new.author_user_id is distinct from old.author_user_id then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_FIELD';
  end if;
  return new;
end $$;
create trigger reviews_frozen before update on public.reviews for each row execute function private.freeze_review_tier();

create table public.review_ratings (
  review_id     uuid not null references public.reviews(id) on delete cascade,
  dimension_id  uuid not null references public.rating_dimensions(id),
  score         smallint not null check (score between 1 and 5),
  primary key (review_id, dimension_id)
);

create table private.review_text_private (
  review_id         uuid primary key references public.reviews(id) on delete cascade,
  text_normalized   text,
  pii_spans         jsonb not null default '[]',
  classifier        jsonb,
  device_hash       text,
  updated_at        timestamptz not null default now()
);

create table private.review_text_versions (
  review_id   uuid not null references public.reviews(id) on delete cascade,
  version     smallint not null,
  text        text,
  overall     smallint,
  created_at  timestamptz not null default now(),
  primary key (review_id, version)
);

create table public.review_replies (
  id               uuid primary key default gen_random_uuid(),
  review_id        uuid not null unique references public.reviews(id) on delete cascade,
  business_id      uuid not null references public.businesses(id),
  author_user_id   uuid not null references auth.users(id),
  text_original    text not null check (char_length(text_original) between 2 and 1500),
  text_display     text,
  text_state       public.content_state not null default 'pending',
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger review_replies_updated_at before update on public.review_replies for each row execute function private.set_updated_at();

create table public.content_translations (
  subject_type   text not null check (subject_type in ('review', 'reply')),
  subject_id     uuid not null,
  target_locale  public.app_locale not null,
  text           text not null,
  source_langs   text[] not null,
  model          text not null,
  created_at     timestamptz not null default now(),
  primary key (subject_type, subject_id, target_locale)
);

create table public.business_rating_summary (
  business_id        uuid primary key references public.businesses(id) on delete cascade,
  review_count       int not null default 0,
  rating_sum         int not null default 0,
  display_rating     numeric(2,1),
  dimensions         jsonb not null default '{}',
  last_review_at     timestamptz,
  updated_at         timestamptz not null default now()
);

create table private.moderation_results (
  id            bigint generated always as identity primary key,
  subject_type  public.moderation_subject not null,
  subject_id    uuid not null,
  run_id        uuid not null,
  stage         public.moderation_stage not null,
  outcome       text not null check (outcome in ('pass', 'flag', 'fail', 'error', 'skip')),
  scores        jsonb not null default '{}',
  labels        text[] not null default '{}',
  model         text,
  model_version text,
  latency_ms    int,
  created_at    timestamptz not null default now()
);
create index on private.moderation_results (subject_type, subject_id, created_at desc);

create table public.moderation_cases (
  id                   uuid primary key default gen_random_uuid(),
  subject_type         public.moderation_subject not null,
  subject_id           uuid not null,
  business_id          uuid references public.businesses(id),
  author_user_id       uuid references auth.users(id),
  source               text not null check (source in ('pipeline', 'report', 'appeal', 'fraud')),
  report_id            uuid,
  reasons              text[] not null default '{}',
  auto_decision        public.moderation_decision,
  auto_confidence      real,
  priority             int not null default 50,
  state                public.case_state not null default 'open',
  claimed_by           uuid references auth.users(id),
  claimed_at           timestamptz,
  decided_by           uuid references auth.users(id),
  decision             public.moderation_decision,
  decision_reason_code text,
  redaction            jsonb,
  user_action          text check (user_action in ('none', 'warn', 'suspend')),
  note                 text,
  sla_due_at           timestamptz not null,
  created_at           timestamptz not null default now(),
  decided_at           timestamptz
);
create unique index moderation_one_open_case on public.moderation_cases (subject_type, subject_id)
  where state in ('open', 'claimed', 'escalated');
create index on public.moderation_cases (state, priority desc, created_at) where state <> 'decided';

create table public.reports (
  id                   uuid primary key default gen_random_uuid(),
  reporter_user_id     uuid not null references auth.users(id),
  reporter_kind        text not null check (reporter_kind in ('business', 'customer')),
  reporter_business_id uuid references public.businesses(id),
  subject_type         public.report_subject not null,
  subject_id           uuid not null,
  subject_business_id  uuid references public.businesses(id),
  reason               public.report_reason not null,
  parts                text[] not null default '{}',
  details              text check (char_length(details) <= 1000),
  status               public.report_status not null default 'open',
  moderation_case_id   uuid references public.moderation_cases(id),
  dispute_id           uuid references public.disputes(id),
  resolution_note      text,
  resolved_by          uuid references auth.users(id),
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  check ((reporter_kind = 'business') = (reporter_business_id is not null))
);
create unique index reports_one_open_per_reporter on public.reports (reporter_user_id, subject_type, subject_id)
  where status in ('open', 'in_review');
create index on public.reports (status, created_at);
create index on public.reports (reporter_business_id, status);

create table private.fraud_signals (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('review', 'user', 'business')),
  subject_id    uuid not null,
  signal        public.fraud_signal_type not null,
  score         real not null check (score between 0 and 1),
  evidence      jsonb not null default '{}',
  status        text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  reviewed_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
create index on private.fraud_signals (subject_type, subject_id);
create index on private.fraud_signals (status, score desc);

-- links deferred from earlier milestones
alter table public.disputes add foreign key (review_id) references public.reviews(id);
alter table public.notifications add foreign key (review_id) references public.reviews(id) on delete set null;

-- queues (pgmq): text moderation and translations
select pgmq.create('moderation');
select pgmq.create('translate');
-- the definer functions (owned by app_owner) use these two queues only
grant usage on schema pgmq to app_owner;
grant execute on all functions in schema pgmq to app_owner;
grant select, insert, update, delete on pgmq.q_moderation, pgmq.a_moderation, pgmq.q_translate, pgmq.a_translate to app_owner;
grant usage, select on all sequences in schema pgmq to app_owner;

-- RLS: nothing is read directly; every read goes through the curated RPCs below
alter table public.reviews                 enable row level security;
alter table public.review_ratings          enable row level security;
alter table public.review_replies          enable row level security;
alter table public.content_translations    enable row level security;
alter table public.business_rating_summary enable row level security;
alter table public.moderation_cases        enable row level security;
alter table public.reports                 enable row level security;
revoke all on public.reviews, public.review_ratings, public.review_replies, public.content_translations,
  public.business_rating_summary, public.moderation_cases, public.reports from anon, authenticated;

-- ─── The one predicate (Part 4 §1.1; Part 7 §46c) ─────────────────────────
create function private.rating_is_counted(r public.reviews) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.status = 'published' and r.rating_state = 'active' and r.fraud_multiplier > 0
$$;

create function private.recompute_rating_summary(p_business_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_rating_summary (business_id, review_count, rating_sum, display_rating, dimensions, last_review_at, updated_at)
  select p_business_id, count(*)::int, coalesce(sum(r.overall), 0)::int,
         case when count(*) > 0 then round(avg(r.overall)::numeric, 1) end,
         coalesce((select jsonb_object_agg(d.key, jsonb_build_object('count', x.n, 'sum', x.s))
                   from (select rr.dimension_id, count(*)::int as n, sum(rr.score)::int as s
                         from public.review_ratings rr join public.reviews r2 on r2.id = rr.review_id
                         where r2.business_id = p_business_id and private.rating_is_counted(r2)
                         group by rr.dimension_id) x
                   join public.rating_dimensions d on d.id = x.dimension_id), '{}'),
         max(r.published_at), now()
  from public.reviews r
  where r.business_id = p_business_id and private.rating_is_counted(r)
  on conflict (business_id) do update set
    review_count = excluded.review_count, rating_sum = excluded.rating_sum, display_rating = excluded.display_rating,
    dimensions = excluded.dimensions, last_review_at = excluded.last_review_at, updated_at = now();

  update public.staff_stats ss set
    verified_review_count = coalesce(x.n, 0), rating_sum = coalesce(x.s, 0),
    rating_display = case when coalesce(x.n, 0) > 0 then round(x.s::numeric / x.n, 1) end
  from (select st.id as staff_id, count(r.id)::int as n, sum(r.overall)::int as s
        from public.staff_members st
        left join public.reviews r on r.staff_id = st.id and private.rating_is_counted(r)
        where st.business_id = p_business_id group by st.id) x
  where ss.staff_id = x.staff_id;
end $$;

-- ─── Eligibility (Part 4 §1.2) ────────────────────────────────────────────
create function private.review_eligibility(p_booking_id uuid, p_user_id uuid,
                                           out eligible boolean, out tier public.trust_tier, out reason text)
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; v_phone text;
begin
  eligible := false;
  select * into b from public.bookings where id = p_booking_id;
  if b.id is null or b.customer_user_id is distinct from p_user_id then reason := 'NOT_ELIGIBLE'; return; end if;
  if exists (select 1 from public.reviews where booking_id = p_booking_id) then reason := 'ALREADY_REVIEWED'; return; end if;
  if b.status = 'completed' then
    if now() > coalesce(b.review_eligible_until, b.completed_at + interval '30 days') then reason := 'REVIEW_WINDOW_CLOSED'; return; end if;
  elsif b.status = 'no_show' and b.no_show_disputed
        and exists (select 1 from public.disputes d where d.booking_id = b.id and d.type = 'no_show' and d.status in ('open', 'awaiting_info')) then
    if now() > b.no_show_at + interval '30 days' then reason := 'REVIEW_WINDOW_CLOSED'; return; end if;
  else
    reason := 'NOT_ELIGIBLE'; return;
  end if;
  select phone_e164 into v_phone from public.profiles where id = p_user_id;
  if exists (select 1 from public.business_members m where m.business_id = b.business_id and m.user_id = p_user_id)
     or exists (select 1 from public.staff_members s where s.business_id = b.business_id and s.user_id = p_user_id)
     or (v_phone is not null and exists (select 1 from public.business_members m join public.profiles p on p.id = m.user_id
                                         where m.business_id = b.business_id and p.phone_e164 = v_phone)) then
    reason := 'NOT_ELIGIBLE'; return;
  end if;
  tier := (case when b.source in ('manual', 'walk_in') then 'verified_visit' else 'verified_booking' end)::public.trust_tier;
  eligible := true;
end $$;

-- ─── Fraud (Part 4 §6) ────────────────────────────────────────────────────
create function private.quarantine_review(p_review_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reviews; v_cfg jsonb := private.trust_config();
begin
  update public.reviews set rating_state = 'quarantined', fraud_multiplier = 0,
         status = case when status = 'published' then 'pending'::public.review_status else status end
   where id = p_review_id and rating_state in ('pending_check', 'active')
  returning * into r;
  if r.id is null then return; end if;
  insert into public.moderation_cases (subject_type, subject_id, business_id, author_user_id, source, reasons, priority, sla_due_at)
  values ('review_text', r.id, r.business_id, r.author_user_id, 'fraud', array['fraud', p_reason], 70,
          now() + make_interval(hours => coalesce((v_cfg #>> '{sla_hours,fraud}')::int, 48)))
  on conflict (subject_type, subject_id) where state in ('open', 'claimed', 'escalated')
  do update set source = 'fraud', reasons = array(select distinct unnest(public.moderation_cases.reasons || excluded.reasons)),
                priority = greatest(public.moderation_cases.priority, 70);
  perform private.recompute_rating_summary(r.business_id);
end $$;

-- Fast detectors, in the same transaction as the submit (§1.1): member/staff match is already an
-- eligibility block; new account + first booking here; device shared with other reviewers here.
create function private.fraud_precheck(p_review_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reviews; v_threshold real; v_created timestamptz; v_device text; v_others int; v_max real := 0;
begin
  select * into r from public.reviews where id = p_review_id;
  v_threshold := coalesce((private.trust_config() #>> '{fraud,investigation_threshold}')::real, 0.5);
  select created_at into v_created from public.profiles where id = r.author_user_id;   -- = account creation (sync trigger)
  if v_created > now() - interval '7 days'
     and not exists (select 1 from public.bookings b where b.business_id = r.business_id and b.customer_user_id = r.author_user_id
                     and b.id <> r.booking_id and b.status = 'completed') then
    insert into private.fraud_signals (subject_type, subject_id, signal, score, evidence)
    values ('review', r.id, 'new_account_review', 0.3, jsonb_build_object('account_age_days', extract(day from now() - v_created)));
    v_max := greatest(v_max, 0.3);
  end if;
  select device_hash into v_device from private.review_text_private where review_id = r.id;
  if v_device is not null then
    select count(distinct r2.author_user_id) into v_others
    from public.reviews r2 join private.review_text_private p on p.review_id = r2.id
    where r2.business_id = r.business_id and r2.author_user_id <> r.author_user_id and p.device_hash = v_device;
    if v_others >= 1 then
      insert into private.fraud_signals (subject_type, subject_id, signal, score, evidence)
      values ('review', r.id, 'device_cluster', least(0.9, 0.5 + 0.1 * v_others), jsonb_build_object('other_authors', v_others));
      v_max := greatest(v_max, least(0.9, 0.5 + 0.1 * v_others));
    end if;
  end if;

  if v_max >= v_threshold then
    update public.reviews set fraud_checked_at = now() where id = r.id;
    perform private.quarantine_review(r.id, 'precheck');
  else
    update public.reviews set rating_state = 'active', status = 'published', published_at = now(), fraud_checked_at = now()
     where id = r.id;
    perform private.recompute_rating_summary(r.business_id);
    perform private.notify_business('biz_new_review', r.booking_id);
  end if;
end $$;

-- ─── Review RPCs (Part 4 §1.3) ────────────────────────────────────────────
create function private.enqueue_text_moderation(p_subject public.moderation_subject, p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  select pgmq.send('moderation', jsonb_build_object('subject', p_subject, 'id', p_id, 'run_id', gen_random_uuid()))
$$;

create function private.save_ratings(p_review_id uuid, p_ratings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_cat uuid; k text; v int;
begin
  select coalesce(c.parent_id, c.id) into v_cat
  from public.reviews r join public.businesses b on b.id = r.business_id join public.categories c on c.id = b.primary_category_id
  where r.id = p_review_id;
  delete from public.review_ratings where review_id = p_review_id;
  for k, v in select key, value::int from jsonb_each_text(coalesce(p_ratings, '{}')) loop
    if v not between 1 and 5 then perform private.raise_code('INVALID_INPUT', '{"field":"ratings"}'); end if;
    insert into public.review_ratings (review_id, dimension_id, score)
    select p_review_id, d.id, v from public.rating_dimensions d where d.category_id = v_cat and d.key = k and d.is_active;
    if not found then perform private.raise_code('INVALID_INPUT', jsonb_build_object('field', 'ratings', 'key', k)); end if;
  end loop;
end $$;

create function public.submit_review(p_booking_id uuid, p_overall int, p_ratings jsonb default '{}',
                                     p_text text default null, p_device_hash text default null,
                                     p_idempotency_key text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid(); e record; b public.bookings; bi public.booking_items; v_cfg jsonb := private.trust_config();
  v_text text := nullif(btrim(coalesce(p_text, '')), ''); v_id uuid; r public.reviews;
begin
  if v_uid is null or coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) then perform private.raise_code('AUTH_REQUIRED'); end if;
  -- idempotent retry of the same submit
  select * into r from public.reviews where booking_id = p_booking_id and author_user_id = v_uid
     and p_idempotency_key is not null and idempotency_key = p_idempotency_key;
  if r.id is not null then
    return jsonb_build_object('review_id', r.id, 'status', r.status, 'rating_state', r.rating_state, 'text_state', r.text_state);
  end if;
  select * into e from private.review_eligibility(p_booking_id, v_uid);
  if not e.eligible then perform private.raise_code(e.reason); end if;
  if p_overall is null or p_overall not between 1 and 5 then perform private.raise_code('INVALID_INPUT', '{"field":"overall"}'); end if;
  if v_text is not null and char_length(v_text) not between coalesce((v_cfg #>> '{text,min_length}')::int, 20)
                                                        and coalesce((v_cfg #>> '{text,max_length}')::int, 2000) then
    perform private.raise_code('TEXT_LENGTH');
  end if;
  if (select count(*) from public.reviews where author_user_id = v_uid and created_at > now() - interval '1 day')
     >= coalesce((v_cfg #>> '{limits,reviews_per_day}')::int, 5) then
    perform private.raise_code('RATE_LIMITED');
  end if;
  select * into b from public.bookings where id = p_booking_id;
  select * into bi from public.booking_items where booking_id = p_booking_id order by position limit 1;

  insert into public.reviews (booking_id, booking_item_id, business_id, location_id, staff_id, service_id, canonical_service_id,
                              author_user_id, trust_tier, visit_at, overall, text_original, text_state, base_weight,
                              editable_until, idempotency_key)
  values (b.id, bi.id, b.business_id, b.location_id, bi.staff_id, bi.service_id, bi.canonical_service_id,
          v_uid, e.tier, b.starts_at, p_overall, v_text, case when v_text is not null then 'pending'::public.content_state end,
          coalesce((v_cfg #>> array['weights', e.tier::text])::numeric, case when e.tier = 'verified_booking' then 1.0 else 0.5 end),
          now() + interval '7 days', left(p_idempotency_key, 64))
  returning id into v_id;
  perform private.save_ratings(v_id, p_ratings);
  insert into private.review_text_private (review_id, device_hash) values (v_id, left(p_device_hash, 128));
  insert into private.review_text_versions (review_id, version, text, overall) values (v_id, 1, v_text, p_overall);
  if v_text is not null then perform private.enqueue_text_moderation('review_text', v_id); end if;

  perform private.fraud_precheck(v_id);                         -- publishes or quarantines the rating now
  select * into r from public.reviews where id = v_id;
  return jsonb_build_object('review_id', r.id, 'status', r.status, 'rating_state', r.rating_state, 'text_state', r.text_state,
                            'trust_tier', r.trust_tier);
end $$;

create function public.edit_my_review(p_review_id uuid, p_overall int, p_ratings jsonb default '{}', p_text text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r public.reviews; v_text text := nullif(btrim(coalesce(p_text, '')), ''); v_cfg jsonb := private.trust_config();
begin
  select * into r from public.reviews where id = p_review_id and author_user_id = private.uid() for update;
  if r.id is null then perform private.raise_code('FORBIDDEN'); end if;
  if r.edit_count >= 1 or now() > r.editable_until or r.status in ('removed', 'deleted_by_author') then
    perform private.raise_code('OUTSIDE_WINDOW');
  end if;
  if p_overall is null or p_overall not between 1 and 5 then perform private.raise_code('INVALID_INPUT', '{"field":"overall"}'); end if;
  if v_text is not null and char_length(v_text) not between coalesce((v_cfg #>> '{text,min_length}')::int, 20)
                                                        and coalesce((v_cfg #>> '{text,max_length}')::int, 2000) then
    perform private.raise_code('TEXT_LENGTH');
  end if;
  insert into private.review_text_versions (review_id, version, text, overall) values (r.id, 2, v_text, p_overall);
  update public.reviews set overall = p_overall, edit_count = 1,
         text_original = v_text, text_display = null,
         text_state = case when v_text is null then null
                           when v_text is distinct from r.text_original then 'pending'::public.content_state
                           else text_state end
   where id = r.id returning * into r;
  perform private.save_ratings(r.id, p_ratings);
  if v_text is not null and r.text_state = 'pending' then perform private.enqueue_text_moderation('review_text', r.id); end if;
  perform private.recompute_rating_summary(r.business_id);
  return jsonb_build_object('review_id', r.id, 'status', r.status, 'rating_state', r.rating_state, 'text_state', r.text_state);
end $$;

create function public.delete_my_review(p_review_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r public.reviews;
begin
  update public.reviews set status = 'deleted_by_author', deleted_at = now()
   where id = p_review_id and author_user_id = private.uid() and status <> 'deleted_by_author'
  returning * into r;
  if r.id is null then perform private.raise_code('FORBIDDEN'); end if;
  update public.moderation_cases set state = 'decided', decided_at = now(), note = 'deleted by author'
   where subject_id = r.id and state in ('open', 'claimed', 'escalated');
  perform private.recompute_rating_summary(r.business_id);
end $$;

-- ─── Read models ──────────────────────────────────────────────────────────
-- A review as the public sees it (only when the rating is counted; text/reply only when approved)
create function private.public_review_card(r public.reviews) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'overall', r.overall, 'trust_tier', r.trust_tier, 'visit_at', r.visit_at, 'published_at', r.published_at,
    'author', (select coalesce(nullif(btrim(p.first_name), ''), 'Customer')
                      || coalesce(' ' || left(nullif(btrim(p.last_name), ''), 1) || '.', '')
               from public.profiles p where p.id = r.author_user_id),
    'service', (select s.name from public.services s where s.id = r.service_id),
    'staff', (select case when st.publicly_bookable and st.status = 'active' then split_part(st.display_name, ' ', 1) else 'a team member' end
              from public.staff_members st where st.id = r.staff_id),
    'staff_id', (select case when st.publicly_bookable and st.status = 'active' then st.id end from public.staff_members st where st.id = r.staff_id),
    'text', case when r.text_state in ('approved', 'approved_redacted') then coalesce(r.text_display, r.text_original) end,
    'langs', r.detected_langs,
    'ratings', (select coalesce(jsonb_object_agg(d.key, rr.score), '{}') from public.review_ratings rr
                join public.rating_dimensions d on d.id = rr.dimension_id where rr.review_id = r.id),
    'reply', (select jsonb_build_object('text', coalesce(rp.text_display, rp.text_original), 'published_at', rp.published_at)
              from public.review_replies rp
              where rp.review_id = r.id and rp.text_state in ('approved', 'approved_redacted')
                and coalesce(r.text_state, 'approved') not in ('removed')))
$$;

create function public.get_business_rating_summary(p_business_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'review_count', coalesce(s.review_count, 0),
    'display_rating', case when coalesce(s.review_count, 0) >= 5 then s.display_rating end,
    'dimensions', case when coalesce(s.review_count, 0) >= 5 then (
      select coalesce(jsonb_object_agg(d.key, jsonb_build_object('label_en', d.label_en, 'label_ar', d.label_ar,
               'average', round((s.dimensions -> d.key ->> 'sum')::numeric / nullif((s.dimensions -> d.key ->> 'count')::numeric, 0), 1))), '{}')
      from public.rating_dimensions d where s.dimensions ? d.key) end)
  from (select 1) one left join public.business_rating_summary s on s.business_id = p_business_id
$$;

create function public.get_business_reviews(p_business_id uuid, p_before timestamptz default null, p_limit int default 10)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.public_review_card(r) order by r.published_at desc), '[]')
  from (select * from public.reviews r
        where r.business_id = p_business_id and private.rating_is_counted(r)
          and (p_before is null or r.published_at < p_before)
          and exists (select 1 from public.businesses b where b.id = r.business_id and b.status in ('live', 'paused'))
        order by r.published_at desc limit least(greatest(coalesce(p_limit, 10), 1), 50)) r
$$;

-- C15 form context: the booking, eligibility, tier preview, dimensions, and an existing review
create function public.get_review_context(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.uid(); b public.bookings; e record; r public.reviews; v_cat uuid;
begin
  select * into b from public.bookings where id = p_booking_id and customer_user_id = v_uid;
  if b.id is null then perform private.raise_code('FORBIDDEN'); end if;
  select * into e from private.review_eligibility(p_booking_id, v_uid);
  select * into r from public.reviews where booking_id = p_booking_id and author_user_id = v_uid;
  select coalesce(c.parent_id, c.id) into v_cat from public.businesses z join public.categories c on c.id = z.primary_category_id where z.id = b.business_id;
  return jsonb_build_object(
    'booking_id', b.id, 'eligible', e.eligible, 'reason', e.reason,
    'trust_tier', coalesce(r.trust_tier, e.tier), 'visit_at', b.starts_at,
    'business', (select jsonb_build_object('name', z.name, 'slug', z.slug) from public.businesses z where z.id = b.business_id),
    'service', (select s.name from public.booking_items bi join public.services s on s.id = bi.service_id where bi.booking_id = b.id limit 1),
    'staff_first_name', (select split_part(st.display_name, ' ', 1) from public.booking_items bi join public.staff_members st on st.id = bi.staff_id
                         where bi.booking_id = b.id limit 1),
    'dimensions', (select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'label_en', d.label_en, 'label_ar', d.label_ar) order by d.sort), '[]')
                   from public.rating_dimensions d where d.category_id = v_cat and d.is_active),
    'review', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'overall', r.overall, 'text', r.text_original, 'status', r.status, 'rating_state', r.rating_state,
      'text_state', r.text_state, 'can_edit', r.edit_count = 0 and now() <= r.editable_until and r.status not in ('removed', 'deleted_by_author'),
      'ratings', (select coalesce(jsonb_object_agg(d.key, rr.score), '{}') from public.review_ratings rr
                  join public.rating_dimensions d on d.id = rr.dimension_id where rr.review_id = r.id)) end);
end $$;

-- B10 business reviews: the same public content plus reply state and report status. No reviewer
-- phone, no link to the CRM record (anti-retaliation).
create function public.biz_get_reviews(p_business_id uuid, p_tab text default 'all') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_business_role(p_business_id, '{owner,manager}') then perform private.raise_code('FORBIDDEN'); end if;
  return jsonb_build_object(
    'summary', public.get_business_rating_summary(p_business_id) || jsonb_build_object(
      'response_rate', (select round(100.0 * count(rp.id) / nullif(count(r.id), 0)) from public.reviews r
                        left join public.review_replies rp on rp.review_id = r.id
                        where r.business_id = p_business_id and private.rating_is_counted(r)),
      'needs_reply', (select count(*) from public.reviews r where r.business_id = p_business_id and private.rating_is_counted(r)
                      and not exists (select 1 from public.review_replies rp where rp.review_id = r.id))),
    'reviews', coalesce((
      select jsonb_agg(private.public_review_card(r) || jsonb_build_object(
               'my_reply', (select jsonb_build_object('text', rp.text_original, 'state', rp.text_state) from public.review_replies rp where rp.review_id = r.id),
               'report', (select jsonb_build_object('status', rep.status, 'reason', rep.reason, 'resolution_note', rep.resolution_note)
                          from public.reports rep where rep.subject_type = 'review' and rep.subject_id = r.id
                            and rep.reporter_business_id = p_business_id order by rep.created_at desc limit 1))
             order by r.published_at desc)
      from public.reviews r
      where r.business_id = p_business_id and private.rating_is_counted(r)
        and case p_tab
              when 'needs_reply' then not exists (select 1 from public.review_replies rp where rp.review_id = r.id)
              when 'reported' then exists (select 1 from public.reports rep where rep.subject_type = 'review' and rep.subject_id = r.id
                                           and rep.reporter_business_id = p_business_id)
              else true end), '[]'));
end $$;

create function public.get_my_reviews() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'booking_id', r.booking_id, 'overall', r.overall, 'status', r.status,
           'rating_state', r.rating_state, 'text_state', r.text_state, 'created_at', r.created_at,
           'business', (select z.name from public.businesses z where z.id = r.business_id)) order by r.created_at desc), '[]')
  from public.reviews r where r.author_user_id = private.uid() and r.status <> 'deleted_by_author'
$$;

-- ─── Replies (moderated with the same text pipeline) ─────────────────────
create function public.reply_to_review(p_review_id uuid, p_text text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare r public.reviews; v_id uuid; v_text text := btrim(coalesce(p_text, ''));
begin
  select * into r from public.reviews where id = p_review_id;
  if r.id is null or not private.has_business_role(r.business_id, '{owner,manager}') then perform private.raise_code('FORBIDDEN'); end if;
  if not private.rating_is_counted(r) then perform private.raise_code('NOT_FOUND'); end if;
  if char_length(v_text) not between 2 and 1500 then perform private.raise_code('TEXT_LENGTH'); end if;
  insert into public.review_replies (review_id, business_id, author_user_id, text_original)
  values (r.id, r.business_id, private.uid(), v_text)
  on conflict (review_id) do update set text_original = excluded.text_original, text_display = null,
    text_state = 'pending', published_at = null, author_user_id = excluded.author_user_id
  returning id into v_id;
  perform private.enqueue_text_moderation('reply_text', v_id);
  return v_id;
end $$;

create function public.delete_reply(p_review_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare rp public.review_replies;
begin
  select * into rp from public.review_replies where review_id = p_review_id;
  if rp.id is null or not private.has_business_role(rp.business_id, '{owner,manager}') then perform private.raise_code('FORBIDDEN'); end if;
  delete from public.review_replies where id = rp.id;
end $$;

-- ─── Reports (Part 4 §4) ──────────────────────────────────────────────────
create function public.report_content(p_subject_type public.report_subject, p_subject_id uuid, p_reason public.report_reason,
                                      p_parts text[] default '{whole}', p_details text default null,
                                      p_as_business_id uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid(); v_cfg jsonb := private.trust_config(); r public.reviews; v_biz uuid; v_id uuid;
  v_case uuid; v_dispute uuid; v_subject public.moderation_subject;
begin
  if v_uid is null or coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) then perform private.raise_code('AUTH_REQUIRED'); end if;
  if p_subject_type = 'review' then
    select * into r from public.reviews where id = p_subject_id;
    if r.id is null then perform private.raise_code('NOT_FOUND'); end if;
    v_biz := r.business_id;
  elsif p_subject_type = 'review_reply' then
    select business_id into v_biz from public.review_replies where id = p_subject_id;
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
    v_subject := case p_subject_type when 'review_reply' then 'reply_text' else 'review_text' end::public.moderation_subject;
    insert into public.moderation_cases (subject_type, subject_id, business_id, author_user_id, source, report_id, reasons, priority, sla_due_at)
    values (v_subject, p_subject_id, v_biz, case when p_subject_type = 'review' then r.author_user_id end, 'report', v_id,
            array[p_reason::text], 70, now() + make_interval(hours => coalesce((v_cfg #>> '{sla_hours,report}')::int, 24)))
    on conflict (subject_type, subject_id) where state in ('open', 'claimed', 'escalated')
    do update set priority = public.moderation_cases.priority + 20,
                  reasons = array(select distinct unnest(public.moderation_cases.reasons || excluded.reasons))
    returning id into v_case;
    update public.reports set moderation_case_id = v_case, status = 'in_review' where id = v_id;
  end if;
  return v_id;
end $$;

-- ─── Admin: moderation queue and decisions (Part 4 §3.3) ──────────────────
create function public.admin_list_cases(p_subject_type public.moderation_subject default null, p_state text default 'open')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin('{moderator,support}') then perform private.raise_code('FORBIDDEN'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'subject_type', c.subject_type, 'subject_id', c.subject_id, 'source', c.source, 'reasons', c.reasons,
             'auto_decision', c.auto_decision, 'auto_confidence', c.auto_confidence, 'priority', c.priority, 'state', c.state,
             'claimed_by_me', c.claimed_by = private.uid(), 'created_at', c.created_at, 'sla_due_at', c.sla_due_at,
             'business', (select z.name from public.businesses z where z.id = c.business_id),
             'snippet', left(case c.subject_type when 'review_text' then (select r.text_original from public.reviews r where r.id = c.subject_id)
                                                 when 'reply_text' then (select rp.text_original from public.review_replies rp where rp.id = c.subject_id) end, 160))
             order by c.priority desc, c.created_at)
    from public.moderation_cases c
    where (p_subject_type is null or c.subject_type = p_subject_type)
      and case p_state when 'open' then c.state in ('open', 'claimed') when 'escalated' then c.state = 'escalated' else c.state = 'decided' end), '[]');
end $$;

create function public.admin_get_case(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.moderation_cases; r public.reviews; rp public.review_replies; v_review uuid;
begin
  if not private.is_admin('{moderator,support}') then perform private.raise_code('FORBIDDEN'); end if;
  select * into c from public.moderation_cases where id = p_case_id;
  if c.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if c.subject_type = 'reply_text' then
    select * into rp from public.review_replies where id = c.subject_id;
    v_review := rp.review_id;
  else
    v_review := c.subject_id;
  end if;
  select * into r from public.reviews where id = v_review;
  return jsonb_build_object(
    'case', to_jsonb(c),
    'content', jsonb_build_object(
      'kind', c.subject_type,
      'original', case when c.subject_type = 'reply_text' then rp.text_original else r.text_original end,
      'display', case when c.subject_type = 'reply_text' then rp.text_display else r.text_display end,
      'normalized', (select p.text_normalized from private.review_text_private p where p.review_id = r.id),
      'pii_spans', (select p.pii_spans from private.review_text_private p where p.review_id = r.id)),
    'review', jsonb_build_object('id', r.id, 'overall', r.overall, 'status', r.status, 'rating_state', r.rating_state,
                                 'text_state', r.text_state, 'trust_tier', r.trust_tier, 'visit_at', r.visit_at),
    'context', jsonb_build_object(
      'business', (select z.name from public.businesses z where z.id = r.business_id),
      'service', (select s.name from public.services s where s.id = r.service_id),
      'canonical', (select cs.name_en from public.canonical_services cs where cs.id = r.canonical_service_id),
      'staff', (select st.display_name from public.staff_members st where st.id = r.staff_id),
      'source', (select b.source from public.bookings b where b.id = r.booking_id)),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', m.stage, 'outcome', m.outcome, 'scores', m.scores, 'labels', m.labels,
                                                            'model', m.model, 'created_at', m.created_at) order by m.id)
                        from private.moderation_results m where m.subject_id = c.subject_id), '[]'),
    'author', jsonb_build_object(
      'account_age_days', (select extract(day from now() - u.created_at)::int from public.profiles u where u.id = r.author_user_id),
      'reviews', (select count(*) from public.reviews x where x.author_user_id = r.author_user_id),
      'status', (select p.status from public.profiles p where p.id = r.author_user_id),
      'fraud_signals', coalesce((select jsonb_agg(jsonb_build_object('signal', f.signal, 'score', f.score, 'status', f.status))
                                 from private.fraud_signals f where f.subject_type = 'review' and f.subject_id = r.id), '[]')),
    'report', (select jsonb_build_object('reason', rep.reason, 'details', rep.details, 'reporter_kind', rep.reporter_kind)
               from public.reports rep where rep.id = c.report_id));
end $$;

create function public.admin_claim_case(p_case_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_admin('{moderator,support}') then perform private.raise_code('FORBIDDEN'); end if;
  update public.moderation_cases set state = 'claimed', claimed_by = private.uid(), claimed_at = now()
   where id = p_case_id and (state = 'open' or (state = 'claimed' and (claimed_by = private.uid() or claimed_at < now() - interval '15 minutes')));
  if not found then perform private.raise_code('CASE_TAKEN'); end if;
end $$;

create function public.admin_release_case(p_case_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.is_admin('{moderator,support}') then perform private.raise_code('FORBIDDEN'); end if;
  update public.moderation_cases set state = 'open', claimed_by = null, claimed_at = null
   where id = p_case_id and state = 'claimed' and claimed_by = private.uid();
end $$;

create function public.admin_decide_case(p_case_id uuid, p_decision public.moderation_decision, p_reason_code text,
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

-- ─── Nightly detectors (Part 4 §6) ────────────────────────────────────────
create function private.job_fraud_nightly() returns int
language plpgsql security definer set search_path = '' as $$
declare v_threshold real := coalesce((private.trust_config() #>> '{fraud,investigation_threshold}')::real, 0.5); x record; n int := 0;
begin
  -- near-duplicate text across different reviewers of one business (last 90 days)
  for x in
    select a.id, b.id as other_id, extensions.similarity(a.text_original, b.text_original) as sim
    from public.reviews a join public.reviews b
      on b.business_id = a.business_id and b.author_user_id <> a.author_user_id
     and (b.created_at, b.id) < (a.created_at, a.id)            -- flag the later copy
    where a.text_original is not null and b.text_original is not null
      and a.created_at > now() - interval '90 days' and b.created_at > now() - interval '90 days'
      and a.status in ('pending', 'published') and extensions.similarity(a.text_original, b.text_original) > 0.8
  loop
    if not exists (select 1 from private.fraud_signals where subject_id = x.id and signal = 'duplicate_text') then
      insert into private.fraud_signals (subject_type, subject_id, signal, score, evidence)
      values ('review', x.id, 'duplicate_text', 0.6, jsonb_build_object('similar_to', x.other_id, 'similarity', x.sim));
      if 0.6 >= v_threshold then perform private.quarantine_review(x.id, 'duplicate_text'); end if;
      n := n + 1;
    end if;
  end loop;
  -- weekly volume > 3× the business's trailing average (informational at business level)
  insert into private.fraud_signals (subject_type, subject_id, signal, score, evidence)
  select 'business', w.business_id, 'review_burst', 0.4, jsonb_build_object('last_7d', w.recent, 'weekly_avg', w.avg)
  from (select r.business_id,
               count(*) filter (where r.created_at > now() - interval '7 days') as recent,
               count(*) filter (where r.created_at between now() - interval '63 days' and now() - interval '7 days') / 8.0 as avg
        from public.reviews r where r.created_at > now() - interval '63 days' group by r.business_id) w
  where w.recent >= 5 and w.recent > 3 * greatest(w.avg, 1)
    and not exists (select 1 from private.fraud_signals f where f.subject_id = w.business_id and f.signal = 'review_burst'
                    and f.created_at > now() - interval '7 days');
  return n;
end $$;
select cron.schedule('app_fraud_nightly', '15 2 * * *', 'select private.job_fraud_nightly()');

grant execute on function public.submit_review(uuid, int, jsonb, text, text, text)          to authenticated;
grant execute on function public.edit_my_review(uuid, int, jsonb, text)                    to authenticated;
grant execute on function public.delete_my_review(uuid)                                    to authenticated;
grant execute on function public.get_business_rating_summary(uuid)                         to anon, authenticated;
grant execute on function public.get_business_reviews(uuid, timestamptz, int)              to anon, authenticated;
grant execute on function public.get_review_context(uuid)                                  to authenticated;
grant execute on function public.biz_get_reviews(uuid, text)                               to authenticated;
grant execute on function public.get_my_reviews()                                          to authenticated;
grant execute on function public.reply_to_review(uuid, text)                               to authenticated;
grant execute on function public.delete_reply(uuid)                                        to authenticated;
grant execute on function public.report_content(public.report_subject, uuid, public.report_reason, text[], text, uuid) to authenticated;
grant execute on function public.admin_list_cases(public.moderation_subject, text)         to authenticated;
grant execute on function public.admin_get_case(uuid)                                      to authenticated;
grant execute on function public.admin_claim_case(uuid)                                    to authenticated;
grant execute on function public.admin_release_case(uuid)                                  to authenticated;
grant execute on function public.admin_decide_case(uuid, public.moderation_decision, text, text, jsonb, text) to authenticated;

select private.assign_app_ownership();
