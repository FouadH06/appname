-- M12 search review + performance on a generated, launch-like dataset. LOCAL STACK ONLY.
-- Everything runs in one transaction and is rolled back (no data is left behind).
--   docker cp supabase/tests/helpers <db-container>:/tmp/helpers && docker cp scripts/search-review.sql <db-container>:/tmp/
--   docker exec -w /tmp <db-container> psql -U postgres -v scale=1 -f /tmp/search-review.sql
-- scale 1 ≈ 100 businesses (launch); scale 10 ≈ 1,000 (headroom check).
\set ON_ERROR_STOP 1
\pset pager off
begin;
set local client_min_messages = warning;
\ir helpers/fixtures.psql
\ir helpers/search_dataset.psql
select tests.search_dataset(:scale) as businesses;

create temp table review_q (n int, q text, cluster text, filters jsonb, sort text);
insert into review_q values
 (1, 'haircut', 'hamra-verdun', '{}', 'recommended'),
 (2, 'barber', 'achrafieh-mar-mikhael', '{}', 'recommended'),
 (3, '7ala2', 'hazmieh-baabda', '{}', 'recommended'),
 (4, 'حلاق', 'hamra-verdun', '{}', 'recommended'),
 (5, 'coiffeur homme', null, '{}', 'recommended'),
 (6, 'balayage', 'achrafieh-mar-mikhael', '{}', 'recommended'),
 (7, 'balayage hamra', null, '{}', 'recommended'),
 (8, 'بالياج', null, '{}', 'recommended'),
 (9, 'manicure', 'hamra-verdun', '{}', 'recommended'),
 (10, 'manucure', 'hamra-verdun', '{}', 'recommended'),
 (11, 'gel nails', 'hazmieh-baabda', '{}', 'recommended'),
 (12, 'pedicure achrafieh', null, '{}', 'recommended'),
 (13, 'lash extensions', 'achrafieh-mar-mikhael', '{}', 'recommended'),
 (14, 'eyebrows', 'hamra-verdun', '{}', 'recommended'),
 (15, 'makeup', 'hazmieh-baabda', '{}', 'recommended'),
 (16, 'bridal makeup', null, '{}', 'recommended'),
 (17, 'مكياج', 'achrafieh-mar-mikhael', '{}', 'recommended'),
 (18, 'massage', 'hamra-verdun', '{}', 'recommended'),
 (19, 'hammam', null, '{}', 'recommended'),
 (20, 'facial hazmieh', null, '{}', 'recommended'),
 (21, 'waxing', 'achrafieh-mar-mikhael', '{}', 'recommended'),
 (22, 'threading', 'hamra-verdun', '{}', 'recommended'),
 (23, 'Fade District', null, '{}', 'recommended'),
 (24, 'salon rita', null, '{}', 'recommended'),
 (25, 'صالون ليلى', null, '{}', 'recommended'),
 (26, 'keratin', 'hazmieh-baabda', '{}', 'recommended'),
 (27, 'beard trim verdun', null, '{}', 'recommended'),
 (28, 'nails', 'achrafieh-mar-mikhael', '{"available_today": true}', 'recommended'),
 (29, 'haircut', 'hamra-verdun', '{"min_rating": 4.5}', 'rating'),
 (30, 'hair color', 'achrafieh-mar-mikhael', '{}', 'price'),
 (31, 'dentist', null, '{}', 'recommended'),
 (32, 'kids haircut', 'hazmieh-baabda', '{}', 'soonest');

\echo '═══ 32 representative queries: intent, total, top 3 (name · area · rating · quality · price/next) ═══'
select r.n, r.q, coalesce(r.cluster, 'all') as cluster, r.sort, (x -> 'intent' ->> 'not_offered')::boolean as not_offered,
       (x ->> 'total')::int as total,
       (select string_agg(format('%s · %s · %s★(%s) · q%s%s', c ->> 'name', c ->> 'area', coalesce(c ->> 'display_rating', 'new'), c ->> 'review_count',
                                 (select round(quality_score) from public.search_documents d where d.location_id = (c ->> 'location_id')::uuid),
                                 case when jsonb_typeof(c -> 'service') = 'object' then ' · $' || coalesce(c -> 'service' ->> 'min', '?') else '' end), E'\n      ' order by o)
        from jsonb_array_elements(x -> 'results') with ordinality t(c, o) where o <= 3) as top3
from review_q r
cross join lateral (select public.search_businesses(r.q, null, null, (select id from public.clusters where slug = r.cluster), null, null, null,
                                                   r.filters, r.sort) x) s
order by r.n;

\echo '═══ Suggest ═══'
select q, public.search_suggest(q) -> 'services' -> 0 ->> 'name' as first_service,
       jsonb_array_length(public.search_suggest(q) -> 'businesses') as businesses,
       jsonb_array_length(public.search_suggest(q) -> 'areas') as areas
from unnest(array['bal', 'ma', '7al', 'حل', 'fade', 'ham', 'mani']) q;

\echo '═══ Latency (ms): every query × 10, plus suggest and home ═══'
create temp table lat (kind text, ms numeric);
do $$
declare r record; i int; t0 timestamptz; c uuid;
begin
  for i in 1 .. 10 loop
    for r in select * from review_q loop
      c := (select id from public.clusters where slug = r.cluster);
      t0 := clock_timestamp();
      perform public.search_businesses(r.q, null, null, c, null, null, null, r.filters, r.sort);
      insert into lat values ('search', extract(epoch from clock_timestamp() - t0) * 1000);
      t0 := clock_timestamp();
      perform public.search_suggest(left(r.q, 3), c);
      insert into lat values ('suggest', extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
    t0 := clock_timestamp();
    perform public.get_home((select id from public.clusters where slug = 'hamra-verdun'));
    insert into lat values ('home', extract(epoch from clock_timestamp() - t0) * 1000);
    -- bounded availability engine: date + time window on the top 40
    t0 := clock_timestamp();
    perform public.search_businesses('haircut', null, null, (select id from public.clusters where slug = 'hamra-verdun'), null, null, null,
      jsonb_build_object('date', (now() at time zone 'Asia/Beirut')::date + 1, 'time_from', '16:00', 'time_to', '19:00'), 'recommended');
    insert into lat values ('search+date', extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
end $$;
select kind, count(*) as n, round(percentile_cont(0.5) within group (order by ms)::numeric, 1) as p50,
       round(percentile_cont(0.95) within group (order by ms)::numeric, 1) as p95, round(max(ms), 1) as max
from lat group by kind order by kind;
select (select count(*) from public.search_documents) as documents;
rollback;
