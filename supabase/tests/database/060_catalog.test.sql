-- Phase 3 Part 2 §3–4 (seed), Part 6 §3.1 (reference data RLS)
begin;
create extension if not exists pgtap with schema extensions;
-- Hosted sessions (CLI login role) do not have extensions on search_path; be explicit.
set local search_path = extensions, public;
-- Run as postgres everywhere (hosted CLI connects as a temporary login role).
set local role postgres;
select plan(18);

-- ─── test helpers ───
create schema tests;
grant usage on schema tests to anon, authenticated;
create table tests.ids (name text primary key, id uuid not null);
grant select on tests.ids to anon, authenticated;
create function tests.id(p_name text) returns uuid language sql stable as
  $$ select id from tests.ids where name = p_name $$;
create function tests.new_user(p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, created_at, updated_at) values (v, 'authenticated', 'authenticated', now(), now());
  insert into tests.ids values (p_name, v);
  return v;
end $$;
create function tests.act_as(p_name text, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.id(p_name), 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on all functions in schema tests to anon, authenticated;

select tests.new_user('customer');
select tests.new_user('ops');
insert into public.admin_users (user_id, role) values (tests.id('ops'), 'ops');

-- ─── seed integrity ───
select is((select count(*)::int from public.areas where level = 'governorate'), 8, '8 governorates');
select is((select count(*)::int from public.clusters where is_live), 3, '3 live launch clusters');
select is(
  (select array_agg(c.slug::text || '=' || a.slug::text order by c.slug, a.slug)
   from public.cluster_areas ca join public.clusters c on c.id = ca.cluster_id join public.areas a on a.id = ca.area_id
   where c.is_live),
  array['achrafieh-mar-mikhael=achrafieh', 'achrafieh-mar-mikhael=mar-mikhael',
        'hamra-verdun=hamra', 'hamra-verdun=verdun',
        'hazmieh-baabda=baabda-town', 'hazmieh-baabda=hazmieh'],
  'live clusters contain exactly the locked areas');
select ok(not exists (select 1 from public.areas where level = 'area' and centroid is null),
  'every seeded area has a centroid');
select is(
  (select array_agg(rd.key order by rd.sort) from public.rating_dimensions rd
   join public.categories c on c.id = rd.category_id where c.slug = 'beauty-grooming'),
  array['service_quality', 'cleanliness', 'punctuality', 'staff_friendliness', 'value_for_money', 'ambience'],
  'beauty rating dimensions (locked)');
select cmp_ok((select count(*)::int from public.canonical_services where is_active), '>=', 30,
  'at least 30 canonical services');
select ok(not exists (
  select 1 from public.canonical_services cs where cs.slug <> 'other-beauty-grooming'
    and (not exists (select 1 from public.service_synonyms s where s.canonical_service_id = cs.id and s.lang = 'ar')
      or not exists (select 1 from public.service_synonyms s where s.canonical_service_id = cs.id and s.lang = 'en'))),
  'every canonical service has EN and AR synonyms');
select ok(exists (select 1 from public.canonical_services where slug = 'other-beauty-grooming'),
  'fallback canonical service exists');

-- ─── anon reads ───
select set_config('role', 'anon', true);
select ok(exists (select 1 from public.canonical_services where slug = 'balayage'), 'anon reads active services');
select ok(not exists (select 1 from public.categories where slug = 'aesthetics'), 'anon cannot see unlaunched category');
select throws_ok($$ insert into public.service_synonyms (canonical_service_id, term, lang)
                    select id, 'x', 'en' from public.canonical_services limit 1 $$,
  '42501', null, 'anon cannot write catalog');
set local role postgres;

-- ─── authenticated non-admin ───
select tests.act_as('customer', 'aal2');
select throws_ok($$ insert into public.service_synonyms (canonical_service_id, term, lang)
                    select id, 'hack', 'en' from public.canonical_services where slug = 'balayage' $$,
  '42501', null, 'customer cannot write catalog');
set local role postgres;

-- ─── ops admin (M11: catalog writes only through audited admin RPCs) ───
select tests.act_as('ops', 'aal1');
select throws_ok($$ select public.admin_add_synonym((select id from public.canonical_services where slug = 'balayage'),
                                                    'balayage libanais', 'fr', 'zero-result query') $$,
  'P0001', 'FORBIDDEN', 'ops without MFA (aal1) cannot edit the catalog');
set local role postgres;
select tests.act_as('ops', 'aal2');
select throws_ok($$ insert into public.service_synonyms (canonical_service_id, term, lang)
                    select id, 'balayage libanais', 'fr' from public.canonical_services where slug = 'balayage' $$,
  '42501', null, 'no direct table writes, even for ops (no reason code, no admin audit row)');
select lives_ok($$ select public.admin_add_synonym((select id from public.canonical_services where slug = 'balayage'),
                                                   'balayage libanais', 'fr', 'zero-result query') $$,
  'ops with aal2 adds a synonym through the RPC');
select ok(exists (select 1 from public.categories where slug = 'aesthetics'), 'ops sees unlaunched category');
set local role postgres;
select is(
  (select actor_kind::text from audit.entity_changes
   where table_name = 'public.service_synonyms' and changed ->> 'term' = 'balayage libanais'),
  'admin', 'catalog edit audited as admin');
select is(
  (select term_normalized from public.service_synonyms where term = 'balayage libanais'),
  'balayage libanais', 'generated search key populated');

select * from finish();
rollback;
