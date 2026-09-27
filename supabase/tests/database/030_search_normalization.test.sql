-- Phase 3 Part 5 §1 + Part 7 §9 #53 — normalization, Arabizi folding, synonym & alias matching
begin;
create extension if not exists pgtap with schema extensions;
-- Hosted sessions (CLI login role) do not have extensions on search_path; be explicit.
set local search_path = extensions, public;
-- Run as postgres everywhere (hosted CLI connects as a temporary login role).
set local role postgres;
select plan(18);

-- normalize_text
select is(private.normalize_text('الأشرفية'),   'الاشرفيه', 'alef-hamza → alef, ta marbuta → ha');
select is(private.normalize_text('إلى آخر'),    'الي اخر',  'alef forms and alef maqsura');
select is(private.normalize_text('مُسَاج'),       'مساج',     'harakat removed');
select is(private.normalize_text('مـــساج'),     'مساج',     'tatweel removed');
select is(private.normalize_text('Épilation'),  'epilation', 'French accents removed, lowercased');
select is(private.normalize_text('  Blow   Dry '), 'blow dry', 'whitespace collapsed');
select is(private.normalize_text('٠٣'),          '03',        'Arabic-Indic digits');

-- arabizi_fold / search_key
select is(private.search_key('7ala2'),       'hala',     '7ala2 → hala');
select is(private.search_key('2as sha3er'),  'as shaer', '2as sha3er → as shaer');
select is(private.search_key('Mekkyaj'),     'mekyaj',   'doubled letters collapsed');
select is(private.search_key('5ayt'),        'khayt',    '5 → kh');
select is(private.search_key('sab8a'),       'sabgha',   '8 → gh');
select is(private.search_key('حلاق'),        'حلاق',     'Arabic tokens untouched by folding');

-- synonym matching (seed data)
select ok(exists (
  select 1 from public.service_synonyms s join public.canonical_services c on c.id = s.canonical_service_id
  where c.slug = 'mens-haircut' and s.term_normalized = private.search_key('7ala2')),
  'Arabizi "7ala2" matches the men''s haircut synonym');
select ok(exists (
  select 1 from public.service_synonyms s join public.canonical_services c on c.id = s.canonical_service_id
  where c.slug = 'blow-dry' and s.term_normalized = private.search_key('BRUSHING')),
  '"BRUSHING" matches blow-dry');
select ok(exists (
  select 1 from public.service_synonyms s join public.canonical_services c on c.id = s.canonical_service_id
  where c.slug = 'manicure' and extensions.similarity(s.term_normalized, private.search_key('manicur')) > 0.5),
  'misspelling "manicur" fuzzy-matches manicure');

-- area alias matching
select ok(exists (
  select 1 from public.area_aliases al join public.areas a on a.id = al.area_id
  where a.slug = 'achrafieh' and al.alias_normalized = private.search_key('ASHRAFIEH')),
  '"ASHRAFIEH" matches Achrafieh');
select ok(exists (
  select 1 from public.area_aliases al join public.areas a on a.id = al.area_id
  where a.slug = 'achrafieh' and al.alias_normalized = private.search_key('الأشرفية')),
  '"الأشرفية" (with hamza) matches the alias written without it');

select * from finish();
rollback;
