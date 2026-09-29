-- M12 · search & discovery: documents + refresh (visibility), intent (EN/AR/FR/Arabizi, area in query,
--       names), filters, sorting determinism, ranking inputs (Bayesian, quarantine, Verified Visit cap),
--       config integration (publish recomputes; query weights), zero-result log, suggest, landing, home.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(46);

-- ─── fixtures: a few controlled businesses ──────────────────────────────────
select tests.new_user(n) from unnest(array['owner', 'ops', 'super', 'mod']) n;
insert into public.admin_users (user_id, role) values (tests.id('ops'), 'ops'), (tests.id('super'), 'superadmin'), (tests.id('mod'), 'moderator');
create function tests.biz(p_key text, p_name text, p_area text, p_category text, p_canon text, p_price numeric,
                          p_audience public.audience default 'everyone', p_public boolean default true) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := tests.new_business(p_key, 'owner');
  update public.businesses set name = p_name, audience = p_audience, published_at = now() - interval '200 days',
         primary_category_id = (select id from public.categories where slug = p_category) where id = v;
  update public.business_locations set area_id = a.id, geo = a.centroid from public.areas a
   where a.slug = p_area and business_locations.id = tests.id(p_key || '_loc');
  perform tests.open_every_day(p_key, 0, 1440);
  perform tests.new_staff(p_key, p_key || ' staff', null, p_public, p_public);
  perform tests.staff_every_day(p_key, p_key || ' staff', 0, 1440);
  perform tests.new_service(p_key, p_key || ' service', p_canon, p_price);
  perform tests.link(p_key, p_key || ' staff', p_key || ' service');
  return v;
end $$;
-- a counted review written directly (tier, stars, age)
create function tests.review(p_biz text, p_stars int, p_tier public.trust_tier default 'verified_booking', p_days int default 10)
returns uuid language plpgsql as $$
declare v_rec uuid; v_bk uuid; v_item uuid; v_rev uuid; v_u uuid := gen_random_uuid(); v_start timestamptz;
begin
  insert into auth.users (id, aud, role, created_at, updated_at) values (v_u, 'authenticated', 'authenticated', now(), now());
  insert into public.business_customers (business_id, user_id, display_name, acquired_via) values (tests.id(p_biz), v_u, 'C', 'marketplace')
  returning id into v_rec;
  v_start := date_trunc('minute', now()) - make_interval(days => p_days)
             - (select count(*) from public.bookings where business_id = tests.id(p_biz)) * interval '3 minutes';
  insert into public.bookings (business_id, location_id, business_customer_id, customer_user_id, status, source, starts_at, ends_at,
                               created_by_kind, confirmed_at, completed_at)
  values (tests.id(p_biz), tests.id(p_biz || '_loc'), v_rec, v_u, 'completed', 'marketplace_search', v_start, v_start + interval '1 minute',
          'customer', v_start, v_start) returning id into v_bk;
  insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id, selection_mode,
                                    starts_at, ends_at, occupied, duration_min, price_type, price_min)
  select v_bk, tests.id(p_biz), tests.id(p_biz || '_loc'), s.id, s.canonical_service_id, tests.id(p_biz || ' staff'), 'business',
         v_start, v_start + interval '1 minute', tstzrange(v_start, v_start + interval '1 minute', '[)'), 5, 'fixed', 10
  from public.services s where s.id = tests.id(p_biz || ' service') returning id into v_item;
  insert into public.reviews (booking_id, booking_item_id, business_id, location_id, staff_id, service_id, canonical_service_id,
                              author_user_id, trust_tier, visit_at, overall, rating_state, status, published_at, base_weight, editable_until)
  select v_bk, v_item, i.business_id, i.location_id, i.staff_id, i.service_id, i.canonical_service_id, v_u, p_tier, v_start, p_stars,
         'active', 'published', v_start, case when p_tier = 'verified_visit' then 0.5 else 1.0 end, v_start + interval '7 days'
  from public.booking_items i where i.id = v_item returning id into v_rev;
  return v_rev;
end $$;
create function tests.names(r jsonb) returns text[] language sql immutable as
  $$ select coalesce(array_agg(x ->> 'name' order by o), '{}') from jsonb_array_elements(r -> 'results') with ordinality t(x, o) $$;
create function tests.bq(p_biz text) returns public.business_quality_scores language sql stable as
  $$ select * from public.business_quality_scores where business_id = tests.id(p_biz) $$;
create table tests.v (k text primary key, j jsonb);
grant select, insert on tests.v to authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.biz('fade', 'Fade District', 'hazmieh', 'barber', 'mens-haircut', 15, 'men');
select tests.biz('abu', 'حلاق أبو علي', 'hamra', 'barber', 'beard-trim', 8, 'men');
select tests.biz('rita', 'Salon Rita', 'achrafieh', 'hair-salon', 'balayage', 150, 'women');
select tests.biz('maya', 'Nail Studio Maya', 'hamra', 'nails', 'gel-manicure', 25);
select tests.biz('testbiz', 'Hidden Test Barber', 'hazmieh', 'barber', 'mens-haircut', 15);
select tests.biz('paused', 'Paused Barber', 'hazmieh', 'barber', 'mens-haircut', 15);
select tests.biz('private', 'Private Staff Barber', 'hazmieh', 'barber', 'kids-haircut', 15, 'everyone', false);
update public.businesses set is_test = true where id = tests.id('testbiz');
update public.businesses set status = 'paused' where id = tests.id('paused');
select private.job_search_refresh(1000);

-- ═══ documents: only publicly visible locations; service only with public staff ═══
select results_eq($$ select name from public.search_documents order by name $$,
                  $$ values ('Fade District'), ('Nail Studio Maya'), ('Private Staff Barber'), ('Salon Rita'), ('حلاق أبو علي') $$,
                  'live, non-test businesses only (paused and test businesses have no document)');
select is((select cardinality(canonical_service_ids) from public.search_documents where business_id = tests.id('private')), 0,
  'a service without publicly bookable staff is not searchable');
select ok((select next_available_at is not null and (service_prices -> (select id::text from public.canonical_services where slug = 'mens-haircut') ->> 'next') is not null
           from public.search_documents where business_id = tests.id('fade')), 'next slot precomputed per location and per service');
select tests.as_anon();
select throws_ok($$ select * from public.search_documents $$, '42501', null, 'documents are not readable directly (RPCs only)');
select tests.as_postgres();

-- ═══ intent: EN / AR / FR / Arabizi, area inside the query, business names ═══
select tests.as_anon();
select is(tests.names(public.search_businesses('7ala2')), array['Fade District'],
  'Arabizi "7ala2" → men''s haircut (its synonym); only businesses offering it (text is a gate)');
select ok('Fade District' = any (tests.names(public.search_businesses('حـلاقّ'))), 'Arabic with tatweel/shadda normalises (حلاق)');
select ok('Fade District' = any (tests.names(public.search_businesses('coiffeur homme'))), 'French synonym');
select is(tests.names(public.search_businesses('بالياج')), array['Salon Rita'], 'Arabic service name → balayage');
select is(tests.names(public.search_businesses('balayage')), array['Salon Rita'], 'text is a gate: barbers never match "balayage"');
select results_eq($$ select tests.names(x), (x -> 'intent' ->> 'area_id')::uuid = (select id from public.areas where slug = 'hamra')
                     from (select public.search_businesses('barber hamra') x) y $$,
                  $$ values (array['حلاق أبو علي'], true) $$, 'area named in the query becomes the area filter');
select is(tests.names(public.search_businesses('fade')), array['Fade District'], 'business name (English)');
select is(tests.names(public.search_businesses('ابو علي')), array['حلاق أبو علي'], 'business name (Arabic, hamza folded)');
select results_eq($$ select (x ->> 'total')::int, (x -> 'intent' ->> 'not_offered')::boolean from (select public.search_businesses('dentist') x) y $$,
                  $$ values (0, true) $$, '"dentist": zero results flagged as not offered (no zero-result shame)');
select is((public.search_businesses('laser hair removal') -> 'intent' ->> 'not_offered')::boolean, true,
  'hidden category (aesthetics) → not offered yet');

-- ═══ filters and sorting ═══
select is((select array_agg(n order by n) from unnest(tests.names(public.search_businesses(null, null, null, null, null, null, null, '{"audience": "women"}'))) n),
          array['Nail Studio Maya', 'Private Staff Barber', 'Salon Rita'], 'For: women excludes men-only businesses');
select ok(not ('Salon Rita' = any (tests.names(public.search_businesses(null, null, null, null, null, null, null, '{"audience": "men"}')))),
  'For: men excludes women-only businesses');
select is((public.search_businesses(null, null, null, (select id from public.clusters where slug = 'hamra-verdun')) ->> 'total')::int, 2,
  'cluster filter');
select is(tests.names(public.search_businesses(null, null, null, null, null, 33.8425, 35.5361, '{"max_km": 2}')),
          array['Fade District', 'Private Staff Barber'], 'distance filter around Hazmieh');
select is((public.search_businesses('manicure', null, null, null, null, null, null, '{"available_today": true}') ->> 'total')::int, 1,
  'available today (open around the clock here)');
select is((public.search_businesses(null, null, null, null, null, null, null, '{"min_rating": 4}') ->> 'total')::int, 0,
  'minimum rating excludes businesses without a displayed rating');
select is(public.search_businesses(null, null, null, null, null, null, null, '{}', 'price') -> 'results',
          public.search_businesses(null, null, null, null, null, null, null, '{}', 'price') -> 'results', 'same query → same order (deterministic)');
select is(tests.names(public.search_businesses('haircut', null, null, null, null, null, null, '{}', 'nearest')), tests.names(public.search_businesses('haircut')),
  'nearest without a location falls back to the recommended order');
select throws_ok($$ select public.search_businesses('x', null, null, null, null, null, null, '{}', 'popular') $$, 'P0001', 'INVALID_INPUT',
  'unknown sort rejected');
select is((public.search_businesses('manicure') -> 'results' -> 0 -> 'service' ->> 'min')::numeric, 25.00,
  'a service query shows that service''s price on the card');
select tests.as_postgres();

-- ═══ ranking inputs: Bayesian, quarantine, Verified Visit cap (Part 5 §3) ═══
select tests.biz('few', 'Few Reviews', 'hazmieh', 'barber', 'mens-haircut', 15);
select tests.biz('many', 'Many Reviews', 'hazmieh', 'barber', 'mens-haircut', 15);
select tests.biz('capped', 'Capped Visits', 'hazmieh', 'barber', 'mens-haircut', 15);
select tests.biz('typical', 'Typical Barber', 'hazmieh', 'barber', 'mens-haircut', 15);
select tests.review('few', 5) from generate_series(1, 3);
select tests.review('many', case when g % 5 = 0 then 4 else 5 end) from generate_series(1, 100) g;   -- mean 4.8
select tests.review('capped', 5) from generate_series(1, 2);
select tests.review('typical', case when g % 2 = 0 then 4 else 3 end) from generate_series(1, 60) g;   -- a normal market around the prior
select tests.review('capped', 1, 'verified_visit') from generate_series(1, 10);
insert into tests.v values ('bad', to_jsonb(tests.review('few', 1)));
update public.reviews set rating_state = 'quarantined', fraud_multiplier = 0 where id = (select (j #>> '{}')::uuid from tests.v where k = 'bad');
select private.compute_quality_scores();
select ok((tests.bq('many')).bayes_rating > (tests.bq('few')).bayes_rating and (tests.bq('many')).score > (tests.bq('few')).score,
  '3 × 5★ does not outrank 100 × 4.8★ (Bayesian prior)');
select is(((tests.bq('few')).components #>> '{inputs,review_weight}')::numeric < 3.1, true, 'the quarantined 1★ review is not counted');
select ok(abs(((tests.bq('capped')).components #>> '{inputs,review_weight}')::numeric
              - (select sum(base_weight * power(0.5, extract(epoch from (now() - visit_at)) / 86400.0 / 180)) * (1 + 0.4 / 0.6)
                 from public.reviews where business_id = tests.id('capped') and trust_tier = 'verified_booking')) < 0.01,
  'Verified Visit weight capped to 40% of the total');
insert into tests.v select 'scores1', jsonb_agg(to_jsonb(q) - 'computed_at' order by business_id) from public.business_quality_scores q;
select private.compute_quality_scores();
select is((select jsonb_agg(to_jsonb(q) - 'computed_at' order by business_id) from public.business_quality_scores q),
          (select j from tests.v where k = 'scores1'), 'scores are deterministic (same inputs → same scores)');
select ok(exists (select 1 from public.business_quality_score_history where business_id = tests.id('many')), 'daily history written');
select ok((select price_level from private.business_price_levels where business_id = tests.id('fade')) between 1 and 4, 'price level computed');

-- ═══ config integration: publish recomputes; query weights drive the order ═══
select private.job_search_refresh(1000);
insert into tests.v select 'v1', params from public.ranking_configs where version = 1;
select tests.act_as('super', 'aal2');
select is(public.admin_create_ranking_draft(jsonb_set((select j from tests.v where k = 'v1'), '{query}',
            '{"quality": 1, "proximity": 0, "availability": 0, "personal": 0, "proximity_scale_km": 3, "new_boost": 0, "new_boost_days": 60}'),
            'quality only'), 2, 'draft v2: quality-only query weights');
select lives_ok($$ select public.admin_publish_ranking(2, 'quality only') $$, 'publish v2');
select tests.as_postgres();
select is((select count(*)::int from public.business_quality_scores where config_version = 2),
          (select count(*)::int from public.business_quality_scores), 'publish recomputed every score with v2 before switching');
select private.job_search_refresh(1000);
select tests.as_anon();
select is((tests.names(public.search_businesses('haircut')))[1], 'Many Reviews', 'quality-only weights: the best quality ranks first');
select tests.act_as('super', 'aal2');
select is(public.admin_create_ranking_draft(jsonb_set((select j from tests.v where k = 'v1'), '{query}',
            '{"quality": 0, "proximity": 1, "availability": 0, "personal": 0, "proximity_scale_km": 3, "new_boost": 0, "new_boost_days": 60}'),
            'proximity only'), 3, 'draft v3: proximity-only');
select lives_ok($$ select public.admin_publish_ranking(3, 'proximity only') $$, 'publish v3');
select tests.as_anon();
select is((tests.names(public.search_businesses('beard', null, null, null, null, 33.8964, 35.4828)))[1], 'حلاق أبو علي',
  'proximity-only weights: nearest (Hamra) first');

-- ═══ zero-result log, admin tools ═══
select tests.as_postgres();
select is((select results_count from private.search_log where q = 'dentist' limit 1), 0, 'zero-result query logged');
select tests.act_as('ops', 'aal2');
select ok(exists (select 1 from jsonb_array_elements(public.admin_zero_result_queries()) x where x ->> 'q_key' = 'dentist'),
  'ops sees zero-result queries');
select ok((public.admin_search_debug('haircut') -> 'results' -> 0 -> 'debug' ->> 'rank_score') is not null, 'search debug shows score parts');
select tests.act_as('mod', 'aal2');
select throws_ok($$ select public.admin_zero_result_queries() $$, 'P0001', 'FORBIDDEN', 'moderator: no search analytics');

-- ═══ suggest, landing, home; refresh on change ═══
select tests.as_anon();
select is(public.search_suggest('bal') -> 'services' -> 0 ->> 'name', 'Balayage', 'suggest: service by prefix');
select ok(exists (select 1 from jsonb_array_elements(public.search_suggest('ham') -> 'areas') a where a ->> 'slug' = 'hamra'), 'suggest: areas');
select is(tests.names(public.get_landing('hamra', 'barber')), array['حلاق أبو علي'], 'SEO landing /hamra/barber');
select is(public.get_landing('hamra', 'dentists'), null, 'unknown landing → null (404)');
select tests.as_postgres();
update public.businesses set status = 'paused' where id = tests.id('abu');
select private.job_search_refresh(1000);
select ok(not exists (select 1 from public.search_documents where business_id = tests.id('abu')), 'paused business drops out after refresh');

select * from finish();
rollback;
