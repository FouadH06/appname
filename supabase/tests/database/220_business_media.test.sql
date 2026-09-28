-- M5 · business media: registration rules, one cover, portfolio cap, staff photos, removal, isolation
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(14);

select tests.new_user('owner_a');  select tests.new_user('recep_a');  select tests.new_user('staff_a');
select tests.new_user('owner_b');
select tests.new_business('biz_a', 'owner_a');
select tests.new_business('biz_b', 'owner_b');
select tests.add_member('biz_a', 'recep_a', 'reception');
select tests.add_member('biz_a', 'staff_a', 'staff');
select tests.new_staff('biz_a', 'Karim');

create function tests.path(p_biz text, p_file text) returns text language sql stable as
  $$ select tests.id(p_biz)::text || '/' || p_file $$;
grant execute on all functions in schema tests to authenticated;

-- ═══ registration rules ═══
select tests.act_as('owner_a');
select throws_ok($$ select public.register_business_media(tests.id('biz_a'), 'elsewhere/cover.jpg', 'cover', 'image/jpeg') $$,
  'P0001', 'INVALID_PATH', 'files must live under the business folder');
select throws_ok($$ select public.register_business_media(tests.id('biz_a'), tests.path('biz_b', 'x.jpg'), 'cover', 'image/jpeg') $$,
  'P0001', 'INVALID_PATH', 'another business''s folder is refused');
select tests.act_as('staff_a');
select throws_ok($$ select public.register_business_media(tests.id('biz_a'), tests.path('biz_a', 's.jpg'), 'portfolio', 'image/jpeg') $$,
  'P0001', 'FORBIDDEN', 'the staff role cannot manage business photos');

-- ═══ one current cover ═══
select tests.act_as('recep_a');
select lives_ok($$ select public.register_business_media(tests.id('biz_a'), tests.path('biz_a', 'cover1.jpg'), 'cover', 'image/jpeg', 100, 1200, 800) $$,
  'reception uploads a cover');
select tests.act_as('owner_a');
select lives_ok($$ select public.register_business_media(tests.id('biz_a'), tests.path('biz_a', 'cover2.jpg'), 'cover', 'image/jpeg') $$,
  'owner replaces it');
select tests.as_postgres();
select results_eq(
  $$ select count(*) filter (where state = 'approved')::int, count(*) filter (where state = 'removed')::int
     from public.business_media where business_id = tests.id('biz_a') and kind = 'cover' $$,
  $$ values (1, 1) $$, 'exactly one current cover; the old one is removed');

-- ═══ portfolio cap ═══
select tests.act_as('owner_a');
select lives_ok($$ select public.register_business_media(tests.id('biz_a'), tests.path('biz_a', 'p' || g || '.jpg'), 'portfolio', 'image/jpeg')
                   from generate_series(1, 10) g $$, 'ten portfolio photos');
select throws_ok($$ select public.register_business_media(tests.id('biz_a'), tests.path('biz_a', 'p11.jpg'), 'portfolio', 'image/jpeg') $$,
  'P0001', 'PORTFOLIO_FULL', 'the eleventh is refused (Phase 2: up to 10)');
select lives_ok($$ select public.reorder_business_media(tests.id('biz_a'),
                     array(select id from public.business_media where business_id = tests.id('biz_a') and kind = 'portfolio' order by sort desc)) $$,
  'portfolio can be reordered');

-- ═══ staff photo ═══
select lives_ok($$ select public.register_business_media(tests.id('biz_a'), tests.path('biz_a', 'karim.jpg'), 'staff_photo', 'image/jpeg', null, null, null, tests.id('Karim')) $$,
  'staff photo');
select tests.as_postgres();
select is((select m.kind::text from public.staff_members s join public.business_media m on m.id = s.photo_media_id where s.id = tests.id('Karim')),
  'staff_photo', 'linked to the staff profile');
select tests.act_as('owner_a');
select is(public.remove_business_media((select photo_media_id from public.staff_members where id = tests.id('Karim'))),
  tests.path('biz_a', 'karim.jpg'), 'removing returns the storage path for deletion');
select tests.as_postgres();
select ok((select photo_media_id is null from public.staff_members where id = tests.id('Karim')), 'staff photo unlinked');

-- ═══ isolation ═══
select tests.act_as('owner_b');
select is((select count(*)::int from public.business_media where business_id = tests.id('biz_a')), 0,
  'another business cannot see these media rows');
select tests.as_postgres();

select * from finish();
rollback;
