-- M5 · customer list (B6) + notes: search, projection per role, duplicates, isolation
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(18);

select tests.new_user('owner');  select tests.new_user('recep');  select tests.new_user('staff_user');
select tests.new_user('other_owner');
select tests.new_user('moe', '96170111111');
select tests.new_business('biz', 'owner');
select tests.new_business('other', 'other_owner');
select tests.add_member('biz', 'recep', 'reception');
select tests.add_member('biz', 'staff_user', 'staff');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim', 'staff_user');
select tests.new_staff('biz', 'Maya');
select tests.new_service('biz', 'Cut');
select tests.link('biz', 'Karim', 'Cut');  select tests.link('biz', 'Maya', 'Cut');

select tests.customer_record('mohammad', 'biz', 'Mohammad Haddad', '+96170111111', 'moe');
select tests.customer_record('lina', 'biz', 'Lina Khoury', '+96103123456');
select tests.customer_record('rami', 'biz', 'Rami Aoun', '+96171222333');
select tests.visit('m1', 'biz', 'Maya', 'Cut', 'mohammad', tests.at(tests.day(-5), '10:00'));
select tests.visit('l_up', 'biz', 'Karim', 'Cut', 'lina', tests.at(tests.day(2), '11:00'), 'confirmed');
select private.recompute_business_customer_stats(tests.id('mohammad'));

-- ═══ search ═══
select tests.act_as('owner');
select is((select array_agg(display_name) from public.biz_search_customers(tests.id('biz'), 'lina')), array['Lina Khoury'], 'by name');
select is((select array_agg(display_name) from public.biz_search_customers(tests.id('biz'), '71 222')), array['Rami Aoun'], 'by phone digits');
select is((select array_agg(display_name) from public.biz_search_customers(tests.id('biz'), '03 123 456')), array['Lina Khoury'],
  'Lebanese local format (trunk 0 dropped)');
select is((select array_agg(display_name) from public.biz_search_customers(tests.id('biz'), 'حداد')), null::text[],
  'unknown text finds nothing (no error)');
select results_eq(
  $$ select visit_count, lifetime_spend, reliability_label, is_claimed, total_count
     from public.biz_search_customers(tests.id('biz'), 'moham') $$,
  $$ values (1, 20.00::numeric, 'new_customer', true, 1::bigint) $$, 'owner sees stats, spend and the coarse label');

-- ═══ projection by role ═══
select tests.act_as('recep');
select ok((select bool_and(lifetime_spend is null) from public.biz_search_customers(tests.id('biz'))), 'reception: no spend by default');
select tests.as_postgres();
update public.business_settings set reception_sees_revenue = true where business_id = tests.id('biz');
select tests.act_as('recep');
select ok((select lifetime_spend is not null from public.biz_search_customers(tests.id('biz'), 'moham')), 'reception sees spend when enabled');
select tests.act_as('staff_user');
select results_eq($$ select display_name, phone_e164, lifetime_spend, reliability_label from public.biz_search_customers(tests.id('biz')) $$,
                  $$ values ('Lina Khoury', null::text, null::numeric, null::text) $$,
  'staff: only customers with an upcoming booking with them; no phone, spend or label');
select tests.act_as('other_owner');
select throws_ok($$ select * from public.biz_search_customers(tests.id('biz')) $$, 'P0001', 'FORBIDDEN', 'another business is refused');

-- ═══ add / edit ═══
select tests.act_as('recep');
select lives_ok($$ select public.biz_upsert_customer(tests.id('biz'), 'Sara', '76 555 444') $$, 'reception adds a customer');
select throws_ok($$ select public.biz_upsert_customer(tests.id('biz'), 'Sara again', '+96176555444') $$, 'P0001', 'DUPLICATE_CUSTOMER',
  'same phone at this business → duplicate (UI offers to open the existing one)');
select throws_ok($$ select public.biz_upsert_customer(tests.id('biz'), 'X', 'abc') $$, 'P0001', 'INVALID_PHONE', 'invalid phone');
select lives_ok($$ select public.biz_upsert_customer(tests.id('biz'), 'Rami A.', '71 222 333', tests.id('rami')) $$,
  'edit keeps its own phone');
select tests.act_as('staff_user');
select throws_ok($$ select public.biz_upsert_customer(tests.id('biz'), 'Nope') $$, 'P0001', 'FORBIDDEN', 'staff cannot add customers');

-- ═══ notes ═══
select tests.act_as('recep');
create temp table n (id uuid);
grant all on n to authenticated;
insert into n select public.biz_add_note(tests.id('biz'), tests.id('lina'), 'Allergic to ammonia dyes', true);
select lives_ok($$ select public.biz_update_note((select id from n), 'Allergic to ammonia-based dyes', true, true) $$, 'edit a note');
select lives_ok($$ select public.biz_delete_note((select id from n)) $$, 'soft-delete a note');
select tests.as_postgres();
select ok((select deleted_at is not null from public.customer_notes where id = (select id from n)), 'note kept, marked deleted');
select tests.act_as('other_owner');
select throws_ok($$ select public.biz_add_note(tests.id('biz'), tests.id('lina'), 'x') $$, 'P0001', 'FORBIDDEN', 'cross-business note refused');
select tests.as_postgres();

select * from finish();
rollback;
