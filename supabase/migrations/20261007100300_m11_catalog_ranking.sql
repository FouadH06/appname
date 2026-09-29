-- M11 · Catalog management (A8) and ranking configuration (A9).
-- Catalog edits move from direct table writes (M1 ops policies) to audited RPCs with a reason code.
-- Ranking: versioned configs, validation, one active version, publish / rollback, "why this rank".
-- Scores themselves are computed in M12 (compute_quality_scores); until then explain shows the inputs.
-- Spec: Phase 2 A8–A9; Phase 3 Part 5 §3.

-- ═══ Catalog: writes only through admin RPCs ═══════════════════════════════
revoke insert, update, delete on public.areas, public.area_aliases, public.clusters, public.cluster_areas,
                                 public.categories, public.rating_dimensions, public.canonical_services,
                                 public.service_synonyms from authenticated;
revoke update on public.catalog_suggestions from authenticated;
do $$
declare t text;
begin
  foreach t in array array['areas', 'area_aliases', 'clusters', 'cluster_areas', 'categories',
                           'rating_dimensions', 'canonical_services', 'service_synonyms'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ops_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_ops_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_ops_delete', t);
  end loop;
end $$;

create function public.admin_get_catalog() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_caller('{ops}');
  return jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'parent_id', c.parent_id, 'slug', c.slug, 'name_en', c.name_en,
                     'name_ar', c.name_ar, 'is_live', c.is_live, 'allows_before_after_default', c.allows_before_after_default,
                     'requires_consultation_default', c.requires_consultation_default, 'sort', c.sort,
                     'dimensions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'label_en', d.label_en,
                                      'label_ar', d.label_ar, 'sort', d.sort, 'is_active', d.is_active) order by d.sort)
                                    from public.rating_dimensions d where d.category_id = c.id), '[]'))
                     order by c.parent_id nulls first, c.sort) from public.categories c), '[]'),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'category_id', s.category_id, 'slug', s.slug, 'name_en', s.name_en,
                   'name_ar', s.name_ar, 'typical_duration_min', s.typical_duration_min, 'allows_before_after', s.allows_before_after,
                   'relevance_hints', s.relevance_hints, 'is_active', s.is_active, 'sort', s.sort,
                   'usage', (select count(*) from public.services x where x.canonical_service_id = s.id and x.status = 'active'),
                   'synonyms', coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'term', y.term, 'lang', y.lang,
                                   'ambiguous', exists (select 1 from public.service_synonyms z where z.term_normalized = y.term_normalized
                                                        and z.canonical_service_id <> y.canonical_service_id)) order by y.lang, y.term)
                                 from public.service_synonyms y where y.canonical_service_id = s.id), '[]'))
                   order by s.category_id, s.sort) from public.canonical_services s), '[]'),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'parent_id', a.parent_id, 'level', a.level, 'slug', a.slug,
                'name_en', a.name_en, 'name_ar', a.name_ar, 'is_live', a.is_live,
                'aliases', coalesce((select jsonb_agg(x.alias order by x.alias) from public.area_aliases x where x.area_id = a.id), '[]'),
                'clusters', coalesce((select jsonb_agg(ca.cluster_id) from public.cluster_areas ca where ca.area_id = a.id), '[]'))
                order by a.level, a.name_en) from public.areas a), '[]'),
    'clusters', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort) from public.clusters c), '[]'),
    'suggestions', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'proposed_name', g.proposed_name, 'status', g.status,
                      'business', z.name, 'business_id', z.id, 'service_id', g.service_id, 'created_at', g.created_at) order by g.created_at)
                    from public.catalog_suggestions g join public.businesses z on z.id = g.business_id where g.status = 'open'), '[]'));
end $$;

-- Upsert helpers take a jsonb row; unknown keys are ignored, missing keys keep their value.
create function public.admin_save_category(p jsonb, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v_before public.categories; v_id uuid := (p ->> 'id')::uuid;
begin
  v_role := private.admin_caller('{ops}');
  if v_id is null then
    insert into public.categories (parent_id, slug, name_en, name_ar, name_fr, is_live, allows_before_after_default,
                                   requires_consultation_default, sort)
    values ((p ->> 'parent_id')::uuid, p ->> 'slug', p ->> 'name_en', p ->> 'name_ar', p ->> 'name_fr',
            coalesce((p ->> 'is_live')::boolean, false), coalesce((p ->> 'allows_before_after_default')::boolean, false),
            coalesce((p ->> 'requires_consultation_default')::boolean, false), coalesce((p ->> 'sort')::int, 0))
    returning id into v_id;
  else
    select * into v_before from public.categories where id = v_id for update;
    if v_before.id is null then perform private.raise_code('NOT_FOUND'); end if;
    update public.categories set
      slug = coalesce(p ->> 'slug', slug::text), name_en = coalesce(p ->> 'name_en', name_en), name_ar = coalesce(p ->> 'name_ar', name_ar),
      name_fr = case when p ? 'name_fr' then p ->> 'name_fr' else name_fr end,
      is_live = coalesce((p ->> 'is_live')::boolean, is_live),
      allows_before_after_default = coalesce((p ->> 'allows_before_after_default')::boolean, allows_before_after_default),
      requires_consultation_default = coalesce((p ->> 'requires_consultation_default')::boolean, requires_consultation_default),
      sort = coalesce((p ->> 'sort')::int, sort)
     where id = v_id;
  end if;
  perform private.admin_log(v_role, 'catalog.category', 'category', v_id, null, p_reason, null, to_jsonb(v_before),
                            (select to_jsonb(c) from public.categories c where c.id = v_id));
  return v_id;
exception when unique_violation then perform private.raise_code('SLUG_UNAVAILABLE'); return null;
end $$;

create function public.admin_save_rating_dimension(p jsonb, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v_before public.rating_dimensions; v_id uuid := (p ->> 'id')::uuid;
begin
  v_role := private.admin_caller('{ops}');
  if v_id is null then
    insert into public.rating_dimensions (category_id, key, label_en, label_ar, label_fr, sort, is_active)
    values ((p ->> 'category_id')::uuid, p ->> 'key', p ->> 'label_en', p ->> 'label_ar', p ->> 'label_fr',
            coalesce((p ->> 'sort')::int, 0), coalesce((p ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    -- existing ratings keep their data; deactivating only hides the dimension (A8)
    select * into v_before from public.rating_dimensions where id = v_id for update;
    if v_before.id is null then perform private.raise_code('NOT_FOUND'); end if;
    update public.rating_dimensions set label_en = coalesce(p ->> 'label_en', label_en), label_ar = coalesce(p ->> 'label_ar', label_ar),
           sort = coalesce((p ->> 'sort')::int, sort), is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
  end if;
  perform private.admin_log(v_role, 'catalog.dimension', 'rating_dimension', v_id, null, p_reason, null, to_jsonb(v_before),
                            (select to_jsonb(d) from public.rating_dimensions d where d.id = v_id));
  return v_id;
exception when unique_violation then perform private.raise_code('ALREADY_EXISTS'); return null;
end $$;

create function public.admin_save_canonical_service(p jsonb, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v_before public.canonical_services; v_id uuid := (p ->> 'id')::uuid;
begin
  v_role := private.admin_caller('{ops}');
  if v_id is null then
    insert into public.canonical_services (category_id, slug, name_en, name_ar, name_fr, typical_duration_min, allows_before_after,
                                           relevance_hints, is_active, sort)
    values ((p ->> 'category_id')::uuid, p ->> 'slug', p ->> 'name_en', p ->> 'name_ar', p ->> 'name_fr',
            (p ->> 'typical_duration_min')::int, coalesce((p ->> 'allows_before_after')::boolean, false),
            coalesce(array(select jsonb_array_elements_text(p -> 'relevance_hints')), '{}'),
            coalesce((p ->> 'is_active')::boolean, true), coalesce((p ->> 'sort')::int, 0))
    returning id into v_id;
  else
    select * into v_before from public.canonical_services where id = v_id for update;
    if v_before.id is null then perform private.raise_code('NOT_FOUND'); end if;
    -- a service businesses still use can't be switched off until they are remapped (A8)
    if coalesce((p ->> 'is_active')::boolean, true) = false and v_before.is_active
       and exists (select 1 from public.services x where x.canonical_service_id = v_id and x.status = 'active') then
      perform private.raise_code('IN_USE');
    end if;
    update public.canonical_services set
      category_id = coalesce((p ->> 'category_id')::uuid, category_id), slug = coalesce(p ->> 'slug', slug::text),
      name_en = coalesce(p ->> 'name_en', name_en), name_ar = coalesce(p ->> 'name_ar', name_ar),
      name_fr = case when p ? 'name_fr' then p ->> 'name_fr' else name_fr end,
      typical_duration_min = case when p ? 'typical_duration_min' then (p ->> 'typical_duration_min')::int else typical_duration_min end,
      allows_before_after = coalesce((p ->> 'allows_before_after')::boolean, allows_before_after),
      relevance_hints = case when p ? 'relevance_hints' then array(select jsonb_array_elements_text(p -> 'relevance_hints')) else relevance_hints end,
      is_active = coalesce((p ->> 'is_active')::boolean, is_active), sort = coalesce((p ->> 'sort')::int, sort)
     where id = v_id;
  end if;
  perform private.admin_log(v_role, 'catalog.service', 'canonical_service', v_id, null, p_reason, null, to_jsonb(v_before),
                            (select to_jsonb(s) from public.canonical_services s where s.id = v_id));
  return v_id;
exception when unique_violation then perform private.raise_code('SLUG_UNAVAILABLE'); return null;
end $$;

-- Returns whether the term is ambiguous (also a synonym of another service): allowed, but flagged.
create function public.admin_add_synonym(p_canonical_service_id uuid, p_term text, p_lang public.synonym_lang, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v_id uuid; v_amb boolean;
begin
  v_role := private.admin_caller('{ops}');
  insert into public.service_synonyms (canonical_service_id, term, lang) values (p_canonical_service_id, btrim(p_term), p_lang)
  returning id into v_id;
  select exists (select 1 from public.service_synonyms z where z.term_normalized = private.search_key(btrim(p_term))
                 and z.canonical_service_id <> p_canonical_service_id) into v_amb;
  perform private.admin_log(v_role, 'catalog.synonym_add', 'canonical_service', p_canonical_service_id, null, p_reason, null, null,
                            jsonb_build_object('synonym_id', v_id, 'term', btrim(p_term), 'lang', p_lang, 'ambiguous', v_amb));
  return jsonb_build_object('id', v_id, 'ambiguous', v_amb);
exception when unique_violation then perform private.raise_code('ALREADY_EXISTS'); return null;
end $$;

create function public.admin_remove_synonym(p_synonym_id uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; y public.service_synonyms;
begin
  v_role := private.admin_caller('{ops}');
  delete from public.service_synonyms where id = p_synonym_id returning * into y;
  if y.id is null then perform private.raise_code('NOT_FOUND'); end if;
  perform private.admin_log(v_role, 'catalog.synonym_remove', 'canonical_service', y.canonical_service_id, null, p_reason, null,
                            jsonb_build_object('synonym_id', y.id, 'term', y.term, 'lang', y.lang), null);
end $$;

-- Areas: live flag, names; aliases; cluster membership.
create function public.admin_save_area(p_area_id uuid, p jsonb, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; a public.areas; v_alias text;
begin
  v_role := private.admin_caller('{ops}');
  select * into a from public.areas where id = p_area_id for update;
  if a.id is null then perform private.raise_code('NOT_FOUND'); end if;
  update public.areas set name_en = coalesce(p ->> 'name_en', name_en), name_ar = coalesce(p ->> 'name_ar', name_ar),
         is_live = coalesce((p ->> 'is_live')::boolean, is_live) where id = a.id;
  if p ? 'aliases' then
    delete from public.area_aliases where area_id = a.id;
    for v_alias in select distinct btrim(x) from jsonb_array_elements_text(p -> 'aliases') x where btrim(x) <> '' loop
      insert into public.area_aliases (area_id, alias) values (a.id, v_alias);
    end loop;
  end if;
  if p ? 'cluster_ids' then
    delete from public.cluster_areas where area_id = a.id;
    insert into public.cluster_areas (cluster_id, area_id)
    select distinct (x)::uuid, a.id from jsonb_array_elements_text(p -> 'cluster_ids') x;
  end if;
  perform private.admin_log(v_role, 'catalog.area', 'area', a.id, null, p_reason, null,
                            to_jsonb(a) - 'boundary' - 'centroid', p);
end $$;

create function public.admin_save_cluster(p_cluster_id uuid, p jsonb, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; c public.clusters;
begin
  v_role := private.admin_caller('{ops}');
  select * into c from public.clusters where id = p_cluster_id for update;
  if c.id is null then perform private.raise_code('NOT_FOUND'); end if;
  update public.clusters set name_en = coalesce(p ->> 'name_en', name_en), name_ar = coalesce(p ->> 'name_ar', name_ar),
         target_businesses = coalesce((p ->> 'target_businesses')::int, target_businesses),
         is_live = coalesce((p ->> 'is_live')::boolean, is_live) where id = c.id;
  perform private.admin_log(v_role, 'catalog.cluster', 'cluster', c.id, null, p_reason, null, to_jsonb(c),
                            (select to_jsonb(x) from public.clusters x where x.id = c.id));
end $$;

-- Suggestions inbox (B8 "Other" services): map to an existing canonical service, create one, or reject.
create function public.admin_resolve_suggestion(p_suggestion_id uuid, p_action text, p_canonical_service_id uuid default null,
                                                p_new jsonb default null, p_reason text default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; g public.catalog_suggestions; v_target uuid;
begin
  v_role := private.admin_caller('{ops}');
  select * into g from public.catalog_suggestions where id = p_suggestion_id for update;
  if g.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if g.status <> 'open' then perform private.raise_code('ALREADY_DONE'); end if;
  if p_action = 'create' then
    v_target := public.admin_save_canonical_service(coalesce(p_new, '{}') - 'id', coalesce(p_reason, 'suggestion'));
  elsif p_action = 'map' then
    v_target := p_canonical_service_id;
    if not exists (select 1 from public.canonical_services where id = v_target and is_active) then perform private.raise_code('NOT_FOUND'); end if;
  elsif p_action <> 'reject' then
    perform private.raise_code('INVALID_INPUT', '{"field":"action"}');
  end if;
  if v_target is not null and g.service_id is not null then
    update public.services set canonical_service_id = v_target where id = g.service_id and business_id = g.business_id;
  end if;
  update public.catalog_suggestions set status = case p_action when 'create' then 'created' when 'map' then 'mapped' else 'rejected' end,
         resolved_canonical_service_id = v_target, resolved_by = private.uid()
   where id = g.id;
  perform private.admin_log(v_role, 'catalog.suggestion_' || p_action, 'catalog_suggestion', g.id, g.business_id,
                            coalesce(p_reason, p_action), null, jsonb_build_object('status', g.status),
                            jsonb_build_object('status', p_action, 'canonical_service_id', v_target));
  return v_target;
end $$;

-- ═══ Ranking configuration (A9) ════════════════════════════════════════════
create function private.validate_ranking_params(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p -> 'quality_weights') = 'object'
    and (select sum((v)::numeric) from jsonb_each_text(p -> 'quality_weights') w(k, v)) = 100
    and (select bool_and((v)::numeric between 0 and 100) from jsonb_each_text(p -> 'quality_weights') w(k, v))
    and (p -> 'quality_weights') ?& array['rating', 'volume', 'recent', 'reliability', 'completeness', 'responsiveness']
    and (p #>> '{bayes,prior_strength_c}')::numeric between 0 and 1000
    and (p #>> '{bayes,half_life_days}')::numeric between 7 and 3650
    and (p #>> '{bayes,recent_window_days}')::numeric between 7 and 365
    and (p #>> '{trust,verified_booking}')::numeric between 0 and 1
    and (p #>> '{trust,verified_visit}')::numeric between 0 and 1
    and (p #>> '{trust,verified_visit_cap_share}')::numeric between 0 and 1
    and abs((p #>> '{query,quality}')::numeric + (p #>> '{query,proximity}')::numeric
            + (p #>> '{query,availability}')::numeric + (p #>> '{query,personal}')::numeric - 1) < 0.001
    and (p #>> '{query,new_boost}')::numeric between 0 and 1
    and (p #>> '{labels,max_per_card}')::int between 0 and 5
    and jsonb_typeof(p #> '{labels,priority}') = 'array',
    false)
$$;

create table public.ranking_configs (
  id            uuid primary key default gen_random_uuid(),
  version       int not null unique,
  status        public.config_status not null default 'draft',
  params        jsonb not null check (private.validate_ranking_params(params)),
  reason        text,
  created_by    uuid references auth.users(id),          -- null = migration seed
  published_by  uuid references auth.users(id),
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);
create unique index ranking_one_active on public.ranking_configs ((true)) where status = 'active';
create trigger ranking_configs_audit after insert or update or delete on public.ranking_configs
  for each row execute function audit.capture();
alter table public.ranking_configs enable row level security;   -- read through admin RPCs only

insert into public.ranking_configs (version, status, params, reason, published_at) values (1, 'active', '{
  "quality_weights": {"rating": 35, "volume": 20, "recent": 15, "reliability": 10, "completeness": 10, "responsiveness": 10},
  "bayes": {"prior_strength_c": 10, "prior_scope": "root_category_x_cluster", "half_life_days": 180, "recent_window_days": 60,
            "overall_share": 0.6, "dimensions_share": 0.4},
  "trust": {"verified_booking": 1.0, "verified_visit": 0.5, "verified_visit_cap_share": 0.4},
  "volume": {"window_days": 90, "count_sources": ["marketplace_search","marketplace_home","marketplace_other","business_link","rebook","waitlist","promotion"]},
  "query": {"quality": 0.55, "proximity": 0.20, "availability": 0.15, "personal": 0.10, "proximity_scale_km": 3, "new_boost": 0.08, "new_boost_days": 60},
  "labels": {
    "top_rated": {"min_display_rating": 4.7, "min_reviews": 25, "top_quality_pct": 20},
    "top_cleanliness": {"dimension": "cleanliness", "min_avg": 4.7, "min_ratings": 20},
    "great_punctuality": {"dimension": "punctuality", "min_avg": 4.7, "min_ratings": 20},
    "popular_near_you": {"top_bookings_pct": 15, "window_days": 30},
    "best_value": {"dimension": "value_for_money", "min_avg": 4.6, "max_price_level_vs_median": 0},
    "new": {"max_days_live": 60},
    "priority": ["top_rated","available_today","top_cleanliness","great_punctuality","best_value","popular_near_you","new"],
    "max_per_card": 2}}', 'Phase 1 defaults', now());

-- Filled by compute_quality_scores (M12); created now so "why this rank" has one shape.
create table public.business_quality_scores (
  business_id     uuid primary key references public.businesses(id) on delete cascade,
  config_version  int not null,
  score           numeric(5,2) not null,
  bayes_rating    numeric(4,3),
  components      jsonb not null,
  computed_at     timestamptz not null default now()
);
alter table public.business_quality_scores enable row level security;

create function public.admin_list_ranking_configs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_caller('{ops}');
  return coalesce((select jsonb_agg(jsonb_build_object('version', r.version, 'status', r.status, 'params', r.params, 'reason', r.reason,
                     'created_at', r.created_at, 'published_at', r.published_at,
                     'author', (select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') from public.profiles p where p.id = r.created_by))
                     order by r.version desc) from public.ranking_configs r), '[]');
end $$;

create function public.admin_create_ranking_draft(p_params jsonb, p_reason text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; v_version int;
begin
  v_role := private.admin_caller('{}');                  -- superadmin only
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  if not private.validate_ranking_params(p_params) then perform private.raise_code('INVALID_CONFIG'); end if;
  select coalesce(max(version), 0) + 1 into v_version from public.ranking_configs;
  insert into public.ranking_configs (version, status, params, reason, created_by)
  values (v_version, 'draft', p_params, left(btrim(p_reason), 300), private.uid());
  perform private.admin_log(v_role, 'ranking.draft', 'ranking_config', null, null, p_reason, null, null,
                            jsonb_build_object('version', v_version));
  return v_version;
end $$;

-- Publish a draft, or roll back to an archived version. Exactly one active version at all times.
-- (A9: the switch happens after the recompute job — that job arrives with M12; until then it is immediate.)
create function public.admin_publish_ranking(p_version int, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.admin_role; r public.ranking_configs; v_prev int;
begin
  v_role := private.admin_caller('{}');                  -- superadmin only
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform private.raise_code('REASON_REQUIRED'); end if;
  select * into r from public.ranking_configs where version = p_version for update;
  if r.id is null then perform private.raise_code('NOT_FOUND'); end if;
  if r.status = 'active' then perform private.raise_code('ALREADY_DONE'); end if;
  select version into v_prev from public.ranking_configs where status = 'active' for update;
  update public.ranking_configs set status = 'archived' where status = 'active';
  update public.ranking_configs set status = 'active', published_by = private.uid(), published_at = now() where id = r.id;
  perform private.admin_log(v_role, case when r.status = 'archived' then 'ranking.rollback' else 'ranking.publish' end,
                            'ranking_config', null, null, p_reason, null, jsonb_build_object('active_version', v_prev),
                            jsonb_build_object('active_version', r.version));
end $$;

create function public.admin_rollback_ranking(p_version int, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ranking_configs where version = p_version and status = 'archived') then
    perform private.admin_caller('{}');
    perform private.raise_code('NOT_FOUND');
  end if;
  perform public.admin_publish_ranking(p_version, p_reason);
end $$;

-- "Why this rank": applied version, stored components (M12) and the raw inputs available today.
create function public.admin_explain_rank(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.ranking_configs;
begin
  perform private.admin_caller('{ops}');
  select * into r from public.ranking_configs where status = 'active';
  return jsonb_build_object(
    'active_version', r.version,
    'weights', r.params -> 'quality_weights',
    'score', (select to_jsonb(q) - 'business_id' from public.business_quality_scores q where q.business_id = p_business_id),
    'inputs', jsonb_build_object(
      'rating', (select to_jsonb(s) - 'business_id' from public.business_rating_summary s where s.business_id = p_business_id),
      'completed_90d', (select count(*) from public.bookings k where k.business_id = p_business_id and k.status = 'completed'
                        and k.starts_at > now() - interval '90 days'),
      'business_cancels_90d', (select count(*) from public.bookings k where k.business_id = p_business_id and k.status = 'cancelled'
                               and k.cancelled_by_kind = 'business' and k.starts_at > now() - interval '90 days'),
      'checklist', public.get_go_live_checklist(p_business_id)));
end $$;

grant execute on function public.admin_get_catalog() to authenticated;
grant execute on function public.admin_save_category(jsonb, text) to authenticated;
grant execute on function public.admin_save_rating_dimension(jsonb, text) to authenticated;
grant execute on function public.admin_save_canonical_service(jsonb, text) to authenticated;
grant execute on function public.admin_add_synonym(uuid, text, public.synonym_lang, text) to authenticated;
grant execute on function public.admin_remove_synonym(uuid, text) to authenticated;
grant execute on function public.admin_save_area(uuid, jsonb, text) to authenticated;
grant execute on function public.admin_save_cluster(uuid, jsonb, text) to authenticated;
grant execute on function public.admin_resolve_suggestion(uuid, text, uuid, jsonb, text) to authenticated;
grant execute on function public.admin_list_ranking_configs() to authenticated;
grant execute on function public.admin_create_ranking_draft(jsonb, text) to authenticated;
grant execute on function public.admin_publish_ranking(int, text) to authenticated;
grant execute on function public.admin_rollback_ranking(int, text) to authenticated;
grant execute on function public.admin_explain_rank(uuid) to authenticated;

select private.assign_app_ownership();
