-- M11 · admin console: role matrix (Part 7 §8 #56–57), one audit row per mutating admin RPC, dispute
--       outcome effects (Part 7 §7), default rules, suspend with upcoming bookings, review quarantine /
--       restore / remove, catalog guard, ranking publish / rollback, audit read + PII masking, search.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(81);

-- ─── fixtures ──────────────────────────────────────────────────────────────
select tests.new_user('owner', '96170300100');
select tests.new_user(n) from unnest(array['mod', 'sup', 'ops', 'super', 'nobody']) n;
insert into public.admin_users (user_id, role) values
  (tests.id('mod'), 'moderator'), (tests.id('sup'), 'support'), (tests.id('ops'), 'ops'), (tests.id('super'), 'superadmin');
update public.profiles set first_name = 'Sam', last_name = 'Support' where id = tests.id('sup');
select tests.new_user('c' || i, '9617030000' || i) from generate_series(1, 5) i;
select tests.new_business('biz', 'owner');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim Haddad');
select tests.staff_every_day('biz', 'Karim Haddad', 0, 1440);
select tests.new_service('biz', 'Cut');
select tests.link('biz', 'Karim Haddad', 'Cut');
select tests.customer_record('r' || i, 'biz', 'Customer ' || i, '+9617030000' || i, 'c' || i) from generate_series(1, 5) i;
-- no-show visits (marked by the business below), a completed visit for a review, an upcoming booking
select tests.visit('ns1', 'biz', 'Karim Haddad', 'Cut', 'r1', date_trunc('minute', now()) - interval '2 hours', 'confirmed');
select tests.visit('ns2', 'biz', 'Karim Haddad', 'Cut', 'r2', date_trunc('minute', now()) - interval '3 hours', 'confirmed');
select tests.visit('ns3', 'biz', 'Karim Haddad', 'Cut', 'r3', date_trunc('minute', now()) - interval '4 hours', 'confirmed');
select tests.visit('ns4', 'biz', 'Karim Haddad', 'Cut', 'r4', date_trunc('minute', now()) - interval '5 hours', 'confirmed');
select tests.visit('done5', 'biz', 'Karim Haddad', 'Cut', 'r5', tests.at(tests.day(-2), '10:00'));
select tests.visit('up1', 'biz', 'Karim Haddad', 'Cut', 'r5', tests.at(tests.day(3), '10:00'), 'confirmed');
update public.bookings b set customer_user_id = c.user_id from public.business_customers c where c.id = b.business_customer_id;

create table tests.v (k text primary key, j jsonb);
grant select, insert, update on tests.v to authenticated;
create function tests.audits(p_action text) returns int language sql stable security definer set search_path = '' as
  $$ select count(*)::int from audit.admin_actions where action = p_action $$;
create function tests.dispute(p_booking text) returns public.disputes language sql stable security definer set search_path = '' as
  $$ select * from public.disputes where booking_id = tests.id(p_booking) order by created_at desc limit 1 $$;
create function tests.score(p_user text) returns numeric language sql stable security definer set search_path = '' as
  $$ select score from private.customer_reliability where user_id = tests.id(p_user) $$;
grant execute on all functions in schema tests to anon, authenticated;

-- business marks the no-shows; customers 1–4 contest
select tests.act_as('owner');
select public.mark_no_show(tests.id(k)) from unnest(array['ns1', 'ns2', 'ns3', 'ns4']) k;
select tests.act_as('c1');
select public.contest_no_show(tests.id('ns1'), 'I was there on time, ask Karim.');
select tests.act_as('c2');
select public.contest_no_show(tests.id('ns2'), 'I was there on time, ask Karim.');
select tests.act_as('c3');
select public.contest_no_show(tests.id('ns3'), 'I was there on time, ask Karim.');
select tests.act_as('c4');
select public.contest_no_show(tests.id('ns4'), 'I was there on time, ask Karim.');
select tests.as_postgres();

-- ═══ role matrix (aal2 required; each area limited to its roles) ═══
select tests.act_as('sup', 'aal1');
select throws_ok($$ select public.admin_overview() $$, 'P0001', 'FORBIDDEN', 'aal1 admin (no MFA) gets nothing');
select tests.act_as('nobody', 'aal2');
select throws_ok($$ select public.admin_search('Cust') $$, 'P0001', 'FORBIDDEN', 'a non-admin gets nothing');
select tests.act_as('mod', 'aal2');
select throws_ok($$ select public.admin_get_customer(tests.id('c1')) $$, 'P0001', 'FORBIDDEN', 'moderator: no customer records');
select throws_ok($$ select public.admin_resolve_dispute((tests.dispute('ns1')).id, 'no_show_upheld', 'evidence') $$,
  'P0001', 'FORBIDDEN', 'moderator cannot resolve disputes');
select throws_ok($$ select public.admin_publish_ranking(1, 'x') $$, 'P0001', 'FORBIDDEN', 'moderator cannot publish ranking configs (#57)');
select throws_ok($$ select public.admin_set_business_status(tests.id('biz'), 'paused', 'x') $$, 'P0001', 'FORBIDDEN',
  'moderator cannot change a business status');
select lives_ok($$ select public.admin_list_reviews() $$, 'moderator reads reviews');
select tests.act_as('ops', 'aal2');
select throws_ok($$ select public.admin_list_cases(null, 'open') $$, 'P0001', 'FORBIDDEN', 'ops cannot work moderation cases (#57)');
select throws_ok($$ select public.admin_quarantine_review(gen_random_uuid(), 'x') $$, 'P0001', 'FORBIDDEN', 'ops cannot quarantine reviews');
select throws_ok($$ select public.admin_set_user_status(tests.id('c1'), 'suspended', 'x') $$, 'P0001', 'FORBIDDEN',
  'ops cannot sanction customers');
select throws_ok($$ select public.admin_create_ranking_draft('{}', 'x') $$, 'P0001', 'FORBIDDEN', 'ops cannot draft ranking configs');
select lives_ok($$ select public.admin_get_catalog() $$, 'ops reads the catalog');
select tests.act_as('sup', 'aal2');
select throws_ok($$ select public.admin_get_catalog() $$, 'P0001', 'FORBIDDEN', 'support: no catalog');
select throws_ok($$ select public.admin_list_disputes('legal') $$, 'P0001', 'FORBIDDEN', 'legal disputes: superadmin only (#57)');
select is(jsonb_array_length(public.admin_search('70300001') -> 'customers'), 1, 'support finds a customer by phone in admin search');
select tests.act_as('mod', 'aal2');
select is(public.admin_search('70300001') -> 'customers', '[]'::jsonb, 'moderator search never returns customers');

-- every admin RPC requires a reason on mutations
select tests.act_as('sup', 'aal2');
select throws_ok($$ select public.admin_set_user_status(tests.id('c1'), 'warned', ' ') $$, 'P0001', 'REASON_REQUIRED',
  'no silent admin edits: a reason code is required');

-- ═══ A7 disputes: outcome effects (Part 7 §7) ═══
select is((select count(*)::int from jsonb_array_elements(public.admin_list_disputes('no_show'))), 4, 'four open no-show disputes');
select results_eq($$ select jsonb_array_length(d -> 'events') > 0, d #>> '{booking,status}', d #>> '{customer,reliability,tier}' is not null
                     from (select public.admin_get_dispute((tests.dispute('ns1')).id) d) x $$,
                  $$ values (true, 'no_show', true) $$, 'case detail: event log evidence, booking and customer reliability');
insert into tests.v values ('before_c1', to_jsonb(tests.score('c1')));

-- overturn: booking completed, penalty reversed, visit credited, review eligibility, both sides told
select lives_ok($$ select public.admin_resolve_dispute((tests.dispute('ns1')).id, 'no_show_overturned', 'reminder_confirmed', 'Customer confirmed the reminder') $$,
  'support overturns a no-show');
select tests.as_postgres();
select results_eq($$ select status::text, review_eligible_until > now() from public.bookings where id = tests.id('ns1') $$,
                  $$ values ('completed', true) $$, 'overturned: booking completed, customer may review');
select ok(tests.score('c1') < (select (j #>> '{}')::numeric from tests.v where k = 'before_c1'), 'overturned: reliability penalty reversed');
select results_eq($$ select (tests.dispute('ns1')).status::text, (tests.dispute('ns1')).outcome::text, (tests.dispute('ns1')).resolved_by = tests.id('sup') $$,
                  $$ values ('resolved', 'no_show_overturned', true) $$, 'dispute resolved with outcome and resolver');
select is((select count(*)::int from public.notifications where booking_id = tests.id('ns1') and type in ('dispute_update', 'biz_report_resolved')
           and payload ->> 'dispute_outcome' = 'no_show_overturned'), 2, 'customer and business are both notified');
select is((select count(*)::int from public.booking_events where booking_id = tests.id('ns1') and event = 'no_show_resolved'), 1,
  'booking timeline records the resolution');
select is(tests.audits('dispute.resolve'), 1, 'resolution audited (one row)');

-- uphold: nothing changes on the booking or the penalty
insert into tests.v values ('before_c2', to_jsonb(tests.score('c2')));
select tests.act_as('sup', 'aal2');
select lives_ok($$ select public.admin_resolve_dispute((tests.dispute('ns2')).id, 'no_show_upheld', 'no_evidence') $$, 'support upholds');
select tests.as_postgres();
select results_eq($$ select (select status::text from public.bookings where id = tests.id('ns2')),
                            tests.score('c2') = (select (j #>> '{}')::numeric from tests.v where k = 'before_c2') $$,
                  $$ values ('no_show', true) $$, 'upheld: booking stays no-show, penalty stands');
-- void: penalty reversed, booking stays as marked
select tests.act_as('sup', 'aal2');
select lives_ok($$ select public.admin_resolve_dispute((tests.dispute('ns3')).id, 'voided', 'unclear') $$, 'support voids');
select tests.as_postgres();
select results_eq($$ select (select status::text from public.bookings where id = tests.id('ns3')),
                            exists (select 1 from private.reliability_events where booking_id = tests.id('ns3') and kind = 'forgiven') $$,
                  $$ values ('no_show', true) $$, 'voided: neither side penalized (customer penalty reversed)');
select tests.act_as('sup', 'aal2');
select throws_ok($$ select public.admin_resolve_dispute((tests.dispute('ns3')).id, 'no_show_upheld', 'again') $$,
  'P0001', 'TRANSITION_NOT_ALLOWED', 'a resolved dispute cannot be resolved again');
select throws_ok($$ select public.admin_resolve_dispute((tests.dispute('ns4')).id, 'review_removed', 'wrong') $$,
  'P0001', 'INVALID_INPUT', 'outcome must fit the dispute type');
-- request info → awaiting_info, customer asked; internal note is not visible to parties
select lives_ok($$ select public.admin_add_dispute_message((tests.dispute('ns4')).id, 'Could you share the reminder screenshot?', false, true) $$,
  'support asks the customer for more information');
select tests.as_postgres();
select results_eq($$ select (tests.dispute('ns4')).status::text,
                            exists (select 1 from public.notifications where booking_id = tests.id('ns4') and type = 'dispute_update'
                                    and payload ->> 'dispute_outcome' = 'awaiting_info') $$,
                  $$ values ('awaiting_info', true) $$, 'awaiting info + customer notified');
-- default rules: untouched for 7 days → overturn if the customer confirmed the reminder, else void
update public.disputes set created_at = now() - interval '8 days' where id = (tests.dispute('ns4')).id;
delete from public.dispute_messages where dispute_id = (tests.dispute('ns4')).id and author_kind = 'admin';
insert into public.booking_events (booking_id, business_id, event, actor_kind, data)
values (tests.id('ns4'), tests.id('biz'), 'customer_confirmed', 'customer', '{}');
select is(private.job_dispute_default_rules(), 1, 'default rules job resolves the stale dispute');
select results_eq($$ select (tests.dispute('ns4')).outcome::text, (select status::text from public.bookings where id = tests.id('ns4')) $$,
                  $$ values ('no_show_overturned', 'completed') $$, 'confirmed reminder → overturned by default rule');

-- ═══ A5 customers: forgive, status ═══
select tests.act_as('sup', 'aal2');
select lives_ok($$ select public.admin_forgive_reliability(tests.id('ns2'), 'goodwill', 'first miss, family emergency') $$,
  'support forgives an upheld no-show');
select throws_ok($$ select public.admin_forgive_reliability(tests.id('ns2'), 'again') $$, 'P0001', 'ALREADY_DONE', 'forgiven only once');
select throws_ok($$ select public.admin_forgive_reliability(tests.id('done5'), 'x') $$, 'P0001', 'TRANSITION_NOT_ALLOWED',
  'only no-shows can be forgiven');
select lives_ok($$ select public.admin_set_user_status(tests.id('c2'), 'suspended', 'abuse', 'threatening messages') $$, 'support suspends a customer');
select throws_ok($$ select public.admin_set_user_status(tests.id('sup'), 'active', 'x') $$, 'P0001', 'FORBIDDEN', 'nobody changes their own status');
select throws_ok($$ select public.admin_set_user_status(tests.id('mod'), 'suspended', 'x') $$, 'P0001', 'FORBIDDEN',
  'only a superadmin can sanction another admin');
select results_eq($$ select (c #>> '{profile,status}'), jsonb_array_length(c #> '{reliability,events}') > 0, jsonb_array_length(c -> 'notifications') >= 0
                     from (select public.admin_get_customer(tests.id('c2')) c) x $$,
                  $$ values ('suspended', true, true) $$, 'customer detail: status, reliability internals, notification log');
select tests.as_postgres();
select results_eq($$ select tests.audits('reliability.forgive'), tests.audits('user.status') $$, $$ values (1, 1) $$,
  'forgive and status change audited once each');

-- ═══ A6 reviews: quarantine → restore, remove ═══
select tests.act_as('c5');
insert into tests.v values ('rv', to_jsonb(public.submit_review(tests.id('done5'), 5, '{}', null) ->> 'review_id'));
select tests.act_as('mod', 'aal2');
select lives_ok($$ select public.admin_quarantine_review((select (j #>> '{}')::uuid from tests.v where k = 'rv'), 'suspected_manipulation') $$,
  'moderator quarantines a review');
select tests.as_postgres();
select results_eq($$ select rating_state::text, fraud_multiplier, private.rating_is_counted(r) from public.reviews r
                     where id = (select (j #>> '{}')::uuid from tests.v where k = 'rv') $$,
                  $$ values ('quarantined', 0.00::numeric(3,2), false) $$, 'quarantined: weight 0, not counted');
select tests.act_as('mod', 'aal2');
select lives_ok($$ select public.admin_restore_review((select (j #>> '{}')::uuid from tests.v where k = 'rv'), 'investigation_cleared') $$,
  'moderator restores it');
select tests.as_postgres();
select results_eq($$ select rating_state::text, status::text, private.rating_is_counted(r) from public.reviews r
                     where id = (select (j #>> '{}')::uuid from tests.v where k = 'rv') $$,
                  $$ values ('active', 'published', true) $$, 'restored: counted again');
select tests.act_as('sup', 'aal2');
select lives_ok($$ select public.admin_remove_review((select (j #>> '{}')::uuid from tests.v where k = 'rv'), 'review', 'fake_review') $$,
  'support removes the whole review');
select throws_ok($$ select public.admin_remove_review((select (j #>> '{}')::uuid from tests.v where k = 'rv'), 'review', 'again') $$,
  'P0001', 'TRANSITION_NOT_ALLOWED', 'already removed');
select tests.as_postgres();
select results_eq($$ select tests.audits('review.quarantine'), tests.audits('review.restore'), tests.audits('review.remove_review') $$,
                  $$ values (1, 1, 1) $$, 'each review action audited once');
select is((public.get_business_rating_summary(tests.id('biz')) ->> 'review_count')::int, 0, 'removed review no longer counted in the summary');

-- ═══ A4 businesses: suspend with upcoming bookings ═══
select tests.act_as('ops', 'aal2');
select throws_ok($$ select public.admin_set_business_status(tests.id('biz'), 'suspended', 'fraud_investigation') $$,
  'P0001', 'UPCOMING_BOOKINGS', 'suspending with upcoming bookings needs an explicit choice');
select lives_ok($$ select public.admin_set_business_status(tests.id('biz'), 'suspended', 'fraud_investigation', null, 'cancel') $$,
  'ops suspends and cancels upcoming bookings');
select tests.as_postgres();
select results_eq($$ select (select status::text from public.businesses where id = tests.id('biz')),
                            (select status::text from public.bookings where id = tests.id('up1')),
                            exists (select 1 from public.notifications where booking_id = tests.id('up1') and type = 'booking_cancelled_by_business') $$,
                  $$ values ('suspended', 'cancelled', true) $$, 'suspended; upcoming booking cancelled; customer told');
select is((select actor_kind::text from public.booking_events where booking_id = tests.id('up1') and event = 'cancelled'), 'admin',
  'the cancellation is attributed to an admin in the booking timeline');
select tests.act_as('ops', 'aal2');
select lives_ok($$ select public.admin_verify_business(tests.id('biz'), true, 'documents_checked') $$, 'ops verifies (placeholder flag)');
select lives_ok($$ select public.admin_set_business_test(tests.id('biz'), true, 'internal_demo') $$, 'ops marks a test business');
select results_eq($$ select b #>> '{business,status}', b #>> '{business,verification_status}', (b #>> '{business,is_test}')::boolean
                     from (select public.admin_get_business(tests.id('biz')) b) x $$,
                  $$ values ('suspended', 'verified', true) $$, 'business detail reflects the actions');
select throws_ok($$ select public.admin_set_business_status(tests.id('biz'), 'live', 'reinstated') $$, 'P0001', 'GO_LIVE_BLOCKED',
  'going live still needs the go-live checklist (no cover photo here)');

-- ═══ A8 catalog ═══
select lives_ok($$ select public.admin_save_canonical_service(jsonb_build_object('id', (select id from public.canonical_services where slug = 'balayage'),
                    'relevance_hints', '["hair", "hair color"]'::jsonb), 'relevance_hints') $$, 'ops edits relevance hints');
select throws_ok($$ select public.admin_save_canonical_service(jsonb_build_object('id', (select id from public.canonical_services where slug = 'mens-haircut'),
                     'is_active', false), 'retire') $$, 'P0001', 'IN_USE', 'a service in use cannot be deactivated');
select is((public.admin_add_synonym((select id from public.canonical_services where slug = 'beard-trim'), 'حلاقة', 'ar', 'dialect') ->> 'ambiguous')::boolean,
  (select exists (select 1 from public.service_synonyms where term_normalized = private.search_key('حلاقة')
                  and canonical_service_id <> (select id from public.canonical_services where slug = 'beard-trim'))),
  'duplicate synonym across services is allowed but flagged ambiguous');
select tests.as_postgres();
select ok(tests.audits('catalog.service') = 1 and tests.audits('catalog.synonym_add') = 1, 'catalog edits audited with reasons');

-- ═══ A9 ranking ═══
insert into tests.v select 'v1', params from public.ranking_configs where version = 1;
select tests.act_as('super', 'aal2');
select throws_ok($$ select public.admin_create_ranking_draft(
                     jsonb_set((select j from tests.v where k = 'v1'), '{quality_weights,rating}', '40'), 'more rating') $$,
  'P0001', 'INVALID_CONFIG', 'weights must sum to 100');
select is(public.admin_create_ranking_draft(
            jsonb_set(jsonb_set((select j from tests.v where k = 'v1'), '{quality_weights,rating}', '40'),
                      '{quality_weights,volume}', '15'), 'more weight on rating quality'), 2, 'valid draft → version 2');
select lives_ok($$ select public.admin_publish_ranking(2, 'pilot tuning') $$, 'superadmin publishes v2');
select lives_ok($$ select public.admin_rollback_ranking(1, 'revert pilot tuning') $$, 'superadmin rolls back to v1');
select tests.as_postgres();
select results_eq($$ select version, status::text from public.ranking_configs order by version $$,
                  $$ values (1, 'active'), (2, 'archived') $$, 'exactly one active version after publish + rollback');
select results_eq($$ select tests.audits('ranking.draft'), tests.audits('ranking.publish'), tests.audits('ranking.rollback') $$,
                  $$ values (1, 1, 1) $$, 'ranking actions audited');
select tests.act_as('ops', 'aal2');
select is((public.admin_explain_rank(tests.id('biz')) ->> 'active_version')::int, 1, '"why this rank" shows the applied version');

-- ═══ moderation audit gaps (claim / release / escalate) ═══
select tests.as_postgres();
insert into public.moderation_cases (subject_type, subject_id, business_id, source, reasons, sla_due_at)
values ('review_text', gen_random_uuid(), tests.id('biz'), 'pipeline', '{targeted_person}', now() + interval '1 day');
insert into tests.v select 'case', to_jsonb(id) from public.moderation_cases where reasons = '{targeted_person}';
select tests.act_as('mod', 'aal2');
select lives_ok($$ select public.admin_claim_case((select (j #>> '{}')::uuid from tests.v where k = 'case')) $$,
  'moderator claims a case');
select lives_ok($$ select public.admin_release_case((select (j #>> '{}')::uuid from tests.v where k = 'case')) $$,
  'and releases it');
select tests.as_postgres();
select results_eq($$ select tests.audits('moderation.claim'), tests.audits('moderation.release') $$, $$ values (1, 1) $$,
  'claim and release are audited');

-- ═══ A10 audit read: unified, filtered, masked ═══
select tests.act_as('mod', 'aal2');
select ok((select bool_and(x ->> 'source' = 'admin') from jsonb_array_elements(public.admin_get_audit('{"source":"admin"}')) x),
  'filter by source');
select is((select count(*)::int from jsonb_array_elements(public.admin_get_audit(jsonb_build_object('subject_id', tests.id('ns1')))) x
           where x ->> 'action' in ('booking.no_show_marked', 'booking.no_show_resolved')), 2,
  'booking timeline events appear in the unified log (subject filter)');
select is((select x #>> '{after,phone_e164}' from jsonb_array_elements(public.admin_get_audit('{"action":"public.profiles"}', null, 200)) x
           where x #>> '{after,phone_e164}' is not null limit 1), null, 'moderator sees no raw phone numbers in diffs');
select tests.act_as('super', 'aal2');
select is((select count(*)::int from jsonb_array_elements(public.admin_get_audit(jsonb_build_object('business_id', tests.id('biz'), 'action', 'business.')))),
  3, 'business actions filter (status, verify, test flag)');
select tests.as_postgres();
select throws_ok($$ update audit.admin_actions set reason_code = 'x' $$, null, null, 'audit rows are immutable');

-- ═══ overview ═══
select tests.act_as('mod', 'aal2');
select results_eq($$ select (o #>> '{queues,disputes,count}')::int >= 0, jsonb_typeof(o -> 'clusters'), jsonb_typeof(o -> 'today')
                     from (select public.admin_overview() o) x $$,
                  $$ values (true, 'array', 'object') $$, 'overview: queues, cluster health, daily totals');
select is((public.admin_overview() #>> '{queues,disputes,by_type}') is not null, true, 'dispute queue split by type');

select * from finish();
rollback;
