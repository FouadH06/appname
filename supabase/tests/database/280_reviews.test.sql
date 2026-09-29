-- M9 Â· verified reviews: eligibility and tiers, rating published at once while the text is moderated
--      separately (worker RPCs), fraud pre-check quarantine â†’ dismiss / confirm, the single counting
--      predicate, reports and cases, admin decisions, replies, translations, review request
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(71);

select tests.new_user('owner', '96170280100');  select tests.new_user('rec', '96170280101');
select tests.new_user('mod');                   select tests.new_user('other', '96170280099');
insert into public.admin_users (user_id, role) values (tests.id('mod'), 'moderator');
select tests.new_user('c' || i, '9617028000' || i) from generate_series(1, 8) i;
select tests.new_business('biz', 'owner');
select tests.add_member('biz', 'rec', 'reception');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim Haddad');
select tests.staff_every_day('biz', 'Karim Haddad', 0, 1440);
select tests.new_service('biz', 'Cut');
select tests.link('biz', 'Karim Haddad', 'Cut');
select tests.customer_record('r' || i, 'biz', 'Customer ' || i, '+9617028000' || i, 'c' || i) from generate_series(1, 8) i;
select tests.customer_record('r_rec', 'biz', 'Reception Person', '+96170280101', 'rec');
select tests.visit('v' || i, 'biz', 'Karim Haddad', 'Cut', 'r' || i, tests.at(tests.day(-2), (8 + i) || ':00')) from generate_series(1, 7) i;
select tests.visit('v_rec', 'biz', 'Karim Haddad', 'Cut', 'r_rec', tests.at(tests.day(-2), '17:00'));
select tests.visit('v_old', 'biz', 'Karim Haddad', 'Cut', 'r1', tests.at(tests.day(-40), '10:00'));
select tests.visit('v_future', 'biz', 'Karim Haddad', 'Cut', 'r1', tests.at(tests.day(2), '10:00'), 'confirmed');
select tests.visit('v_done', 'biz', 'Karim Haddad', 'Cut', 'r8', tests.at(tests.day(-1), '10:00'), 'confirmed');
update public.bookings b set customer_user_id = c.user_id from public.business_customers c where c.id = b.business_customer_id;
set local session_replication_role = replica;               -- source is immutable; fixture only
update public.bookings set source = 'business_link' where id = tests.id('v1');
set local session_replication_role = origin;

create table tests.v (k text primary key, j jsonb);
grant usage on schema tests to service_role;
grant select, insert, update on tests.v to anon, authenticated, service_role;
grant select on tests.ids to service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
create function tests.rv(p_booking text) returns uuid language sql stable security definer set search_path = '' as
  $$ select id from public.reviews where booking_id = tests.id(p_booking) $$;
create function tests.review(p_booking text) returns public.reviews language sql stable security definer set search_path = '' as
  $$ select * from public.reviews where booking_id = tests.id(p_booking) $$;
create function tests.case_of(p_subject uuid) returns uuid language sql stable security definer set search_path = '' as
  $$ select id from public.moderation_cases where subject_id = p_subject and state <> 'decided' order by created_at desc limit 1 $$;
-- the claimed job for one subject (from the last moderation_claim stored in tests.v 'jobs')
create function tests.job(p_id uuid) returns jsonb language sql stable as
  $$ select x from tests.v, jsonb_array_elements(tests.v.j) x where tests.v.k = 'jobs' and x ->> 'id' = p_id::text $$;
create function tests.record(p_id uuid, p_decision text, p_display text default null) returns text language sql as $$
  select public.moderation_record((tests.job(p_id) ->> 'msg_id')::bigint, (tests.job(p_id) ->> 'subject')::public.moderation_subject,
           p_id, (tests.job(p_id) ->> 'run_id')::uuid, tests.job(p_id) ->> 'text_hash', p_decision, p_display,
           '[{"stage":"text_rules","outcome":"pass"},{"stage":"text_llm","outcome":"pass","model":"test","latency_ms":5}]',
           'normalized', '[]', '{"target":"service"}', '{en}', 0.9, '{}')
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- â•â•â• eligibility and tiers (Part 4 Â§1.2) â•â•â•
select tests.act_as('c1');
select results_eq($$ select (x ->> 'eligible')::boolean, x ->> 'trust_tier', jsonb_array_length(x -> 'dimensions')
                     from (select public.get_review_context(tests.id('v1')) x) y $$,
                  $$ values (true, 'verified_booking', 6) $$, 'review form context: eligible, tier preview, category dimensions');
select throws_ok($$ select public.submit_review(tests.id('v_future'), 5) $$, 'P0001', 'NOT_ELIGIBLE', 'not before the visit is completed');
select throws_ok($$ select public.submit_review(tests.id('v_old'), 5) $$, 'P0001', 'REVIEW_WINDOW_CLOSED', '30-day window');
select throws_ok($$ select public.submit_review(tests.id('v2'), 5) $$, 'P0001', 'NOT_ELIGIBLE', 'someone else''s visit');
select throws_ok($$ select public.submit_review(tests.id('v1'), 5, '{"sparkle": 5}') $$, 'P0001', 'INVALID_INPUT', 'unknown dimension');
select throws_ok($$ select public.submit_review(tests.id('v1'), 5, '{}', 'too short') $$, 'P0001', 'TEXT_LENGTH', 'text 20â€“2000 characters');
select tests.act_as('c1', 'aal1', true);
select throws_ok($$ select public.submit_review(tests.id('v1'), 5) $$, 'P0001', 'AUTH_REQUIRED', 'anonymous sessions cannot review');
select tests.act_as('rec');
select throws_ok($$ select public.submit_review(tests.id('v_rec'), 5) $$, 'P0001', 'NOT_ELIGIBLE', 'members cannot review their own business');

-- â•â•â• submit: the rating is published now, the text waits for moderation â•â•â•
select tests.act_as('c1');
insert into tests.v values ('s1', public.submit_review(tests.id('v1'), 5, '{"service_quality": 5, "cleanliness": 4}',
  'Karim did a great fade, clean place and on time.', 'dev-1', 'key-1'));
select results_eq($$ select j ->> 'status', j ->> 'rating_state', j ->> 'text_state', j ->> 'trust_tier' from tests.v where k = 's1' $$,
                  $$ values ('published', 'active', 'pending', 'verified_booking') $$, 'online booking: published rating, pending text');
select is(public.submit_review(tests.id('v1'), 5, '{}', null, null, 'key-1') ->> 'review_id', (select j ->> 'review_id' from tests.v where k = 's1'),
  'same idempotency key â†’ same review');
select throws_ok($$ select public.submit_review(tests.id('v1'), 4) $$, 'P0001', 'ALREADY_REVIEWED', 'one review per booking');
select tests.act_as('c2');
select is(public.submit_review(tests.id('v2'), 4, '{}', null, 'dev-2') ->> 'trust_tier', 'verified_visit', 'business-logged visit: verified_visit');
select is(public.get_business_rating_summary(tests.id('biz')) -> 'display_rating', 'null'::jsonb, 'no average shown under 5 counted reviews');
select tests.act_as('c3');
select lives_ok($$ select public.submit_review(tests.id('v3'), 2, '{}', 'This is spam text with a promo code everywhere') $$, 'c3 submits');
select tests.act_as('c4');
select lives_ok($$ select public.submit_review(tests.id('v4'), 3, '{}', 'Karim was rude and an idiot to me today', 'dev-shared') $$, 'c4 submits');
select tests.act_as('c7');
select lives_ok($$ select public.submit_review(tests.id('v7'), 4, '{}', 'Lovely service, call me on 71 123 456 anytime') $$, 'c7 submits');
select tests.as_postgres();
select results_eq($$ select trust_tier::text, base_weight from public.reviews where id in (tests.rv('v1'), tests.rv('v2')) order by base_weight desc $$,
                  $$ values ('verified_booking', 1.00::numeric(3,2)), ('verified_visit', 0.50::numeric(3,2)) $$, 'tier weights 1.0 / 0.5, frozen at creation');
select throws_ok($$ update public.reviews set trust_tier = 'verified_booking' where id = tests.rv('v2') $$, 'P0001', 'IMMUTABLE_FIELD', 'tier cannot change');
select ok(exists (select 1 from public.notifications where type = 'biz_new_review' and booking_id = tests.id('v1')), 'team alert for the new review');

select tests.as_anon();
select is((select r ->> 'text' from jsonb_array_elements(public.get_business_reviews(tests.id('biz'))) r where r ->> 'id' = tests.rv('v1')::text),
  null, 'public: stars visible, text hidden while pending');
select is(public.get_business_rating_summary(tests.id('biz')) #>> '{review_count}', '5', 'five counted reviews (text pending does not matter)');

-- â•â•â• worker: claim â†’ record (service_role only) â•â•â•
select tests.act_as('c1');
select throws_ok($$ select public.moderation_claim() $$, '42501', null, 'customers cannot run the worker');
select tests.as_service();
insert into tests.v values ('jobs', public.moderation_claim(10));
select is((select count(*)::int from tests.v, jsonb_array_elements(j) x where k = 'jobs'
           and (x ->> 'id')::uuid in (tests.rv('v1'), tests.rv('v3'), tests.rv('v4'), tests.rv('v7'))), 4, 'one job per pending text');
select results_eq($$ select tests.job(tests.rv('v1')) #>> '{context,staff}', tests.job(tests.rv('v1')) #>> '{context,people,0}',
                            (tests.job(tests.rv('v1')) #>> '{config,llm_confidence_min}')::numeric $$,
                  $$ values ('Karim Haddad', 'Karim', 0.70) $$, 'job carries visit context, team names and config');
select is(public.moderation_record((tests.job(tests.rv('v1')) ->> 'msg_id')::bigint, 'review_text', tests.rv('v1'), gen_random_uuid(),
                                   'wrong-hash', 'approve'), 'stale', 'a result for a different text version is ignored');
-- the stale call removed that message; the text is re-queued so the real run can be recorded
select tests.as_postgres();
insert into tests.v select 'resend', to_jsonb(m)
  from pgmq.send('moderation', jsonb_build_object('subject', 'review_text', 'id', tests.rv('v1'), 'run_id', gen_random_uuid())) m;
update tests.v set j = (select jsonb_agg(case when x ->> 'id' = tests.rv('v1')::text
                                          then x || jsonb_build_object('msg_id', (select r.j from tests.v r where r.k = 'resend'))
                                          else x end) from jsonb_array_elements(j) x) where k = 'jobs';
select tests.as_service();
select is(tests.record(tests.rv('v1'), 'approve'), 'approve', 'approve');
select is(tests.record(tests.rv('v3'), 'reject'), 'reject', 'reject');
select is(tests.record(tests.rv('v4'), 'manual_review'), 'manual_review', 'unsure â†’ human');
select is(tests.record(tests.rv('v7'), 'approve_redacted', 'Lovely service, call me on [removed] anytime'), 'approve_redacted', 'redacted');
select tests.as_postgres();
select results_eq($$ select (tests.review(k)).text_state::text from unnest(array['v1', 'v3', 'v4', 'v7']) k $$,
                  $$ values ('approved'), ('rejected'), ('manual_review'), ('approved_redacted') $$, 'text states applied');
select is((select count(*)::int from private.moderation_results where subject_id = tests.rv('v1')), 2, 'stage results kept for audit');
select ok((select classifier ->> 'target' = 'service' and device_hash = 'dev-1' from private.review_text_private where review_id = tests.rv('v1')),
  'classifier output stored privately, device hash kept');
select ok(exists (select 1 from public.moderation_cases where subject_id = tests.rv('v4') and source = 'pipeline' and state = 'open'),
  'manual review opens a pipeline case');
select results_eq($$ select n.type::text, n.payload ->> 'review_link' like '%/review/%' from public.notifications n
                     where n.booking_id = tests.id('v3') and n.type = 'review_needs_changes' $$,
                  $$ values ('review_needs_changes', true) $$, 'rejected comment: the author is told and gets an edit link');
select is((select private.rating_is_counted(r) from public.reviews r where r.id = tests.rv('v3')), true,
  'the star rating stays counted when only the text is rejected');
select tests.as_anon();
select results_eq($$ select r ->> 'text' from jsonb_array_elements(public.get_business_reviews(tests.id('biz'))) r
                     where r ->> 'id' in (tests.rv('v1')::text, tests.rv('v7')::text) order by r ->> 'text' $$,
                  $$ values ('Karim did a great fade, clean place and on time.'), ('Lovely service, call me on [removed] anytime') $$,
  'approved text public; redacted text shows the redacted version');
select ok(position('71 123 456' in public.get_business_reviews(tests.id('biz'))::text) = 0, 'the phone number never reaches the public');

-- â•â•â• fraud pre-check: shared device â†’ quarantine; dismiss restores, confirm removes â•â•â•
select tests.act_as('c5');
select is(public.submit_review(tests.id('v5'), 5, '{}', null, 'dev-shared') ->> 'rating_state', 'quarantined',
  'same device as another reviewer of this business â†’ quarantined at submit');
select tests.act_as('c6');
select lives_ok($$ select public.submit_review(tests.id('v6'), 1, '{}', null, 'dev-shared') $$, 'c6 (same device) submits');
select tests.as_postgres();
select results_eq($$ select (tests.review('v6')).rating_state::text, (tests.review('v6')).fraud_multiplier,
                            (select count(*)::int from public.moderation_cases where subject_id = tests.rv('v6') and source = 'fraud') $$,
                  $$ values ('quarantined', 0.00::numeric(3,2), 1) $$, 'quarantined: weight 0, fraud case opened');
select results_eq($$ select review_count, display_rating from public.business_rating_summary where business_id = tests.id('biz') $$,
                  $$ values (5, 3.6::numeric(2,1)) $$, 'summary counts only the 5 counted reviews (quarantined excluded)');
select tests.as_anon();
select is((public.get_business_page('biz-test') #>> '{rating,display_rating}')::numeric, 3.6, 'business page shows the rating from 5 reviews');
select ok(not exists (select 1 from jsonb_array_elements(public.get_business_reviews(tests.id('biz'))) r where r ->> 'id' = tests.rv('v5')::text),
  'quarantined review not listed');

select tests.act_as('mod');
select throws_ok($$ select public.admin_list_cases() $$, 'P0001', 'FORBIDDEN', 'admin RPCs need MFA (aal2)');
select tests.act_as('mod', 'aal2');
select ok((select count(*) from jsonb_array_elements(public.admin_list_cases()) c where c ->> 'source' in ('fraud', 'pipeline')) >= 3,
  'queue lists pipeline and fraud cases');
select lives_ok($$ select public.admin_claim_case(tests.case_of(tests.rv('v5'))) $$, 'claim');
select tests.act_as('c1', 'aal2');
select throws_ok($$ select public.admin_decide_case(tests.case_of(tests.rv('v5')), 'approve', 'ok') $$,
  'P0001', 'FORBIDDEN', 'non-admins cannot decide');
select tests.act_as('mod', 'aal2');
select public.admin_decide_case(tests.case_of(tests.rv('v5')), 'approve', 'legit_shared_device');
select public.admin_decide_case(tests.case_of(tests.rv('v6')), 'remove_review', 'confirmed_fraud');
select public.admin_decide_case(tests.case_of(tests.rv('v4')), 'reject', 'targets_staff');
select tests.as_postgres();
select results_eq($$ select k, (tests.review(k)).status::text, (select private.rating_is_counted(r) from public.reviews r where r.id = tests.rv(k))
                     from unnest(array['v5', 'v6']) k $$,
                  $$ values ('v5', 'published', true), ('v6', 'removed', false) $$, 'dismiss restores, confirm removes');
select is((select review_count from public.business_rating_summary where business_id = tests.id('biz')), 6, 'summary recomputed');
select ok(exists (select 1 from audit.admin_actions where action = 'moderation.decide' and subject_id = tests.rv('v6') and reason_code = 'confirmed_fraud'),
  'decisions are audited');
select is((tests.review('v4')).text_state::text, 'rejected', 'moderator rejects the targeted comment');

-- â•â•â• replies (owner/manager; moderated the same way) â•â•â•
select tests.act_as('rec');
select throws_ok($$ select public.reply_to_review(tests.rv('v1'), 'Thanks!') $$, 'P0001', 'FORBIDDEN', 'reception cannot reply');
select tests.act_as('owner');
insert into tests.v values ('reply', to_jsonb(public.reply_to_review(tests.rv('v1'), 'Thank you, see you next time!')));
select tests.as_service();
update tests.v set j = public.moderation_claim(10) where k = 'jobs';
select is(tests.record((select (j #>> '{}')::uuid from tests.v where k = 'reply'), 'approve'), 'approve', 'reply approved by the worker');
select tests.as_anon();
select is((select r #>> '{reply,text}' from jsonb_array_elements(public.get_business_reviews(tests.id('biz'))) r where r ->> 'id' = tests.rv('v1')::text),
  'Thank you, see you next time!', 'approved reply shown under the review');

-- â•â•â• business view and reports â•â•â•
select tests.act_as('rec');
select throws_ok($$ select public.biz_get_reviews(tests.id('biz')) $$, 'P0001', 'FORBIDDEN', 'reviews page is owner/manager');
select throws_ok($$ select public.report_content('review', tests.rv('v3'), 'abusive_language', '{text}', null, tests.id('biz')) $$,
  'P0001', 'FORBIDDEN', 'reception cannot report as the business');
select tests.act_as('owner');
select ok(position('96170280' in public.biz_get_reviews(tests.id('biz'))::text) = 0, 'no reviewer phone in the business view');
select is((public.biz_get_reviews(tests.id('biz')) #>> '{summary,needs_reply}')::int, 5, 'needs-reply count');
select lives_ok($$ select public.report_content('review', tests.rv('v7'), 'personal_information', '{text}', 'has a phone', tests.id('biz')) $$,
  'business reports a review');
select lives_ok($$ select public.report_content('review', tests.rv('v2'), 'never_attended', '{whole}', null, tests.id('biz')) $$,
  '"never attended" report');
select tests.as_postgres();
select results_eq($$ select r.reason::text, r.status::text, c.source, d.type::text
                     from public.reports r left join public.moderation_cases c on c.id = r.moderation_case_id
                     left join public.disputes d on d.id = r.dispute_id
                     where r.reporter_business_id = tests.id('biz') order by r.reason $$,
                  $$ values ('never_attended', 'in_review', null, 'review_attendance'), ('personal_information', 'in_review', 'report', null) $$,
  'text report â†’ moderation case; attendance report â†’ dispute');
select tests.act_as('mod', 'aal2');
select public.admin_decide_case(tests.case_of(tests.rv('v7')),
                                'remove_text', 'contact_details');
select tests.as_postgres();
select results_eq($$ select (tests.review('v7')).text_state::text, (select status::text from public.reports where subject_id = tests.rv('v7')),
                            (select private.rating_is_counted(r) from public.reviews r where r.id = tests.rv('v7')) $$,
                  $$ values ('removed', 'resolved_action', true) $$, 'text removed, report resolved, stars still count');

-- â•â•â• translations: public texts only, cached â•â•â•
select tests.as_anon();
select throws_ok($$ select public.request_translation('review', tests.rv('v4'), 'ar') $$, 'P0001', 'NOT_FOUND', 'rejected text cannot be translated');
select is(public.request_translation('review', tests.rv('v1'), 'ar') ->> 'state', 'pending', 'first request queues a translation');
select tests.as_service();
insert into tests.v values ('tr', public.translation_claim(10));
select public.translation_record((j #>> '{0,msg_id}')::bigint, 'review', tests.rv('v1'), 'ar', 'ÙƒØ±ÙŠÙ… Ø¹Ù…Ù„ Ù‚ØµØ© Ø±Ø§Ø¦Ø¹Ø©', '{en}', 'test')
from tests.v where k = 'tr';
select tests.as_anon();
select is(public.request_translation('review', tests.rv('v1'), 'ar') ->> 'text', 'ÙƒØ±ÙŠÙ… Ø¹Ù…Ù„ Ù‚ØµØ© Ø±Ø§Ø¦Ø¹Ø©', 'then served from the cache');

-- â•â•â• edit once within 7 days; author delete â•â•â•
select tests.act_as('c3');
select is(public.edit_my_review(tests.rv('v3'), 3, '{}', 'Honest update: the cut was fine in the end.') ->> 'text_state', 'pending',
  'edited text goes back to moderation');
select throws_ok($$ select public.edit_my_review(tests.rv('v3'), 4) $$, 'P0001', 'OUTSIDE_WINDOW', 'only one edit');
select tests.act_as('c2');
select public.delete_my_review(tests.rv('v2'));
select tests.as_postgres();
select is((select review_count from public.business_rating_summary where business_id = tests.id('biz')), 5, 'deleted review no longer counted');

-- â•â•â• review request after completion; nightly duplicate-text detector â•â•â•
select tests.act_as('owner');
select public.mark_completed(tests.id('v_done'));
select tests.as_postgres();
select results_eq($$ select count(*)::int, bool_and(payload ->> 'review_link' like '%/review/%'), bool_and(scheduled_for >= now())
                     from public.notifications where booking_id = tests.id('v_done') and type = 'review_request' $$,
                  $$ values (1, true, true) $$, 'completed visit â†’ one review request with a review link (2 h later, outside quiet hours)');
update public.reviews set text_original = 'Karim did a great fade, clean place and on time!!' , text_state = 'approved' where id = tests.rv('v5');
select is(private.job_fraud_nightly() >= 1, true, 'nightly: near-duplicate text from another reviewer is flagged');
select is((select count(*)::int from public.reviews where id in (tests.rv('v1'), tests.rv('v5')) and rating_state = 'quarantined'), 1,
  'and one of the pair (the later copy) is quarantined for investigation');

select * from finish();
rollback;
