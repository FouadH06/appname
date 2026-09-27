-- M1 · Seed: Lebanese location hierarchy + launch clusters (production reference data)
-- Spec: Phase 3 Part 2 §3, locked decisions (launch clusters)
-- Centroids are approximate (±300 m) and are refined by ops in the Catalog screen (A8).

-- ─── Governorates (all 8) ──────────────────────────────────────────────────
insert into public.areas (level, slug, name_en, name_ar, name_fr, is_live) values
  ('governorate', 'beirut-governorate',          'Beirut',          'بيروت',        'Beyrouth',       true),
  ('governorate', 'mount-lebanon',               'Mount Lebanon',   'جبل لبنان',    'Mont-Liban',     true),
  ('governorate', 'north-lebanon',               'North',           'الشمال',       'Nord',           false),
  ('governorate', 'akkar',                       'Akkar',           'عكار',         'Akkar',          false),
  ('governorate', 'baalbek-hermel',              'Baalbek-Hermel',  'بعلبك الهرمل', 'Baalbek-Hermel', false),
  ('governorate', 'bekaa',                       'Bekaa',           'البقاع',       'Békaa',          false),
  ('governorate', 'south-lebanon',               'South',           'الجنوب',       'Sud',            false),
  ('governorate', 'nabatieh',                    'Nabatieh',        'النبطية',      'Nabatieh',       false);

-- ─── Districts needed by launch + next clusters ────────────────────────────
insert into public.areas (parent_id, level, slug, name_en, name_ar, name_fr, is_live)
select g.id, 'district', d.slug, d.name_en, d.name_ar, d.name_fr, d.is_live
from (values
  ('beirut-governorate', 'beirut',   'Beirut',   'بيروت',  'Beyrouth', true),
  ('mount-lebanon',      'baabda',   'Baabda',   'بعبدا',  'Baabda',   true),
  ('mount-lebanon',      'metn',     'Metn',     'المتن',  'Metn',     false),
  ('mount-lebanon',      'keserwan', 'Keserwan', 'كسروان', 'Kesrouan', false)
) as d(gov, slug, name_en, name_ar, name_fr, is_live)
join public.areas g on g.slug = d.gov;

-- ─── Areas ─────────────────────────────────────────────────────────────────
insert into public.areas (parent_id, level, slug, name_en, name_ar, name_fr, centroid, is_live)
select p.id, 'area', a.slug, a.name_en, a.name_ar, a.name_fr,
       extensions.st_setsrid(extensions.st_makepoint(a.lng, a.lat), 4326)::extensions.geography,
       a.is_live
from (values
  -- Cluster 1: Achrafieh / Mar Mikhael
  ('beirut',   'achrafieh',   'Achrafieh',   'الأشرفية',  'Achrafieh',   33.8869, 35.5208, true),
  ('beirut',   'mar-mikhael', 'Mar Mikhael', 'مار مخايل', 'Mar Mikhaël', 33.8975, 35.5254, true),
  ('beirut',   'gemmayzeh',   'Gemmayzeh',   'الجميزة',   'Gemmayzé',    33.8950, 35.5170, false),
  -- Cluster 2: Hamra / Verdun
  ('beirut',   'hamra',       'Hamra',       'الحمرا',    'Hamra',       33.8963, 35.4823, true),
  ('beirut',   'verdun',      'Verdun',      'فردان',     'Verdun',      33.8862, 35.4870, true),
  ('beirut',   'ras-beirut',  'Ras Beirut',  'رأس بيروت', 'Ras Beyrouth', 33.9004, 35.4780, false),
  -- Cluster 3: Hazmieh / Baabda
  ('baabda',   'hazmieh',     'Hazmieh',     'الحازمية',  'Hazmieh',     33.8550, 35.5400, true),
  ('baabda',   'baabda-town', 'Baabda',      'بعبدا',     'Baabda',      33.8339, 35.5442, true),
  -- Next cluster: Jounieh / Kaslik (not live)
  ('keserwan', 'jounieh',     'Jounieh',     'جونيه',     'Jounieh',     33.9808, 35.6178, false),
  ('keserwan', 'kaslik',      'Kaslik',      'الكسليك',   'Kaslik',      33.9750, 35.6140, false)
) as a(district, slug, name_en, name_ar, name_fr, lat, lng, is_live)
join public.areas p on p.slug = a.district;

-- ─── Aliases (spellings people actually type; Arabic without hamza variants) ─
insert into public.area_aliases (area_id, alias)
select ar.id, al.alias
from (values
  ('achrafieh',   'Ashrafieh'), ('achrafieh', 'Achrafiyeh'), ('achrafieh', 'Ashrafiye'),
  ('achrafieh',   'Achrafie'),  ('achrafieh', 'الاشرفية'),   ('achrafieh', 'اشرفية'),
  ('mar-mikhael', 'Mar Mkhayel'), ('mar-mikhael', 'Mar Mikhail'), ('mar-mikhael', 'Mar Michael'),
  ('mar-mikhael', 'مار مخايل'),
  ('gemmayzeh',   'Gemmayze'), ('gemmayzeh', 'Jemmayzeh'), ('gemmayzeh', 'الجميزه'),
  ('hamra',       'Hamra Street'), ('hamra', 'Al Hamra'), ('hamra', 'الحمراء'),
  ('verdun',      'Fardan'), ('verdun', 'Verdan'),
  ('ras-beirut',  'Ras Beyrouth'), ('ras-beirut', 'راس بيروت'),
  ('hazmieh',     'Hazmiyeh'), ('hazmieh', 'Hazmiye'), ('hazmieh', 'Hazmiyé'), ('hazmieh', 'الحازميه'),
  ('baabda-town', 'Baabda'),
  ('jounieh',     'Jounie'), ('jounieh', 'Juniyah'), ('jounieh', 'Jounié'),
  ('kaslik',      'Kaslick'), ('kaslik', 'Kaslik Jounieh')
) as al(slug, alias)
join public.areas ar on ar.slug = al.slug;

-- ─── Clusters ──────────────────────────────────────────────────────────────
insert into public.clusters (slug, name_en, name_ar, target_businesses, is_live, sort) values
  ('achrafieh-mar-mikhael', 'Achrafieh / Mar Mikhael', 'الأشرفية / مار مخايل', 20, true,  1),
  ('hamra-verdun',          'Hamra / Verdun',          'الحمرا / فردان',        20, true,  2),
  ('hazmieh-baabda',        'Hazmieh / Baabda',        'الحازمية / بعبدا',      20, true,  3),
  ('jounieh-kaslik',        'Jounieh / Kaslik',        'جونيه / الكسليك',       20, false, 4);

insert into public.cluster_areas (cluster_id, area_id)
select c.id, a.id
from (values
  -- Clusters contain exactly the areas named in the locked decisions. Neighbors
  -- (Gemmayzeh, Ras Beirut) exist as areas and can be added by ops later.
  ('achrafieh-mar-mikhael', 'achrafieh'), ('achrafieh-mar-mikhael', 'mar-mikhael'),
  ('hamra-verdun', 'hamra'), ('hamra-verdun', 'verdun'),
  ('hazmieh-baabda', 'hazmieh'), ('hazmieh-baabda', 'baabda-town'),
  ('jounieh-kaslik', 'jounieh'), ('jounieh-kaslik', 'kaslik')
) as m(cluster, area)
join public.clusters c on c.slug = m.cluster
join public.areas a on a.slug = m.area;
