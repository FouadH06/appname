-- M12 · Search & discovery: search documents + refresh pipeline, quality scores (Bayesian, decay,
--       Verified Visit cap), price levels, labels, search / suggest / home / landing RPCs, search log.
-- Spec: Phase 3 Part 5 §1–3; Phase 2 C2–C4, A9. Deterministic and explainable: every score component is
-- stored with its inputs; text relevance is a gate, never a score component.

-- ═══ Documents ═════════════════════════════════════════════════════════════
create table public.search_documents (
  location_id            uuid primary key references public.business_locations(id) on delete cascade,
  business_id            uuid not null references public.businesses(id) on delete cascade,
  business_slug          extensions.citext not null,
  name                   text not null,
  name_key               text not null,
  area_id                uuid not null,
  cluster_id             uuid,
  geo                    extensions.geography(Point, 4326) not null,
  category_ids           uuid[] not null,
  canonical_service_ids  uuid[] not null,
  service_terms          text not null,
  tsv                    tsvector not null,
  audience               public.audience not null,
  price_level            smallint,
  -- {canonical_id: {service_id, name, type, min, max, duration, next}} (cheapest service per canonical)
  service_prices         jsonb not null default '{}',
  display_rating         numeric(2,1),
  review_count           int not null default 0,
  quality_score          numeric(5,2) not null default 0,
  labels                 public.discovery_label[] not null default '{}',
  cover_path             text,
  published_at           timestamptz,
  next_available_at      timestamptz,
  updated_at             timestamptz not null default now()
);
create index on public.search_documents using gin (tsv);
create index on public.search_documents using gin (name_key extensions.gin_trgm_ops);
create index on public.search_documents using gin (service_terms extensions.gin_trgm_ops);
create index on public.search_documents using gin (canonical_service_ids);
create index on public.search_documents using gin (category_ids);
create index on public.search_documents using gist (geo);
create index on public.search_documents (cluster_id, quality_score desc);
alter table public.search_documents enable row level security;   -- read through the search RPCs only

create index if not exists business_locations_business_id_idx on public.business_locations (business_id);

create table private.search_refresh_queue (
  location_id   uuid primary key,
  requested_at  timestamptz not null default now()
);

create table private.business_price_levels (
  business_id  uuid primary key references public.businesses(id) on delete cascade,
  price_level  smallint not null check (price_level between 1 and 4),
  ratio        numeric(6,3) not null,
  computed_at  timestamptz not null default now()
);

create table public.business_quality_score_history (
  business_id     uuid not null references public.businesses(id) on delete cascade,
  day             date not null,
  config_version  int not null,
  score           numeric(5,2) not null,
  components      jsonb not null,
  primary key (business_id, day, config_version)
);
alter table public.business_quality_score_history enable row level security;

create table public.business_labels (
  business_id     uuid not null references public.businesses(id) on delete cascade,
  label           public.discovery_label not null,
  config_version  int not null,
  computed_at     timestamptz not null default now(),
  primary key (business_id, label)
);
alter table public.business_labels enable row level security;

create table private.search_log (
  id                    bigint generated always as identity primary key,
  q                     text,
  q_key                 text,
  cluster_id            uuid,
  canonical_service_id  uuid,
  results_count         int not null,
  user_hash             text,
  created_at            timestamptz not null default now()
);
create index on private.search_log (created_at desc) where results_count = 0;

-- ─── Refresh: triggers enqueue locations, a per-minute job rebuilds them ────
-- two indexed branches (an OR across both columns would scan every location on each booking insert)
create function private.enqueue_search_refresh(p_business_id uuid, p_location_id uuid default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_location_id is not null then
    insert into private.search_refresh_queue (location_id) values (p_location_id)
    on conflict (location_id) do update set requested_at = excluded.requested_at;
  else
    insert into private.search_refresh_queue (location_id)
    select l.id from public.business_locations l where l.business_id = p_business_id
    on conflict (location_id) do update set requested_at = excluded.requested_at;
  end if;
end $$;

create function private.search_touch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  if tg_table_name = 'businesses' then
    perform private.enqueue_search_refresh((r ->> 'id')::uuid);
  elsif tg_table_name = 'business_locations' then
    if tg_op <> 'DELETE' then perform private.enqueue_search_refresh(null, (r ->> 'id')::uuid); end if;
  elsif r ? 'location_id' and (r ->> 'location_id') is not null then
    perform private.enqueue_search_refresh(null, (r ->> 'location_id')::uuid);
  elsif r ? 'business_id' and (r ->> 'business_id') is not null then
    perform private.enqueue_search_refresh((r ->> 'business_id')::uuid);
  end if;
  return null;
end $$;

-- catalog edits (synonyms, canonical names) touch every document offering that service
create function private.search_touch_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce((to_jsonb(coalesce(new, old)) ->> 'canonical_service_id')::uuid, (to_jsonb(coalesce(new, old)) ->> 'id')::uuid);
begin
  insert into private.search_refresh_queue (location_id)
  select d.location_id from public.search_documents d where v_id = any (d.canonical_service_ids)
  on conflict (location_id) do update set requested_at = excluded.requested_at;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['businesses', 'business_locations', 'services', 'staff_members', 'staff_services', 'staff_locations',
                           'location_hours', 'staff_weekly_hours', 'business_rating_summary', 'business_media'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.search_touch()',
                   t || '_search_touch', t);
  end loop;
end $$;
-- bookings change availability: only status / time changes matter
create trigger bookings_search_touch after insert or update of status, starts_at, ends_at on public.bookings
  for each row execute function private.search_touch();
create trigger service_synonyms_search_touch after insert or update or delete on public.service_synonyms
  for each row execute function private.search_touch_catalog();
create trigger canonical_services_search_touch after update on public.canonical_services
  for each row execute function private.search_touch_catalog();

create function private.refresh_search_document(p_location_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  l public.business_locations; b public.businesses; v_cluster uuid; v_cats uuid[]; v_canon uuid[]; v_terms text;
  v_prices jsonb; v_next timestamptz; v_area_terms text; v_name_key text; s record; v_svcs jsonb;
begin
  select * into l from public.business_locations where id = p_location_id;
  select * into b from public.businesses where id = l.business_id;
  if l.id is null or b.id is null or b.status <> 'live' or b.is_test or l.status <> 'live' then
    delete from public.search_documents where location_id = p_location_id;
    return;
  end if;
  select ca.cluster_id into v_cluster from public.cluster_areas ca join public.clusters c on c.id = ca.cluster_id
   where ca.area_id = l.area_id order by c.sort limit 1;

  -- publicly bookable services here: active, bookable online (or priced "on consultation"), with at
  -- least one active, publicly bookable staff member at this location
  select coalesce(jsonb_agg(jsonb_build_object('id', sv.id, 'name', sv.name, 'canonical', sv.canonical_service_id,
           'category', cs.category_id, 'price_type', sv.price_type, 'price_min', sv.price_min, 'price_max', sv.price_max,
           'duration', sv.duration_min, 'online', sv.is_online_bookable and sv.price_type <> 'on_consultation')), '[]')
    into v_svcs
  from public.services sv join public.canonical_services cs on cs.id = sv.canonical_service_id
  where sv.business_id = b.id and sv.status = 'active' and (sv.is_online_bookable or sv.price_type = 'on_consultation')
    and exists (select 1 from public.staff_services ss join public.staff_members st on st.id = ss.staff_id
                join public.staff_locations sl on sl.staff_id = st.id and sl.location_id = l.id
                where ss.service_id = sv.id and st.status = 'active' and st.publicly_bookable);

  select coalesce(array_agg(distinct canonical), '{}') into v_canon from jsonb_to_recordset(v_svcs) as x(id uuid, name text, canonical uuid, category uuid, price_type text, price_min numeric, price_max numeric, duration int, online boolean);
  -- categories: the business's own + each offered service's category, with their parents
  select coalesce(array_agg(distinct x), '{}') into v_cats from (
    select c.id as x from public.categories c
    where c.id in (select b.primary_category_id union select category from jsonb_to_recordset(v_svcs) as x(id uuid, name text, canonical uuid, category uuid, price_type text, price_min numeric, price_max numeric, duration int, online boolean))
    union select c.parent_id from public.categories c
    where c.parent_id is not null and c.id in (select b.primary_category_id union select category from jsonb_to_recordset(v_svcs) as x(id uuid, name text, canonical uuid, category uuid, price_type text, price_min numeric, price_max numeric, duration int, online boolean))) q;
  select string_agg(distinct t, ' ') into v_terms from (
    select private.search_key(name) as t from jsonb_to_recordset(v_svcs) as x(id uuid, name text, canonical uuid, category uuid, price_type text, price_min numeric, price_max numeric, duration int, online boolean)
    union select private.search_key(cs.name_en) from public.canonical_services cs where cs.id = any (v_canon)
    union select private.search_key(cs.name_ar) from public.canonical_services cs where cs.id = any (v_canon)
    union select private.search_key(coalesce(cs.name_fr, '')) from public.canonical_services cs where cs.id = any (v_canon)
    union select y.term_normalized from public.service_synonyms y where y.canonical_service_id = any (v_canon)
    union select private.search_key(c.name_en) from public.categories c where c.id = any (v_cats)
    union select private.search_key(c.name_ar) from public.categories c where c.id = any (v_cats)) q where t <> '';
  select string_agg(distinct t, ' ') into v_area_terms from (
    select private.search_key(a.name_en) as t from public.areas a where a.id = l.area_id
    union select private.search_key(a.name_ar) from public.areas a where a.id = l.area_id
    union select x.alias_normalized from public.area_aliases x where x.area_id = l.area_id) q;

  -- cheapest service per canonical, with its next public slot (computed here, not at query time)
  v_prices := '{}';
  for s in select distinct on (canonical) * from jsonb_to_recordset(v_svcs) as x(id uuid, name text, canonical uuid, category uuid, price_type text, price_min numeric, price_max numeric, duration int, online boolean)
           order by canonical, online desc, coalesce(price_min, 1e9), duration loop
    v_next := case when s.online then public.get_next_available(l.id, s.id) end;
    v_prices := v_prices || jsonb_build_object(s.canonical, jsonb_build_object(
      'service_id', s.id, 'name', s.name, 'type', s.price_type, 'min', s.price_min, 'max', s.price_max,
      'duration', s.duration, 'next', v_next));
  end loop;
  select min((v ->> 'next')::timestamptz) into v_next from jsonb_each(v_prices) e(k, v);
  v_name_key := private.search_key(b.name);

  insert into public.search_documents as d (location_id, business_id, business_slug, name, name_key, area_id, cluster_id, geo,
    category_ids, canonical_service_ids, service_terms, tsv, audience, price_level, service_prices, display_rating, review_count,
    quality_score, labels, cover_path, published_at, next_available_at, updated_at)
  values (l.id, b.id, b.slug, b.name, v_name_key, l.area_id, v_cluster, l.geo, v_cats, v_canon, coalesce(v_terms, ''),
    setweight(to_tsvector('simple', v_name_key), 'A') || setweight(to_tsvector('simple', coalesce(v_terms, '')), 'B')
      || setweight(to_tsvector('simple', coalesce(v_area_terms, '')), 'C'),
    b.audience, (select price_level from private.business_price_levels where business_id = b.id), v_prices,
    (select display_rating from public.business_rating_summary where business_id = b.id),
    coalesce((select review_count from public.business_rating_summary where business_id = b.id), 0),
    coalesce((select score from public.business_quality_scores where business_id = b.id), 0),
    coalesce((select array_agg(label order by label) from public.business_labels where business_id = b.id), '{}'),
    private.business_media_path(b.id, 'cover'), b.published_at, v_next, now())
  on conflict (location_id) do update set
    business_id = excluded.business_id, business_slug = excluded.business_slug, name = excluded.name, name_key = excluded.name_key,
    area_id = excluded.area_id, cluster_id = excluded.cluster_id, geo = excluded.geo, category_ids = excluded.category_ids,
    canonical_service_ids = excluded.canonical_service_ids, service_terms = excluded.service_terms, tsv = excluded.tsv,
    audience = excluded.audience, price_level = excluded.price_level, service_prices = excluded.service_prices,
    display_rating = excluded.display_rating, review_count = excluded.review_count, quality_score = excluded.quality_score,
    labels = excluded.labels, cover_path = excluded.cover_path, published_at = excluded.published_at,
    next_available_at = excluded.next_available_at, updated_at = now();
end $$;

create function private.job_search_refresh(p_max int default 200) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v uuid; n int := 0;
begin
  for v in delete from private.search_refresh_queue
            where location_id in (select location_id from private.search_refresh_queue order by requested_at limit p_max
                                  for update skip locked)
            returning location_id loop
    perform private.refresh_search_document(v);
    n := n + 1;
  end loop;
  return n;
end $$;

-- availability goes stale with time: re-queue documents whose next slot passed or that are old
create function private.job_search_availability() returns int
language sql volatile security definer set search_path = '' as $$
  with q as (
    insert into private.search_refresh_queue (location_id)
    select location_id from public.search_documents
    where next_available_at is null or next_available_at < now() + interval '30 minutes' or updated_at < now() - interval '1 hour'
    on conflict (location_id) do nothing returning 1)
  select count(*)::int from q
$$;

-- ═══ Quality scores (Part 5 §3), set-based, deterministic ═════════════════
-- scratch space for compute_quality_scores (unlogged; truncated per run under an advisory lock)
create unlogged table private.qs_biz (business_id uuid primary key, root_id uuid, cluster_id uuid, published_at timestamptz, description text);
create unlogged table private.qs_rev (id uuid primary key, business_id uuid, overall smallint, trust_tier public.trust_tier,
                                      visit_at timestamptz, w numeric);
create index on private.qs_rev (business_id);
create unlogged table private.qs_prior (root_id uuid, cluster_id uuid, m numeric);
create unlogged table private.qs (business_id uuid primary key, root_id uuid, cluster_id uuid, published_at timestamptz,
  bayes_overall numeric, bayes_dims numeric, bayes_recent numeric, prior_mean numeric, weight_sum numeric, volume_n bigint,
  volume_pct numeric, cancel_rate numeric, expire_rate numeric, overturn_rate numeric, completeness_items int,
  accept_min numeric, reply_rate numeric);
create unlogged table private.qs_out (business_id uuid primary key, root_id uuid, cluster_id uuid, published_at timestamptz,
  bayes_overall numeric, bayes_dims numeric, bayes_recent numeric, prior_mean numeric, weight_sum numeric, volume_n bigint,
  volume_pct numeric, cancel_rate numeric, expire_rate numeric, overturn_rate numeric, completeness_items int,
  accept_min numeric, reply_rate numeric, c_rating numeric, c_volume numeric, c_recent numeric, c_reliability numeric,
  c_completeness numeric, c_responsiveness numeric, bayes_blended numeric, score numeric);

create function private.compute_quality_scores(p_version int default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  cfg jsonb; v_ver int; c_prior numeric; half numeric; recent_days int; cap numeric; ov_share numeric; dim_share numeric;
  vol_days int; vol_sources text[]; v_w jsonb; v_lb jsonb; v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('compute_quality_scores'));   -- nightly job vs publish: one at a time
  select version, params into v_ver, cfg from public.ranking_configs
   where (p_version is null and status = 'active') or version = p_version;
  if v_ver is null then perform private.raise_code('NOT_FOUND'); end if;
  c_prior := (cfg #>> '{bayes,prior_strength_c}')::numeric;
  half := (cfg #>> '{bayes,half_life_days}')::numeric;
  recent_days := (cfg #>> '{bayes,recent_window_days}')::int;
  cap := (cfg #>> '{trust,verified_visit_cap_share}')::numeric;
  ov_share := coalesce((cfg #>> '{bayes,overall_share}')::numeric, 1);
  dim_share := coalesce((cfg #>> '{bayes,dimensions_share}')::numeric, 0);
  vol_days := (cfg #>> '{volume,window_days}')::int;
  vol_sources := array(select jsonb_array_elements_text(cfg #> '{volume,count_sources}'));
  v_w := cfg -> 'quality_weights';
  v_lb := cfg -> 'labels';

  -- scope: live, non-test businesses with their root category and cluster
  truncate private.qs_biz;
  insert into private.qs_biz
  select b.id as business_id, coalesce(c.parent_id, c.id) as root_id,
         (select ca.cluster_id from public.business_locations l join public.cluster_areas ca on ca.area_id = l.area_id
          join public.clusters cl on cl.id = ca.cluster_id where l.business_id = b.id order by l.created_at, cl.sort limit 1) as cluster_id,
         b.published_at, b.description
  from public.businesses b join public.categories c on c.id = b.primary_category_id
  where b.status = 'live' and not b.is_test;

  -- 1–2. counted reviews, decayed weights, Verified Visit cap
  truncate private.qs_rev;
  insert into private.qs_rev
  select r.id, r.business_id, r.overall, r.trust_tier, r.visit_at,
         r.base_weight * r.fraud_multiplier * power(0.5, extract(epoch from (now() - r.visit_at)) / 86400.0 / half) as w
  from public.reviews r join private.qs_biz q on q.business_id = r.business_id
  where private.rating_is_counted(r);
  update private.qs_rev v set w = v.w * x.f
  from (select business_id,
               case when sum(w) filter (where trust_tier = 'verified_visit') > cap / (1 - cap) * coalesce(sum(w) filter (where trust_tier = 'verified_booking'), 0)
                    then cap / (1 - cap) * coalesce(sum(w) filter (where trust_tier = 'verified_booking'), 0)
                         / nullif(sum(w) filter (where trust_tier = 'verified_visit'), 0)
                    else 1 end as f
        from private.qs_rev group by business_id) x
  where x.business_id = v.business_id and v.trust_tier = 'verified_visit';

  -- 3. prior mean per root category × cluster (fallback: platform mean, then 4.0)
  truncate private.qs_prior;
  insert into private.qs_prior
  select q.root_id, q.cluster_id, sum(v.w * v.overall) / nullif(sum(v.w), 0) as m
  from private.qs_rev v join private.qs_biz q on q.business_id = v.business_id group by q.root_id, q.cluster_id;

  truncate private.qs;
  insert into private.qs
  with glob as (select coalesce(sum(w * overall) / nullif(sum(w), 0), 4.0) as m from private.qs_rev),
  prior as (select q.business_id, coalesce(p.m, (select m from glob)) as m
            from private.qs_biz q left join private.qs_prior p on p.root_id = q.root_id and p.cluster_id is not distinct from q.cluster_id),
  ov as (select business_id, sum(w * overall) as sw_r, sum(w) as sw from private.qs_rev group by business_id),
  rec as (select business_id, sum(w * overall) as sw_r, sum(w) as sw from private.qs_rev
          where visit_at > now() - make_interval(days => recent_days) group by business_id),
  -- dimensions: Bayesian per dimension with the same prior strength, then averaged
  dimv as (select v.business_id, d.key, avg(rr.score) as avg_score, count(*) as n,
                  sum(v.w * rr.score) as sw_r, sum(v.w) as sw
           from private.qs_rev v join public.review_ratings rr on rr.review_id = v.id
           join public.rating_dimensions d on d.id = rr.dimension_id group by v.business_id, d.key),
  dim as (select x.business_id, avg((c_prior * p.m + x.sw_r) / (c_prior + x.sw)) as bayes
          from dimv x join prior p on p.business_id = x.business_id group by x.business_id),
  vol as (select q.business_id, q.root_id, q.cluster_id,
                 (select count(*) from public.bookings k where k.business_id = q.business_id and k.status = 'completed'
                    and k.starts_at > now() - make_interval(days => vol_days) and k.source::text = any (vol_sources)) as n
          from private.qs_biz q),
  volp as (select business_id, n, case when n = 0 then 0 else cume_dist() over (partition by root_id, cluster_id order by ln(1 + n))::numeric end as pct
           from vol),
  rel as (select q.business_id,
                 coalesce((select count(*) filter (where k.status = 'cancelled' and k.cancelled_by_kind = 'business')::numeric
                                  / nullif(count(*) filter (where k.status in ('confirmed', 'completed', 'no_show', 'cancelled')), 0)
                           from public.bookings k where k.business_id = q.business_id and k.starts_at > now() - interval '90 days'), 0) as cancel_rate,
                 coalesce((select count(*) filter (where e.event = 'expired')::numeric / nullif(count(*) filter (where e.event = 'requested'), 0)
                           from public.booking_events e where e.business_id = q.business_id and e.created_at > now() - interval '90 days'), 0) as expire_rate,
                 coalesce((select count(*) filter (where d.outcome = 'no_show_overturned')::numeric
                                  / nullif((select count(*) from public.bookings k where k.business_id = q.business_id and k.no_show_at > now() - interval '90 days'), 0)
                           from public.disputes d where d.business_id = q.business_id and d.type = 'no_show' and d.created_at > now() - interval '90 days'), 0) as overturn_rate
          from private.qs_biz q),
  comp as (select q.business_id,
                 (exists (select 1 from public.business_media m where m.business_id = q.business_id and m.kind = 'cover' and m.state = 'approved'))::int
               + ((select count(*) from public.business_media m where m.business_id = q.business_id and m.kind = 'portfolio' and m.state = 'approved') >= 5)::int
               + (coalesce(char_length(q.description), 0) >= 40)::int
               + (exists (select 1 from public.location_hours h join public.business_locations l on l.id = h.location_id where l.business_id = q.business_id))::int
               + (coalesce((select avg((cs.slug::text not like 'other-%')::int) from public.services s
                            join public.canonical_services cs on cs.id = s.canonical_service_id
                            where s.business_id = q.business_id and s.status = 'active'), 0) >= 0.8)::int
               + (exists (select 1 from public.staff_members st where st.business_id = q.business_id and st.status = 'active'
                          and st.publicly_bookable and st.photo_media_id is not null))::int as items
          from private.qs_biz q),
  resp as (select q.business_id,
                  (select (percentile_cont(0.5) within group (order by extract(epoch from (a.created_at - r.created_at)) / 60))::numeric
                   from public.booking_events r join public.booking_events a on a.booking_id = r.booking_id and a.event = 'accepted'
                   where r.business_id = q.business_id and r.event = 'requested' and r.created_at > now() - interval '90 days') as accept_min,
                  (select avg((exists (select 1 from public.review_replies rp where rp.review_id = v.id
                                        and rp.created_at <= v.published_at + interval '7 days'))::int)
                   from public.reviews v where v.business_id = q.business_id and v.status = 'published'
                     and v.published_at > now() - interval '90 days') as reply_rate
           from private.qs_biz q)
  select q.business_id, q.root_id, q.cluster_id, q.published_at,
         (coalesce(c_prior * p.m + ov.sw_r, c_prior * p.m)) / (c_prior + coalesce(ov.sw, 0)) as bayes_overall,
         dim.bayes as bayes_dims,
         (c_prior * p.m + coalesce(rec.sw_r, 0)) / (c_prior + coalesce(rec.sw, 0)) as bayes_recent,
         p.m as prior_mean, coalesce(ov.sw, 0) as weight_sum,
         volp.n as volume_n, volp.pct as volume_pct,
         rel.cancel_rate, rel.expire_rate, rel.overturn_rate,
         comp.items as completeness_items,
         resp.accept_min, resp.reply_rate
  from private.qs_biz q join prior p on p.business_id = q.business_id
  left join ov on ov.business_id = q.business_id left join rec on rec.business_id = q.business_id
  left join dim on dim.business_id = q.business_id join volp on volp.business_id = q.business_id
  join rel on rel.business_id = q.business_id join comp on comp.business_id = q.business_id
  join resp on resp.business_id = q.business_id;

  -- 4–9. components (0..1) and the weighted score (weights sum to 100)
  truncate private.qs_out;
  insert into private.qs_out
  select x.*, round((
      (v_w ->> 'rating')::numeric * c_rating + (v_w ->> 'volume')::numeric * c_volume + (v_w ->> 'recent')::numeric * c_recent
    + (v_w ->> 'reliability')::numeric * c_reliability + (v_w ->> 'completeness')::numeric * c_completeness
    + (v_w ->> 'responsiveness')::numeric * c_responsiveness), 2) as score
  from (
    select s.*,
           greatest(0, least(1, ((case when s.bayes_dims is null then s.bayes_overall
                                       else ov_share * s.bayes_overall + dim_share * s.bayes_dims end) - 1) / 4)) as c_rating,
           s.volume_pct as c_volume,
           greatest(0, least(1, (s.bayes_recent - 1) / 4)) as c_recent,
           1 - greatest(0, least(1, 2 * s.cancel_rate + s.expire_rate + s.overturn_rate)) as c_reliability,
           s.completeness_items / 6.0 as c_completeness,
           (coalesce(greatest(0, least(1, 1 - (s.accept_min - 60) / (24 * 60 - 60))), 0.5) + coalesce(s.reply_rate, 0.5)) / 2 as c_responsiveness,
           case when s.bayes_dims is null then s.bayes_overall else ov_share * s.bayes_overall + dim_share * s.bayes_dims end as bayes_blended
    from private.qs s) x;

  insert into public.business_quality_scores as t (business_id, config_version, score, bayes_rating, components, computed_at)
  select business_id, v_ver, score, round(bayes_blended, 3),
         jsonb_build_object('rating', round(c_rating, 3), 'volume', round(c_volume, 3), 'recent', round(c_recent, 3),
                            'reliability', round(c_reliability, 3), 'completeness', round(c_completeness, 3),
                            'responsiveness', round(c_responsiveness, 3),
                            'inputs', jsonb_build_object('prior_mean', round(prior_mean, 3), 'review_weight', round(weight_sum, 3),
                                        'bayes_overall', round(bayes_overall, 3), 'bayes_dimensions', round(bayes_dims, 3),
                                        'bayes_recent', round(bayes_recent, 3), 'completed_bookings', volume_n,
                                        'business_cancel_rate', round(cancel_rate, 3), 'expired_request_rate', round(expire_rate, 3),
                                        'no_show_overturn_rate', round(overturn_rate, 3), 'completeness_items', completeness_items,
                                        'median_accept_minutes', round(accept_min::numeric, 1), 'reply_rate', round(reply_rate, 3))),
         now()
  from private.qs_out
  on conflict (business_id) do update set config_version = excluded.config_version, score = excluded.score,
    bayes_rating = excluded.bayes_rating, components = excluded.components, computed_at = excluded.computed_at;
  delete from public.business_quality_scores where business_id not in (select business_id from private.qs_biz);
  insert into public.business_quality_score_history (business_id, day, config_version, score, components)
  select business_id, current_date, v_ver, score, components from public.business_quality_scores where config_version = v_ver
  on conflict (business_id, day, config_version) do update set score = excluded.score, components = excluded.components;

  -- price levels: each priced service vs the median of the same canonical service in the same cluster
  delete from private.business_price_levels where true;
  insert into private.business_price_levels (business_id, price_level, ratio)
  select business_id, case when r < 0.8 then 1 when r < 1.1 then 2 when r < 1.4 then 3 else 4 end, round(r, 3)
  from (
    select s.business_id, avg(s.price_min / nullif(m.med, 0)) as r
    from public.services s join private.qs_biz q on q.business_id = s.business_id
    join (select s2.canonical_service_id, q2.cluster_id, (percentile_cont(0.5) within group (order by s2.price_min))::numeric as med
          from public.services s2 join private.qs_biz q2 on q2.business_id = s2.business_id
          where s2.status = 'active' and s2.price_type in ('fixed', 'from') and s2.price_min > 0
          group by s2.canonical_service_id, q2.cluster_id) m
      on m.canonical_service_id = s.canonical_service_id and m.cluster_id is not distinct from q.cluster_id
    where s.status = 'active' and s.price_type in ('fixed', 'from') and s.price_min > 0
    group by s.business_id) x
  where r is not null;

  -- labels (display rules; available_today is computed at query time)
  delete from public.business_labels where true;
  insert into public.business_labels (business_id, label, config_version)
  select o.business_id, 'top_rated'::public.discovery_label, v_ver from private.qs_out o
  join public.business_rating_summary s on s.business_id = o.business_id
  where s.display_rating >= (v_lb #>> '{top_rated,min_display_rating}')::numeric
    and s.review_count >= (v_lb #>> '{top_rated,min_reviews}')::int
    and o.business_id in (select business_id from (select business_id,
                            percent_rank() over (partition by root_id, cluster_id order by score) as pr from private.qs_out) z
                          where pr >= 1 - (v_lb #>> '{top_rated,top_quality_pct}')::numeric / 100)
  union all
  select v.business_id, l.label::public.discovery_label, v_ver
  from (values ('top_cleanliness'), ('great_punctuality'), ('best_value')) l(label)
  cross join lateral (
    select v.business_id from private.qs_rev v join public.review_ratings rr on rr.review_id = v.id
    join public.rating_dimensions d on d.id = rr.dimension_id and d.key = v_lb #>> array[l.label, 'dimension']
    group by v.business_id
    having avg(rr.score) >= (v_lb #>> array[l.label, 'min_avg'])::numeric
       and count(*) >= coalesce((v_lb #>> array[l.label, 'min_ratings'])::int, 1)) v
  where l.label <> 'best_value' or coalesce((select price_level from private.business_price_levels p where p.business_id = v.business_id), 2) <= 2
  union all
  select business_id, 'popular_near_you'::public.discovery_label, v_ver from (
    select q.business_id, n, percent_rank() over (partition by q.cluster_id order by n) as pr from (
      select q.business_id, q.cluster_id, (select count(*) from public.bookings k where k.business_id = q.business_id and k.status = 'completed'
                    and k.starts_at > now() - make_interval(days => (v_lb #>> '{popular_near_you,window_days}')::int)) as n
      from private.qs_biz q) q) z
  where n > 0 and pr >= 1 - (v_lb #>> '{popular_near_you,top_bookings_pct}')::numeric / 100
  union all
  select business_id, 'new'::public.discovery_label, v_ver from private.qs_biz
  where published_at > now() - make_interval(days => (v_lb #>> '{new,max_days_live}')::int);

  -- every document picks up the new score, price level and labels
  insert into private.search_refresh_queue (location_id)
  select l.id from public.business_locations l join private.qs_biz q on q.business_id = l.business_id
  on conflict (location_id) do update set requested_at = excluded.requested_at;
  select count(*) into v_n from private.qs_out;
  return v_n;
end $$;

-- A9: publish = recompute with the new version, then switch atomically (same transaction).
create or replace function public.admin_publish_ranking(p_version int, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; r public.ranking_configs; v_prev int; v_n int;
begin
  v_role := private.admin_caller('{}');                  -- superadmin only
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  select * into r from public.ranking_configs where version = p_version for update;
  if r.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if r.status = 'active' then perform private.raise_code('ALREADY_DONE'); end if;
  v_n := private.compute_quality_scores(r.version);      -- a failure here leaves the previous version active
  select version into v_prev from public.ranking_configs where status = 'active' for update;
  update public.ranking_configs set status = 'archived' where status = 'active';
  update public.ranking_configs set status = 'active', published_by = private.uid(), published_at = now() where id = r.id;
  perform private.admin_log(v_role, case when r.status = 'archived' then 'ranking.rollback' else 'ranking.publish' end,
                            'ranking_config', null, null, p_reason, null, jsonb_build_object('active_version', v_prev),
                            jsonb_build_object('active_version', r.version, 'businesses_scored', v_n));
end $$;

-- ═══ Search ════════════════════════════════════════════════════════════════
-- Intent: services / categories matched from the text (synonyms in EN/AR/FR/Arabizi), an area named
-- inside the query ("barber hazmieh"), business-name matches. Text is a gate, not a score.
create function private.search_intent(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_key text := private.search_key(coalesce(p_q, '')); v_area record; v_rest text; v_services uuid[]; v_cats uuid[];
        v_hidden boolean := false;
begin
  if v_key = '' then return jsonb_build_object('key', ''); end if;
  -- an area mentioned as whole words (longest alias first)
  select a.id, a.slug, t.k into v_area from public.areas a
  cross join lateral (select private.search_key(a.name_en) as k union select private.search_key(a.name_ar)
                      union select x.alias_normalized from public.area_aliases x where x.area_id = a.id) t
  where a.level = 'area' and length(t.k) >= 3 and (' ' || v_key || ' ') like ('% ' || t.k || ' %')
  order by length(t.k) desc limit 1;
  v_rest := btrim(regexp_replace(' ' || v_key || ' ', ' ' || coalesce(v_area.k, '§') || ' ', ' '));
  if v_rest <> '' then
    -- exact synonym / name, plus services whose name contains the query as whole words ("manicure" →
    -- manicure + gel manicure; "haircut" → men's, women's, kids' haircut); else prefix / close trigram
    select array_agg(distinct id) into v_services from (
      select cs.id from public.canonical_services cs where cs.is_active and (v_rest in
          (private.search_key(cs.name_en), private.search_key(cs.name_ar), private.search_key(coalesce(cs.name_fr, '')))
          or (' ' || private.search_key(cs.name_en) || ' ') like ('% ' || v_rest || ' %'))
      union select y.canonical_service_id from public.service_synonyms y join public.canonical_services cs on cs.id = y.canonical_service_id
      where cs.is_active and y.term_normalized = v_rest) e;
    if v_services is null and length(v_rest) >= 3 then
      select array_agg(distinct id) into v_services from (
        select y.canonical_service_id as id from public.service_synonyms y join public.canonical_services cs on cs.id = y.canonical_service_id
        where cs.is_active and (y.term_normalized like v_rest || '%' or extensions.similarity(y.term_normalized, v_rest) >= 0.5)
        union select cs.id from public.canonical_services cs where cs.is_active
          and (private.search_key(cs.name_en) like v_rest || '%' or extensions.similarity(private.search_key(cs.name_en), v_rest) >= 0.5)) p;
    end if;
    -- services of categories we don't offer yet don't count (they flag "not offered")
    select coalesce(bool_or(not c.is_live), false) into v_hidden from public.canonical_services cs
    join public.categories c on c.id = cs.category_id where cs.id = any (coalesce(v_services, '{}'));
    select nullif(array_agg(cs.id), '{}') into v_services from public.canonical_services cs
    join public.categories c on c.id = cs.category_id where cs.id = any (coalesce(v_services, '{}')) and c.is_live;
    select array_agg(id), coalesce(v_hidden, false) or coalesce(bool_or(not is_live), false) into v_cats, v_hidden from public.categories c
    where v_rest in (private.search_key(c.name_en), private.search_key(c.name_ar), private.search_key(coalesce(c.name_fr, '')), c.slug::text)
       or (length(v_rest) >= 4 and private.search_key(c.name_en) like v_rest || '%');
    select nullif(array_agg(id), '{}') into v_cats from public.categories where id = any (coalesce(v_cats, '{}')) and is_live;
  end if;
  return jsonb_build_object('key', v_key, 'rest', v_rest, 'area_id', v_area.id, 'area_slug', v_area.slug,
                            'service_ids', coalesce(to_jsonb(v_services), '[]'), 'category_ids', coalesce(to_jsonb(v_cats), '[]'),
                            -- a category we don't offer yet ("Not on APP_NAME yet", never zero-result shame)
                            'not_offered', coalesce(v_hidden, false) and v_services is null);
end $$;

-- The core (public wrapper + admin debug). Returns cards; p_debug adds the score parts.
create function private.search_core(p_q text, p_service_id uuid, p_category_id uuid, p_cluster_id uuid, p_area_id uuid,
                                    p_lat double precision, p_lng double precision, p_filters jsonb, p_sort text,
                                    p_offset int, p_limit int, p_debug boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  it jsonb := private.search_intent(p_q); cfg jsonb; v_services uuid[]; v_cats uuid[]; v_area uuid; v_rest text;
  v_point extensions.geography; f jsonb := coalesce(p_filters, '{}'); v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_end_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Beirut') + interval '1 day') at time zone 'Asia/Beirut';
  v_date date := (f ->> 'date')::date; v_from time := coalesce((f ->> 'time_from')::time, '00:00'); v_to time := coalesce((f ->> 'time_to')::time, '23:59');
  v_uid uuid := private.uid(); v_total int; v_rows jsonb; v_prio text[];
begin
  select params into cfg from public.ranking_configs where status = 'active';
  v_prio := array(select jsonb_array_elements_text(cfg #> '{labels,priority}'));
  v_services := case when p_service_id is not null then array[p_service_id]
                     else array(select jsonb_array_elements_text(it -> 'service_ids'))::uuid[] end;
  v_cats := case when p_category_id is not null then array[p_category_id]
                 else array(select jsonb_array_elements_text(it -> 'category_ids'))::uuid[] end;
  v_area := coalesce(p_area_id, (it ->> 'area_id')::uuid);
  v_rest := nullif(it ->> 'rest', '');
  v_point := case when p_lat is not null and p_lng is not null
                  then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
                  when v_area is not null then (select centroid from public.areas where id = v_area) end;

  -- one statement (no temp tables): candidates → service-specific availability → bounded date/time check
  -- → score → order; cards are built only for the requested page
  with base as (
    select d.*,
           case when v_point is not null then extensions.st_distance(d.geo, v_point) / 1000.0 end as km,
           case when cardinality(v_services) > 0 then
             (select v from jsonb_each(d.service_prices) e(k, v) where k::uuid = any (v_services)
              order by (v ->> 'next') is null, (v ->> 'min')::numeric nulls last limit 1) end as svc
    from public.search_documents d
    where (p_cluster_id is null or v_area is not null or d.cluster_id = p_cluster_id)
      and (v_area is null or d.area_id = v_area)
      -- text gate: matched service or category, or the business name
      and (coalesce(it ->> 'key', '') = '' and cardinality(v_services) = 0 and cardinality(v_cats) = 0
           or (cardinality(v_services) > 0 and d.canonical_service_ids && v_services)
           or (cardinality(v_cats) > 0 and d.category_ids && v_cats)
           or (v_rest is not null and cardinality(v_services) = 0 and cardinality(v_cats) = 0
               and (d.name_key like '%' || v_rest || '%' or (length(v_rest) >= 3 and d.name_key operator(extensions.%) v_rest)
                    or d.tsv @@ plainto_tsquery('simple', v_rest))))
      and (f ->> 'audience' is null or d.audience::text in (f ->> 'audience', 'everyone'))
      and (f -> 'price_levels' is null or d.price_level = any (array(select jsonb_array_elements_text(f -> 'price_levels'))::smallint[]))
      and (f ->> 'min_rating' is null or d.display_rating >= (f ->> 'min_rating')::numeric)
      and (f ->> 'max_km' is null or v_point is null or extensions.st_dwithin(d.geo, v_point, (f ->> 'max_km')::numeric * 1000))
      and (coalesce((f ->> 'available_today')::boolean, false) = false or d.next_available_at < v_end_today)
      and (coalesce((f ->> 'new_only')::boolean, false) = false or 'new' = any (d.labels))
  ), avail as (
    select b.*,
           case when coalesce((b.svc ->> 'next')::timestamptz, b.next_available_at) < v_end_today then 1
                when coalesce((b.svc ->> 'next')::timestamptz, b.next_available_at) < v_end_today + interval '2 days' then 0.5
                else 0 end::numeric as avail0,
           case when v_uid is not null and exists (select 1 from public.bookings k where k.customer_user_id = v_uid
                  and k.business_id = b.business_id and k.status = 'completed') then 0.7 else 0 end::numeric as personal
    from base b
    -- a service-specific query shows that service's next slot; "available today" then means that service
    where not (cardinality(v_services) > 0 and coalesce((f ->> 'available_today')::boolean, false)
               and ((b.svc ->> 'next') is null or (b.svc ->> 'next')::timestamptz >= v_end_today))
  ), dated as (
    -- date / time window: the availability engine runs for at most the top 40 candidates (bounded cost)
    select a.* from avail a
    where v_date is null
       or (a.location_id in (select location_id from avail order by quality_score desc, location_id limit 40)
           and exists (select 1 from public.get_available_slots(a.location_id,
                         coalesce((a.svc ->> 'service_id')::uuid, (select (v ->> 'service_id')::uuid from jsonb_each(a.service_prices) e(k, v)
                                                                   where (v ->> 'next') is not null limit 1)),
                         null, v_date, v_date) s
                       where (s.slot_start at time zone 'Asia/Beirut')::time between v_from and v_to))
  ), scored as (
    select x.*,
           (cfg #>> '{query,quality}')::numeric * x.quality_score / 100
         + (cfg #>> '{query,proximity}')::numeric * case when x.km is null then 0 else exp(-x.km / (cfg #>> '{query,proximity_scale_km}')::numeric) end
         + (cfg #>> '{query,availability}')::numeric * x.avail
         + (cfg #>> '{query,personal}')::numeric * x.personal
         + (cfg #>> '{query,new_boost}')::numeric
           * greatest(0, 1 - extract(epoch from (now() - coalesce(x.published_at, now() - interval '10 years'))) / 86400.0
                             / (cfg #>> '{query,new_boost_days}')::numeric) as rank_score
    from (select d.*, case when v_date is not null then 1::numeric else d.avail0 end as avail from dated d) x
  ), ordered as (
    select s.*, row_number() over (order by
             case p_sort when 'nearest' then coalesce(s.km, 1e9) when 'price' then coalesce((s.svc ->> 'min')::numeric, s.price_level * 1000, 1e9)
                         when 'soonest' then extract(epoch from coalesce((s.svc ->> 'next')::timestamptz, s.next_available_at, now() + interval '10 years'))
                         else 0 end,
             case when p_sort = 'rating' then -coalesce(s.display_rating, 0) else 0 end,
             case when p_sort = 'rating' then -s.review_count else 0 end,
             s.rank_score desc, s.quality_score desc, s.name, s.location_id) as ord
    from scored s
  )
  select (select count(*)::int from ordered),
         coalesce((select jsonb_agg(
             jsonb_build_object(
               'location_id', o.location_id, 'business_id', o.business_id, 'slug', o.business_slug, 'name', o.name,
               'area', (select a.name_en from public.areas a where a.id = o.area_id),
               'cluster_id', o.cluster_id, 'km', round(o.km::numeric, 1), 'display_rating', o.display_rating, 'review_count', o.review_count,
               'price_level', o.price_level, 'cover_path', o.cover_path, 'next_available_at', o.next_available_at,
               'labels', to_jsonb(array(select l from unnest(v_prio) with ordinality p(l, n)
                                        where l = any (o.labels::text[]) or (l = 'available_today' and o.avail = 1)
                                        order by n limit coalesce((cfg #>> '{labels,max_per_card}')::int, 2))),
               'service', o.svc)
             || case when p_debug then jsonb_build_object('debug', jsonb_build_object(
                  'rank_score', round(o.rank_score::numeric, 4), 'quality_score', o.quality_score, 'km', round(o.km::numeric, 2),
                  'availability_fit', o.avail, 'personal', o.personal, 'published_at', o.published_at)) else '{}' end
             order by o.ord)
           from ordered o where o.ord > greatest(coalesce(p_offset, 0), 0) and o.ord <= greatest(coalesce(p_offset, 0), 0) + v_limit), '[]')
    into v_total, v_rows;

  return jsonb_build_object(
    'total', v_total, 'results', v_rows,
    'intent', jsonb_build_object('service_ids', to_jsonb(v_services), 'category_ids', to_jsonb(v_cats), 'area_id', v_area,
                                 -- "Not on APP_NAME yet": a hidden category, or text that matches nothing we offer
                                 'not_offered', coalesce((it ->> 'not_offered')::boolean, false)
                                   or (v_total = 0 and v_rest is not null and cardinality(v_services) = 0 and cardinality(v_cats) = 0
                                       and not exists (select 1 from public.search_documents d where d.name_key like '%' || v_rest || '%'))),
    'config_version', (select version from public.ranking_configs where status = 'active'));
end $$;

create function public.search_businesses(p_q text default null, p_service_id uuid default null, p_category_id uuid default null,
                                         p_cluster_id uuid default null, p_area_id uuid default null,
                                         p_lat double precision default null, p_lng double precision default null,
                                         p_filters jsonb default '{}', p_sort text default 'recommended',
                                         p_offset int default 0, p_limit int default 20)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb; v_nearby jsonb;
begin
  if p_sort not in ('recommended', 'nearest', 'rating', 'price', 'soonest') then perform private.raise_code('INVALID_INPUT', '{"field":"sort"}'); end if;
  v := private.search_core(left(p_q, 100), p_service_id, p_category_id, p_cluster_id, p_area_id, p_lat, p_lng, p_filters, p_sort,
                           p_offset, p_limit, false);
  -- very few results in a cluster → "Also nearby" from the other clusters, clearly separated (C4)
  if p_cluster_id is not null and p_area_id is null and coalesce(p_offset, 0) = 0 and (v ->> 'total')::int < 3 then
    v_nearby := private.search_core(left(p_q, 100), p_service_id, p_category_id, null, null, p_lat, p_lng, p_filters, p_sort, 0, 8, false) -> 'results';
    v := v || jsonb_build_object('nearby', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_nearby) x
                                                     where (x ->> 'cluster_id') is distinct from p_cluster_id::text), '[]'));
  end if;
  -- zero-result / demand log (queries and service searches only; browse isn't logged)
  if nullif(btrim(coalesce(p_q, '')), '') is not null or p_service_id is not null then
    insert into private.search_log (q, q_key, cluster_id, canonical_service_id, results_count, user_hash)
    values (left(btrim(p_q), 100), private.search_key(coalesce(p_q, '')), p_cluster_id, p_service_id, (v ->> 'total')::int,
            case when private.uid() is not null then md5(private.uid()::text) end);
  end if;
  return v;
end $$;

-- Typeahead: up to 5 services (with how many places offer them here), businesses and areas.
create function public.search_suggest(p_q text, p_cluster_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_key text := private.search_key(left(coalesce(p_q, ''), 60));
begin
  if length(v_key) < 2 then return jsonb_build_object('services', '[]'::jsonb, 'businesses', '[]'::jsonb, 'areas', '[]'::jsonb); end if;
  return jsonb_build_object(
    'services', coalesce((select jsonb_agg(x order by rnk, tlen, places desc, x ->> 'name') from (
      select jsonb_build_object('id', cs.id, 'name', cs.name_en, 'name_ar', cs.name_ar, 'rank', min(m.rank),
               'places', (select count(*) from public.search_documents d where cs.id = any (d.canonical_service_ids)
                          and (p_cluster_id is null or d.cluster_id = p_cluster_id))) as x,
             min(m.rank) as rnk, min(m.len) as tlen,
             (select count(*) from public.search_documents d where cs.id = any (d.canonical_service_ids)
               and (p_cluster_id is null or d.cluster_id = p_cluster_id)) as places
      from public.canonical_services cs
      join (select y.canonical_service_id as id,
                   case when y.term_normalized = v_key then 0 when y.term_normalized like v_key || '%' then 1
                        when y.term_normalized like '% ' || v_key || '%' then 2 else 3 end as rank, length(y.term_normalized) as len
            from public.service_synonyms y
            where y.term_normalized like v_key || '%' or y.term_normalized like '% ' || v_key || '%'
               or (length(v_key) >= 3 and extensions.similarity(y.term_normalized, v_key) >= 0.4)
            union all
            select id, case when private.search_key(name_en) = v_key then 0 when private.search_key(name_en) like v_key || '%' then 1 else 2 end,
                   length(private.search_key(name_en))
            from public.canonical_services where private.search_key(name_en) like '%' || v_key || '%') m on m.id = cs.id
      where cs.is_active and exists (select 1 from public.categories c where c.id = cs.category_id and c.is_live)
      group by cs.id order by rnk, tlen, places desc, cs.name_en limit 5) q), '[]'),
    'businesses', coalesce((select jsonb_agg(jsonb_build_object('slug', d.business_slug, 'name', d.name,
                     'area', (select a.name_en from public.areas a where a.id = d.area_id), 'display_rating', d.display_rating))
                   -- best matches first: the name contains the text, then by similarity (one row per business)
                   from (select * from (select distinct on (business_id) d.*, d.name_key like '%' || v_key || '%' as contains,
                                               extensions.similarity(d.name_key, v_key) as sim
                                        from public.search_documents d
                                        where (d.name_key like '%' || v_key || '%' or (length(v_key) >= 3 and d.name_key operator(extensions.%) v_key))
                                          and (p_cluster_id is null or d.cluster_id = p_cluster_id)
                                        order by business_id, extensions.similarity(d.name_key, v_key) desc) x
                         order by contains desc, sim desc, name limit 5) d), '[]'),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'slug', a.slug, 'name', a.name_en, 'name_ar', a.name_ar))
                       from (select distinct a.* from public.areas a left join public.area_aliases x on x.area_id = a.id
                             where a.level = 'area' and a.is_live
                               and (private.search_key(a.name_en) like v_key || '%' or private.search_key(a.name_ar) like v_key || '%'
                                    or x.alias_normalized like v_key || '%')
                             order by a.name_en limit 5) a), '[]'));
end $$;

-- C2 Home rails for a cluster (sections with fewer than 3 items are hidden by the client).
create function public.get_home(p_cluster_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'clusters', (select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name_en, 'name_ar', c.name_ar) order by c.sort)
                 from public.clusters c where c.is_live),
    'categories', (select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name_en, 'icon', c.icon) order by c.sort)
                   from public.categories c where c.is_live and c.parent_id is not null),
    'available_today', private.search_core(null, null, null, p_cluster_id, null, null, null, '{"available_today": true}', 'soonest', 0, 8, false) -> 'results',
    'top_rated', private.search_core(null, null, null, p_cluster_id, null, null, null, '{"min_rating": 4.5}', 'recommended', 0, 8, false) -> 'results',
    'new', private.search_core(null, null, null, p_cluster_id, null, null, null, '{"new_only": true}', 'recommended', 0, 8, false) -> 'results',
    'popular_services', (select coalesce(jsonb_agg(jsonb_build_object('id', cs.id, 'name', cs.name_en, 'places', n) order by n desc, cs.name_en), '[]')
                         from (select unnest(d.canonical_service_ids) as id, count(*) as n from public.search_documents d
                               where p_cluster_id is null or d.cluster_id = p_cluster_id group by 1 order by 2 desc limit 8) t
                         join public.canonical_services cs on cs.id = t.id));
end $$;

-- SEO landing /{area}/{category} (area may also be a cluster slug)
create function public.get_landing(p_area_slug text, p_category_slug text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare a public.areas; cl public.clusters; c public.categories; v jsonb;
begin
  select * into a from public.areas where slug = p_area_slug and level = 'area';
  if a.id is null then select * into cl from public.clusters where slug = p_area_slug and is_live; end if;
  select * into c from public.categories where slug = p_category_slug and is_live;
  if (a.id is null and cl.id is null) or c.id is null then return null; end if;
  v := private.search_core(null, null, c.id, cl.id, a.id, null, null, '{}', 'recommended', 0, 24, false);
  return jsonb_build_object(
    'area', case when a.id is not null then jsonb_build_object('id', a.id, 'slug', a.slug, 'name', a.name_en, 'name_ar', a.name_ar,
                    'cluster', (select jsonb_build_object('id', x.id, 'slug', x.slug, 'name', x.name_en) from public.clusters x
                                join public.cluster_areas ca on ca.cluster_id = x.id where ca.area_id = a.id order by x.sort limit 1)) end,
    'cluster', case when cl.id is not null then jsonb_build_object('id', cl.id, 'slug', cl.slug, 'name', cl.name_en, 'name_ar', cl.name_ar) end,
    'category', jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name_en, 'name_ar', c.name_ar),
    'total', v -> 'total', 'results', v -> 'results',
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', cs.id, 'name', cs.name_en) order by cs.sort), '[]')
                 from public.canonical_services cs where cs.category_id = c.id and cs.is_active));
end $$;

-- Sitemap: business pages that are publicly visible (same rule as the search documents)
create function public.get_public_business_slugs() returns setof text
language sql stable security definer set search_path = '' as $$
  select distinct business_slug::text from public.search_documents order by 1
$$;

-- ═══ Admin: zero-result queries, search debug ═══════════════════════════════
create function public.admin_zero_result_queries(p_days int default 14) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_caller('{ops}');
  return coalesce((select jsonb_agg(row_to_json(x) order by x.n desc, x.q_key) from (
    select q_key, min(q) as q, count(*)::int as n, max(created_at) as last_at,
           (select c.name_en from public.clusters c where c.id = min(l.cluster_id::text)::uuid) as cluster
    from private.search_log l
    where results_count = 0 and created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)) and q_key <> ''
    group by q_key order by count(*) desc limit 50) x), '[]');
end $$;

create function public.admin_search_debug(p_q text, p_cluster_id uuid default null, p_service_id uuid default null,
                                          p_filters jsonb default '{}', p_sort text default 'recommended')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.admin_caller('{ops}');
  return private.search_core(p_q, p_service_id, null, p_cluster_id, null, null, null, p_filters, p_sort, 0, 30, true)
         || jsonb_build_object('intent_raw', private.search_intent(p_q));
end $$;

create or replace function public.admin_explain_rank(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.ranking_configs;
begin
  perform private.admin_caller('{ops}');
  select * into r from public.ranking_configs where status = 'active';
  return jsonb_build_object(
    'active_version', r.version,
    'weights', r.params -> 'quality_weights',
    'score', (select to_jsonb(q) - 'business_id' from public.business_quality_scores q where q.business_id = p_business_id),
    'labels', coalesce((select jsonb_agg(label) from public.business_labels where business_id = p_business_id), '[]'),
    'price_level', (select to_jsonb(p) - 'business_id' from private.business_price_levels p where p.business_id = p_business_id),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('location_id', d.location_id, 'cluster_id', d.cluster_id,
                    'next_available_at', d.next_available_at, 'services', jsonb_array_length(to_jsonb(d.canonical_service_ids)),
                    'updated_at', d.updated_at)) from public.search_documents d where d.business_id = p_business_id), '[]'),
    'inputs', jsonb_build_object(
      'rating', (select to_jsonb(s) - 'business_id' from public.business_rating_summary s where s.business_id = p_business_id),
      'checklist', public.get_go_live_checklist(p_business_id)));
end $$;

-- route words used by M12 pages
insert into public.reserved_slugs (slug) values ('foundation'), ('sitemap'), ('robots') on conflict do nothing;

-- ─── Jobs ──────────────────────────────────────────────────────────────────
select cron.schedule('app_search_refresh', '* * * * *', 'select private.job_search_refresh()');
select cron.schedule('app_search_availability', '*/10 * * * *', 'select private.job_search_availability()');
select cron.schedule('app_quality_scores', '30 3 * * *', 'select private.compute_quality_scores()');

-- initial build for anything already live
insert into private.search_refresh_queue (location_id) select id from public.business_locations on conflict do nothing;

grant execute on function public.search_businesses(text, uuid, uuid, uuid, uuid, double precision, double precision, jsonb, text, int, int)
  to anon, authenticated;
grant execute on function public.search_suggest(text, uuid) to anon, authenticated;
grant execute on function public.get_home(uuid) to anon, authenticated;
grant execute on function public.get_landing(text, text) to anon, authenticated;
grant execute on function public.get_public_business_slugs() to anon, authenticated;
grant execute on function public.admin_zero_result_queries(int) to authenticated;
grant execute on function public.admin_search_debug(text, uuid, uuid, jsonb, text) to authenticated;

select private.assign_app_ownership();
