-- M1 · Seed: Beauty & Grooming catalog (production reference data)
-- Spec: Phase 3 Part 2 §4, locked decisions (launch vertical + rating dimensions)
-- Ops extend synonyms from real zero-result searches (Admin A8).

-- ─── Categories ────────────────────────────────────────────────────────────
insert into public.categories (slug, name_en, name_ar, name_fr, icon, is_live, sort)
values ('beauty-grooming', 'Beauty & Grooming', 'التجميل والعناية', 'Beauté et soins', 'sparkles', true, 1);

insert into public.categories (parent_id, slug, name_en, name_ar, name_fr, icon, is_live,
                               allows_before_after_default, requires_consultation_default, sort)
select r.id, c.slug, c.name_en, c.name_ar, c.name_fr, c.icon, c.is_live, c.ba, c.consult, c.sort
from (values
  ('hair-salon',    'Hair Salon',       'صالون شعر',          'Salon de coiffure', 'scissors',  true,  true,  false, 1),
  ('barber',        'Barber',           'حلاق',               'Barbier',           'razor',     true,  true,  false, 2),
  ('nails',         'Nails',            'أظافر',              'Ongles',            'hand',      true,  true,  false, 3),
  ('lashes-brows',  'Lashes & Brows',   'رموش وحواجب',        'Cils et sourcils',  'eye',       true,  true,  false, 4),
  ('makeup',        'Makeup',           'مكياج',              'Maquillage',        'brush',     true,  true,  false, 5),
  ('spa',           'Spa & Massage',    'سبا ومساج',          'Spa et massage',    'leaf',      true,  false, false, 6),
  ('beauty-center', 'Beauty Center',    'مركز تجميل',         'Institut de beauté', 'flower',   true,  false, false, 7),
  ('aesthetics',    'Laser & Aesthetics', 'ليزر وتجميل',      'Laser et esthétique', 'zap',     false, false, true,  8)
) as c(slug, name_en, name_ar, name_fr, icon, is_live, ba, consult, sort)
cross join (select id from public.categories where slug = 'beauty-grooming') r;

-- ─── Rating dimensions (root category; subcategories inherit) ──────────────
insert into public.rating_dimensions (category_id, key, label_en, label_ar, label_fr, sort)
select r.id, d.key, d.label_en, d.label_ar, d.label_fr, d.sort
from (values
  ('service_quality',    'Service Quality',    'جودة الخدمة',     'Qualité du service',  1),
  ('cleanliness',        'Cleanliness',        'النظافة',         'Propreté',            2),
  ('punctuality',        'Punctuality',        'الالتزام بالموعد', 'Ponctualité',         3),
  ('staff_friendliness', 'Staff Friendliness', 'لطف الموظفين',    'Amabilité du personnel', 4),
  ('value_for_money',    'Value for Money',    'القيمة مقابل السعر', 'Rapport qualité-prix', 5),
  ('ambience',           'Ambience',           'الأجواء',         'Ambiance',            6)
) as d(key, label_en, label_ar, label_fr, sort)
cross join (select id from public.categories where slug = 'beauty-grooming') r;

-- ─── Canonical services ────────────────────────────────────────────────────
insert into public.canonical_services (category_id, slug, name_en, name_ar, name_fr,
                                       typical_duration_min, allows_before_after, relevance_hints, sort)
select c.id, s.slug, s.name_en, s.name_ar, s.name_fr, s.dur, s.ba, s.hints, s.sort
from (values
  -- Barber
  ('barber', 'mens-haircut',   'Men''s Haircut',      'قص شعر رجالي',   'Coupe homme',          30, true,  '{hair,haircut,hairstyle,head}'::text[], 1),
  ('barber', 'beard-trim',     'Beard Trim',          'تشذيب اللحية',   'Taille de barbe',      20, true,  '{beard,face,chin}'::text[], 2),
  ('barber', 'haircut-beard',  'Haircut + Beard',     'قص شعر ولحية',   'Coupe + barbe',        45, true,  '{hair,haircut,beard,face}'::text[], 3),
  ('barber', 'hot-towel-shave','Hot Towel Shave',     'حلاقة ذقن بالمنشفة الساخنة', 'Rasage à l''ancienne', 30, false, '{face,shave,beard}'::text[], 4),
  ('barber', 'kids-haircut',   'Kids Haircut',        'قص شعر أطفال',   'Coupe enfant',         20, false, '{hair,haircut,child}'::text[], 5),
  -- Hair salon
  ('hair-salon', 'womens-haircut', 'Women''s Haircut', 'قص شعر نسائي',  'Coupe femme',          45, true,  '{hair,haircut,hairstyle}'::text[], 1),
  ('hair-salon', 'blow-dry',       'Blow-dry',         'سشوار',          'Brushing',             40, true,  '{hair,hairstyle,blowout}'::text[], 2),
  ('hair-salon', 'hair-color',     'Hair Color',       'صبغة شعر',       'Coloration',           90, true,  '{hair,hair color,dye}'::text[], 3),
  ('hair-salon', 'highlights',     'Highlights',       'ميش',            'Mèches',              120, true,  '{hair,hair color,highlights}'::text[], 4),
  ('hair-salon', 'balayage',       'Balayage',         'بالياج',         'Balayage',            150, true,  '{hair,hair color,balayage}'::text[], 5),
  ('hair-salon', 'keratin',        'Keratin Treatment','كيراتين',        'Lissage kératine',    150, true,  '{hair,straight hair}'::text[], 6),
  ('hair-salon', 'hair-treatment', 'Hair Treatment',   'علاج الشعر',     'Soin capillaire',      45, false, '{hair}'::text[], 7),
  ('hair-salon', 'updo',           'Updo / Hairstyling','تسريحة',        'Chignon / coiffure',   60, true,  '{hair,hairstyle,updo}'::text[], 8),
  -- Nails
  ('nails', 'manicure',        'Manicure',          'مانيكور',        'Manucure',             30, true,  '{hands,nails,fingers}'::text[], 1),
  ('nails', 'gel-manicure',    'Gel Manicure',      'مانيكور جل',     'Vernis semi-permanent', 45, true, '{hands,nails,fingers,gel polish}'::text[], 2),
  ('nails', 'pedicure',        'Pedicure',          'باديكير',        'Pédicure',             45, true,  '{feet,toenails,toes}'::text[], 3),
  ('nails', 'nail-extensions', 'Nail Extensions',   'تركيب أظافر',    'Extensions d''ongles',  75, true,  '{hands,nails,fingers,acrylic}'::text[], 4),
  ('nails', 'nail-art',        'Nail Art',          'رسم على الأظافر','Nail art',             30, true,  '{hands,nails,nail art}'::text[], 5),
  -- Lashes & brows
  ('lashes-brows', 'lash-extensions', 'Lash Extensions', 'تركيب رموش',  'Extensions de cils',   90, true, '{eyes,eyelashes,face}'::text[], 1),
  ('lashes-brows', 'lash-lift',       'Lash Lift',       'رفع الرموش',  'Rehaussement de cils', 45, true, '{eyes,eyelashes,face}'::text[], 2),
  ('lashes-brows', 'brow-shaping',    'Eyebrow Shaping', 'تحديد الحواجب','Épilation des sourcils', 15, true, '{eyebrows,face}'::text[], 3),
  ('lashes-brows', 'brow-tint',       'Brow Tint',       'صبغة الحواجب','Teinture des sourcils', 20, true, '{eyebrows,face}'::text[], 4),
  ('lashes-brows', 'brow-lamination', 'Brow Lamination', 'لاميناشن الحواجب', 'Restructuration des sourcils', 45, true, '{eyebrows,face}'::text[], 5),
  -- Makeup
  ('makeup', 'event-makeup',  'Event Makeup',  'مكياج سهرة',  'Maquillage soirée',  60, true, '{face,makeup}'::text[], 1),
  ('makeup', 'bridal-makeup', 'Bridal Makeup', 'مكياج عروس',  'Maquillage mariée', 120, true, '{face,makeup,bride}'::text[], 2),
  -- Spa
  ('spa', 'massage',      'Massage',        'مساج',          'Massage',          60, false, '{}'::text[], 1),
  ('spa', 'facial',       'Facial',         'تنظيف بشرة',    'Soin du visage',   60, false, '{face,skin}'::text[], 2),
  ('spa', 'moroccan-bath','Moroccan Bath',  'حمام مغربي',    'Hammam marocain',  60, false, '{}'::text[], 3),
  -- Beauty center
  ('beauty-center', 'waxing',         'Waxing',         'شمع',          'Épilation à la cire', 30, false, '{}'::text[], 1),
  ('beauty-center', 'face-threading', 'Face Threading', 'خيط للوجه',    'Épilation au fil',    15, false, '{face}'::text[], 2),
  -- Aesthetics (category hidden until launched carefully)
  ('aesthetics', 'laser-hair-removal', 'Laser Hair Removal', 'إزالة الشعر بالليزر', 'Épilation laser', 30, false, '{}'::text[], 1)
) as s(cat, slug, name_en, name_ar, name_fr, dur, ba, hints, sort)
join public.categories c on c.slug = s.cat;

-- Fallback so services.canonical_service_id can stay NOT NULL while a mapping is pending (Part 2 §4)
insert into public.canonical_services (category_id, slug, name_en, name_ar, name_fr, sort)
select id, 'other-beauty-grooming', 'Other (pending review)', 'أخرى (قيد المراجعة)', 'Autre (en attente)', 999
from public.categories where slug = 'beauty-grooming';

-- ─── Synonyms ──────────────────────────────────────────────────────────────
-- Official names (EN/AR/FR) at weight 1.0 for every canonical service
insert into public.service_synonyms (canonical_service_id, term, lang, weight)
select id, name_en, 'en'::public.synonym_lang, 1.0 from public.canonical_services where slug <> 'other-beauty-grooming'
union all
select id, name_ar, 'ar'::public.synonym_lang, 1.0 from public.canonical_services where slug <> 'other-beauty-grooming'
union all
select id, name_fr, 'fr'::public.synonym_lang, 1.0 from public.canonical_services
 where slug <> 'other-beauty-grooming' and name_fr is not null and lower(name_fr) <> lower(name_en)
on conflict (canonical_service_id, term) do nothing;

-- Colloquial / Arabizi / alternate spellings
insert into public.service_synonyms (canonical_service_id, term, lang, weight)
select cs.id, v.term, v.lang::public.synonym_lang, v.weight
from (values
  ('mens-haircut', 'haircut', 'en', 0.9), ('mens-haircut', 'barber', 'en', 0.7),
  ('mens-haircut', 'حلاق', 'ar', 0.7), ('mens-haircut', 'قص شعر', 'ar', 0.9),
  ('mens-haircut', '7ala2', 'arabizi', 0.7), ('mens-haircut', '2as sha3er', 'arabizi', 0.9),
  ('mens-haircut', 'coiffeur homme', 'fr', 0.8), ('mens-haircut', 'fade', 'en', 0.6),
  ('beard-trim', 'beard', 'en', 0.9), ('beard-trim', 'lehye', 'arabizi', 0.8),
  ('beard-trim', 'da2en', 'arabizi', 0.8), ('beard-trim', 'دقن', 'ar', 0.8), ('beard-trim', 'barbe', 'fr', 0.8),
  ('haircut-beard', 'hair and beard', 'en', 0.9), ('haircut-beard', 'sha3er w da2en', 'arabizi', 0.8),
  ('hot-towel-shave', 'shave', 'en', 0.9), ('hot-towel-shave', 'حلاقة', 'ar', 0.7),
  ('womens-haircut', 'haircut', 'en', 0.8), ('womens-haircut', 'coupe', 'fr', 0.8),
  ('womens-haircut', '2as', 'arabizi', 0.6), ('womens-haircut', 'coiffeur', 'fr', 0.6),
  ('blow-dry', 'brushing', 'en', 1.0), ('blow-dry', 'blowout', 'en', 0.9), ('blow-dry', 'blow dry', 'en', 1.0),
  ('blow-dry', 'seshwar', 'arabizi', 0.9), ('blow-dry', 'sechwar', 'arabizi', 0.9), ('blow-dry', 'سشوار', 'ar', 1.0),
  ('hair-color', 'color', 'en', 0.9), ('hair-color', 'colour', 'en', 0.9), ('hair-color', 'dye', 'en', 0.8),
  ('hair-color', 'sab8a', 'arabizi', 0.9), ('hair-color', 'sabgha', 'arabizi', 0.9), ('hair-color', 'صبغة', 'ar', 1.0),
  ('hair-color', 'couleur', 'fr', 0.8), ('hair-color', 'teinture', 'fr', 0.8),
  ('highlights', 'meche', 'fr', 0.9), ('highlights', 'mesh', 'arabizi', 0.9), ('highlights', 'meches', 'fr', 0.9),
  ('balayage', 'balyage', 'en', 0.9), ('balayage', 'balayaj', 'arabizi', 0.9), ('balayage', 'ombre', 'en', 0.6),
  ('keratin', 'keratine', 'fr', 0.9), ('keratin', 'lissage', 'fr', 0.8), ('keratin', 'protein', 'en', 0.6),
  ('keratin', 'botox cheveux', 'fr', 0.6), ('keratin', 'hair botox', 'en', 0.6),
  ('updo', 'chignon', 'fr', 0.9), ('updo', 'tasri7a', 'arabizi', 0.9), ('updo', 'hairdo', 'en', 0.8),
  ('manicure', 'nails', 'en', 0.8), ('manicure', 'manucure', 'fr', 1.0), ('manicure', 'manikir', 'arabizi', 0.9),
  ('manicure', 'manicur', 'arabizi', 0.9), ('manicure', 'ضوافر', 'ar', 0.7), ('manicure', 'اظافر', 'ar', 0.7),
  ('gel-manicure', 'gel', 'en', 0.9), ('gel-manicure', 'semi permanent', 'en', 0.9),
  ('gel-manicure', 'vernis semi permanent', 'fr', 1.0), ('gel-manicure', 'shellac', 'en', 0.8),
  ('pedicure', 'pedi', 'en', 0.8), ('pedicure', 'padikir', 'arabizi', 0.9), ('pedicure', 'pedicur', 'arabizi', 0.9),
  ('nail-extensions', 'acrylic', 'en', 0.9), ('nail-extensions', 'gel extensions', 'en', 0.9),
  ('nail-extensions', 'faux ongles', 'fr', 0.8), ('nail-extensions', 'tarkib ada3er', 'arabizi', 0.7),
  ('lash-extensions', 'lashes', 'en', 0.9), ('lash-extensions', 'extensions cils', 'fr', 0.9),
  ('lash-extensions', 'rmoush', 'arabizi', 0.8), ('lash-extensions', 'رموش', 'ar', 0.9),
  ('lash-lift', 'lash lifting', 'en', 1.0), ('lash-lift', 'rehaussement', 'fr', 0.8),
  ('brow-shaping', 'eyebrows', 'en', 0.9), ('brow-shaping', 'threading', 'en', 0.8),
  ('brow-shaping', '7awajeb', 'arabizi', 0.9), ('brow-shaping', 'حواجب', 'ar', 0.9), ('brow-shaping', 'sourcils', 'fr', 0.9),
  ('brow-lamination', 'lamination', 'en', 0.9),
  ('event-makeup', 'makeup', 'en', 0.9), ('event-makeup', 'make up', 'en', 0.9), ('event-makeup', 'mekyaj', 'arabizi', 0.9),
  ('event-makeup', 'makiyaj', 'arabizi', 0.9), ('event-makeup', 'مكياج', 'ar', 0.9), ('event-makeup', 'maquillage', 'fr', 0.9),
  ('bridal-makeup', 'bride', 'en', 0.8), ('bridal-makeup', '3arous', 'arabizi', 0.9), ('bridal-makeup', 'عروس', 'ar', 0.9),
  ('bridal-makeup', 'mariee', 'fr', 0.9), ('bridal-makeup', 'wedding makeup', 'en', 1.0),
  ('massage', 'masaj', 'arabizi', 0.9), ('massage', 'massaj', 'arabizi', 0.9), ('massage', 'مساج', 'ar', 1.0),
  ('facial', 'tanzif bashra', 'arabizi', 0.9), ('facial', 'skin care', 'en', 0.7), ('facial', 'hydrafacial', 'en', 0.7),
  ('facial', 'soin visage', 'fr', 0.9), ('facial', 'تنظيف', 'ar', 0.7),
  ('moroccan-bath', 'hammam', 'en', 0.9), ('moroccan-bath', '7ammam maghribi', 'arabizi', 0.9),
  ('waxing', 'wax', 'en', 0.9), ('waxing', 'sham3', 'arabizi', 0.9), ('waxing', 'cire', 'fr', 0.8),
  ('waxing', 'epilation', 'fr', 0.7), ('waxing', 'حلاوة', 'ar', 0.6), ('waxing', 'halawa', 'arabizi', 0.6),
  ('face-threading', 'threading', 'en', 0.9), ('face-threading', '5ayt', 'arabizi', 0.9), ('face-threading', 'خيط', 'ar', 0.9),
  ('laser-hair-removal', 'laser', 'en', 1.0), ('laser-hair-removal', 'ليزر', 'ar', 1.0),
  ('laser-hair-removal', 'epilation laser', 'fr', 1.0)
) as v(slug, term, lang, weight)
join public.canonical_services cs on cs.slug = v.slug
on conflict (canonical_service_id, term) do nothing;
