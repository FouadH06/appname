-- M10 · customer results & media pipeline: private-first upload, storage policies, worker contract
--      (idempotent, processor-independent, staging-only derivatives), hash stage, classify/publish,
--      visibility, featuring rules, removal and retention, reports and admin decisions
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
\ir ../helpers/fixtures.psql
select plan(58);

select tests.new_user('owner', '96170290100');  select tests.new_user('rec', '96170290101');
select tests.new_user('mod');                   select tests.new_user('c1', '96170290001');
select tests.new_user('c2', '96170290002');     select tests.new_user('c3', '96170290003');
insert into public.admin_users (user_id, role) values (tests.id('mod'), 'moderator');
select tests.new_business('biz', 'owner');
select tests.add_member('biz', 'rec', 'reception');
select tests.open_every_day('biz', 0, 1440);
select tests.new_staff('biz', 'Karim Haddad');
select tests.staff_every_day('biz', 'Karim Haddad', 0, 1440);
select tests.new_service('biz', 'Cut');
select tests.link('biz', 'Karim Haddad', 'Cut');
select tests.customer_record('r' || i, 'biz', 'Customer ' || i, '+9617029000' || i, 'c' || i) from generate_series(1, 3) i;
select tests.visit('v' || i, 'biz', 'Karim Haddad', 'Cut', 'r' || i, tests.at(tests.day(-2), (9 + i) || ':00')) from generate_series(1, 3) i;
select tests.visit('v_old', 'biz', 'Karim Haddad', 'Cut', 'r1', tests.at(tests.day(-25), '10:00'));
update public.bookings b set customer_user_id = c.user_id from public.business_customers c where c.id = b.business_customer_id;

create table tests.v (k text primary key, j jsonb);
grant usage on schema tests to service_role;
grant select, insert, update on tests.v to anon, authenticated, service_role;
grant select on tests.ids to service_role;
create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
create function tests.jv(p_k text) returns jsonb language sql stable as $$ select j from tests.v where k = p_k $$;
create function tests.media(p_k text) returns uuid language sql stable as $$ select (tests.jv(p_k) #>> '{0,media_id}')::uuid $$;
create function tests.rm(p_k text) returns uuid language sql stable as $$ select (tests.jv(p_k) #>> '{0,review_media_id}')::uuid $$;
create function tests.asset(p_media uuid) returns public.media_assets language sql stable security definer set search_path = '' as
  $$ select * from public.media_assets where id = p_media $$;
create function tests.rmrow(p_id uuid) returns public.review_media language sql stable security definer set search_path = '' as
  $$ select * from public.review_media where id = p_id $$;
-- the queued transform job for a media (as the worker would claim it)
create function tests.job(p_media uuid) returns uuid language sql stable security definer set search_path = '' as
  $$ select job_id from private.media_jobs where media_id = p_media and state = 'queued' order by created_at desc limit 1 $$;
create function tests.lastjob(p_media uuid) returns uuid language sql stable security definer set search_path = '' as
  $$ select job_id from private.media_jobs where media_id = p_media order by created_at desc limit 1 $$;
-- a processor result (processor: 'external' or 'edge') with staging derivatives
create function tests.result(p_media uuid, p_processor text default 'external', p_sha text default null, p_phash text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('ok', true, 'processor', p_processor, 'processor_version', 'test/1',
    'original', jsonb_build_object('mime', 'image/jpeg', 'width', 1600, 'height', 1200, 'bytes', 800000,
                                   'sha256', coalesce(p_sha, encode(extensions.digest(p_media::text, 'sha256'), 'hex'))),
    'phash', coalesce(p_phash, lpad(to_hex(abs(hashtext(p_media::text))::bigint), 16, '0')), 'blurhash', 'LEHV6nWB2yk8',
    'derivatives', jsonb_build_array(
      jsonb_build_object('name', 'thumb', 'path', p_media || '/thumb.webp', 'width', 320, 'height', 240, 'bytes', 9000),
      jsonb_build_object('name', 'card', 'path', p_media || '/card.webp', 'width', 800, 'height', 600, 'bytes', 40000),
      jsonb_build_object('name', 'full', 'path', p_media || '/full.webp', 'width', 1600, 'height', 1200, 'bytes', 200000)),
    'outputs', jsonb_build_object('bucket', 'ugc-staging'), 'metadata_stripped', true, 'duration_ms', 900)
$$;
create function tests.classify_msg(p_media uuid) returns bigint language sql stable security definer set search_path = '' as
  $$ select msg_id from pgmq.q_media_classify where message ->> 'media_id' = p_media::text order by msg_id desc limit 1 $$;
create function tests.publish_msg(p_media uuid) returns bigint language sql stable security definer set search_path = '' as
  $$ select msg_id from pgmq.q_media_publish where message ->> 'media_id' = p_media::text order by msg_id desc limit 1 $$;
create function tests.cleanup_has(p_path text) returns boolean language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from pgmq.q_media_cleanup where message -> 'paths' ? p_path) $$;
create function tests.case_of(p_subject uuid) returns uuid language sql stable security definer set search_path = '' as
  $$ select id from public.moderation_cases where subject_id = p_subject and state <> 'decided' order by created_at desc limit 1 $$;
create function tests.publish(p_media uuid) returns text language sql security definer set search_path = '' as $$
  select public.media_publish_complete(tests.publish_msg(p_media), p_media,
           (select derivatives from public.media_assets where id = p_media))
$$;
create function tests.rv(p_booking text) returns uuid language sql stable security definer set search_path = '' as
  $$ select id from public.reviews where booking_id = tests.id(p_booking) $$;
grant execute on function tests.rv(text) to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- reviews to attach photos to
select tests.act_as('c1');  select public.submit_review(tests.id('v1'), 5, '{}', 'Great fade, clean and on time!!');
select tests.act_as('c2');  select public.submit_review(tests.id('v2'), 4);
select tests.act_as('c3');  select public.submit_review(tests.id('v3'), 3);
select tests.act_as('c1');  select public.submit_review(tests.id('v_old'), 4);

-- ═══ C16 upload request (Part 4 §2.3) ═══
select tests.as_postgres();
update public.reviews set visit_at = now() - interval '35 days' where id = tests.rv('v_old');   -- older visit
update public.canonical_services set allows_before_after = false where slug = 'mens-haircut';  -- for the kind check
select tests.act_as('c1');
select throws_ok($$ select public.request_review_media_upload(tests.rv('v1'), '[{"kind":"result"}]', null) $$, 'P0001', 'CONSENT_REQUIRED', 'consent is required');
select throws_ok($$ select public.request_review_media_upload(tests.rv('v_old'), '[{"kind":"result"}]', 'c1') $$, 'P0001', 'OUTSIDE_WINDOW', '30 days after the visit');
select throws_ok($$ select public.request_review_media_upload(tests.rv('v1'), '[{"kind":"before","pair_group":"4c0d9a36-8f5b-4d4a-9a3f-1b7f0d0d6a01"}]', 'c1') $$,
  'P0001', 'INVALID_INPUT', 'before/after only for services that allow it');
select tests.as_postgres();
update public.canonical_services set allows_before_after = true where slug = 'mens-haircut';
select tests.act_as('c1');
insert into tests.v values ('up1', public.request_review_media_upload(tests.rv('v1'), '[{"kind":"result"}]', 'c1'));
select is(tests.jv('up1') #>> '{0,upload_path}', tests.id('c1') || '/' || tests.media('up1'), 'private path {user}/{media}');
insert into tests.v values ('up1b', public.request_review_media_upload(tests.rv('v1'), '[{"kind":"result"},{"kind":"result"},{"kind":"result"}]', 'c1'));
select throws_ok($$ select public.request_review_media_upload(tests.rv('v1'), '[{"kind":"result"}]', 'c1') $$, 'P0001', 'MEDIA_LIMIT', 'at most 4 photos per review');
select tests.act_as('c2');
select throws_ok($$ select public.request_review_media_upload(tests.rv('v1'), '[{"kind":"result"}]', 'c1') $$, 'P0001', 'FORBIDDEN', 'only the review author');
select tests.as_postgres();
select results_eq($$ select (tests.asset(tests.media('up1'))).status::text, (tests.asset(tests.media('up1'))).private_bucket,
                            (tests.rmrow(tests.rm('up1'))).state::text, (tests.rmrow(tests.rm('up1'))).price_min $$,
                  $$ values ('uploaded', 'ugc-private', 'pending', 20.00::numeric) $$, 'asset uploaded (private), result pending, price snapshot kept');

-- ═══ storage policies (Part 7 §58) — skipped where the storage schema isn't installed ═══
select tests.as_postgres();
create function tests.storage_insert(p_bucket text, p_name text) returns void language plpgsql as $$
begin insert into storage.objects (bucket_id, name, owner) values (p_bucket, p_name, private.uid()); end $$;
grant execute on function tests.storage_insert(text, text) to authenticated;
select tests.act_as('c1');
select case when to_regclass('storage.objects') is null then skip('storage schema not installed', 4) else collect_tap(
  lives_ok(format($$ select tests.storage_insert('ugc-private', %L) $$, tests.jv('up1') #>> '{0,upload_path}'), 'upload allowed at the registered path'),
  throws_ok(format($$ select tests.storage_insert('ugc-private', %L) $$, tests.id('c1') || '/not-registered'), '42501', null, 'any other path refused'),
  throws_ok($$ select tests.storage_insert('ugc-public', 'x/card.webp') $$, '42501', null, 'clients never write to ugc-public'),
  is((select count(*)::int from storage.objects where bucket_id = 'ugc-private'), 0, 'clients cannot read ugc-private (not even their own upload)')) end;

-- ═══ finalize → transform job; worker contract (Part 7 §46d) ═══
select is(public.finalize_media_upload(tests.media('up1')), 'processing', 'finalize queues the transform');
select tests.act_as('c2');
select throws_ok($$ select public.finalize_media_upload(tests.media('up1')) $$, 'P0001', 'FORBIDDEN', 'only the uploader finalizes');
select tests.act_as('c1');
select throws_ok($$ select public.media_claim_transform() $$, '42501', null, 'the worker RPCs are service-role only');
select tests.as_service();
insert into tests.v values ('jobs', public.media_claim_transform(10));
select is((select count(*)::int from jsonb_array_elements(tests.jv('jobs')) x where x ->> 'media_id' = tests.media('up1')::text
             and x #>> '{source,bucket}' = 'ugc-private' and x #>> '{outputs,bucket}' = 'ugc-staging'), 1,
  'job: read ugc-private, write ugc-staging, per the worker contract');
select throws_ok(format($$ select public.media_processing_complete(%L, %L::jsonb) $$, tests.job(tests.media('up1')),
                        jsonb_set(tests.result(tests.media('up1')), '{derivatives,0,path}', '"elsewhere/thumb.webp"')),
  'P0001', 'INVALID_INPUT', 'derivatives outside the media''s staging prefix are refused');
select throws_ok(format($$ select public.media_processing_complete(%L, %L::jsonb) $$, tests.job(tests.media('up1')),
                        jsonb_set(tests.result(tests.media('up1')), '{outputs,bucket}', '"ugc-public"')),
  'P0001', 'INVALID_INPUT', 'derivatives are never written to ugc-public before approval');
insert into tests.v values ('job1', to_jsonb(tests.job(tests.media('up1'))));
select is(public.media_processing_complete((tests.jv('job1') #>> '{}')::uuid, tests.result(tests.media('up1'))), 'classify', 'external result accepted → classify');
select is(public.media_processing_complete((tests.jv('job1') #>> '{}')::uuid, tests.result(tests.media('up1'))), 'duplicate', 'idempotent per job_id');
select tests.as_postgres();
select results_eq($$ select (tests.asset(tests.media('up1'))).processor, (tests.asset(tests.media('up1'))).width,
                            (tests.asset(tests.media('up1'))).phash is not null, (tests.asset(tests.media('up1'))).public_path $$,
                  $$ values ('external', 1600, true, null::text) $$, 'metadata recorded; still no public path');
-- the same payload from an Edge processor is accepted identically
select tests.act_as('c1');
select public.finalize_media_upload(tests.media('up1b'));
select tests.as_service();
select is(public.media_processing_complete(tests.job(tests.media('up1b')), tests.result(tests.media('up1b'), 'edge')), 'classify',
  'processor = edge: same contract');
-- a result for media that is no longer processing is refused
select tests.as_postgres();
insert into private.media_jobs (media_id, subject) values ((tests.jv('up1b') #>> '{1,media_id}')::uuid, 'review_media');
select tests.as_service();
select throws_ok(format($$ select public.media_processing_complete(%L, %L::jsonb) $$,
                        tests.job((tests.jv('up1b') #>> '{1,media_id}')::uuid), tests.result((tests.jv('up1b') #>> '{1,media_id}')::uuid)),
  'P0001', 'NOT_PROCESSING', 'media not in processing: refused');
select is(public.media_processing_complete(tests.lastjob(tests.media('up1b')), '{"ok":false,"error_code":"TIMEOUT","retryable":true}'), 'duplicate',
  'a finished job ignores late results');

-- ═══ hash stage: not your result / own duplicate ═══
select tests.as_postgres();
insert into public.media_assets (id, business_id, purpose, private_bucket, private_path, public_path, status, sha256, phash)
values ('7f0e7c6e-2d4f-4a58-9d31-0a2b3c4d5e6f', tests.id('biz'), 'business_media', 'business-media', tests.id('biz') || '/p.jpg',
        tests.id('biz') || '/p.jpg', 'approved', decode(repeat('ab', 32), 'hex'), 1234567);
insert into public.business_media (business_id, media_asset_id, kind) values (tests.id('biz'), '7f0e7c6e-2d4f-4a58-9d31-0a2b3c4d5e6f', 'portfolio');
select ok((select count(*) from private.media_jobs where media_id = '7f0e7c6e-2d4f-4a58-9d31-0a2b3c4d5e6f' and subject = 'business_media') = 1,
  'a new business photo gets its async safety check (transform job)');
select tests.act_as('c2');
insert into tests.v values ('up2', public.request_review_media_upload(tests.rv('v2'), '[{"kind":"result"}]', 'c1'));
select public.finalize_media_upload(tests.media('up2'));
select tests.as_service();
select is(public.media_processing_complete(tests.job(tests.media('up2')), tests.result(tests.media('up2'), 'external', repeat('ab', 32))),
  'rejected', 'the business''s own portfolio photo uploaded as a result → rejected');
select tests.as_postgres();
select results_eq($$ select (tests.asset(tests.media('up2'))).rejected_reason, (tests.rmrow(tests.rm('up2'))).state::text,
                            (select count(*)::int from public.notifications where type = 'result_rejected' and payload ->> 'result_id' = tests.rm('up2')::text) $$,
                  $$ values ('not_your_result', 'rejected', 1) $$, '"not your result" and the author is told');

-- ═══ classify → publish; visibility (Part 7 §47) ═══
select tests.as_anon();
select is(jsonb_array_length(public.get_business_results(tests.id('biz')) -> 'items'), 0, 'nothing public before approval');
select is(public.get_result(tests.rm('up1')) ->> 'state', 'removed', 'pending result: not visible, no path');
select tests.as_service();
select is(public.media_classification_record(tests.classify_msg(tests.media('up1')), tests.media('up1'), gen_random_uuid(), 'approve', '{}',
          '[{"stage":"safety","outcome":"pass","model":"local-stub"},{"stage":"relevance","outcome":"pass"}]'), 'approve', 'classifier approves');
select throws_ok(format($$ select public.media_publish_complete(%s, %L, '[{"name":"card","path":"wrong/card.webp"}]') $$,
                        tests.publish_msg(tests.media('up1')), tests.media('up1')),
  'P0001', 'INVALID_INPUT', 'public paths must stay under the media prefix');
select is(tests.publish(tests.media('up1')), 'published', 'orchestrator confirms the copy to ugc-public');
select tests.as_anon();
select results_eq($$ select x ->> 'id', x #>> '{images,card,path}', x ->> 'staff', x ->> 'trust_tier'
                     from jsonb_array_elements(public.get_business_results(tests.id('biz')) -> 'items') x $$,
                  $$ values (tests.rm('up1')::text, tests.media('up1') || '/card.webp', 'Karim', 'verified_visit') $$,
  'published result: public derivative paths, staff first name, trust tier');
select is(public.get_result(tests.rm('up1')) #>> '{review,overall}', '5', 'result detail carries the review');
select tests.as_postgres();
select ok(tests.cleanup_has(tests.media('up1') || '/card.webp') and exists (select 1 from public.notifications where type = 'result_published'
          and payload ->> 'result_id' = tests.rm('up1')::text), 'staging copies queued for deletion; "your result is live" queued');

-- manual review (minor) and reject
select tests.act_as('c3');
insert into tests.v values ('up3', public.request_review_media_upload(tests.rv('v3'), '[{"kind":"result"},{"kind":"result"}]', 'c1'));
select public.finalize_media_upload(tests.media('up3'));
select public.finalize_media_upload((tests.jv('up3') #>> '{1,media_id}')::uuid);
select tests.as_service();
select public.media_processing_complete(tests.job(tests.media('up3')), tests.result(tests.media('up3')));
select public.media_processing_complete(tests.job((tests.jv('up3') #>> '{1,media_id}')::uuid), tests.result((tests.jv('up3') #>> '{1,media_id}')::uuid));
select is(public.media_classification_record(tests.classify_msg(tests.media('up3')), tests.media('up3'), gen_random_uuid(), 'manual_review',
          '{minor}', '[]', true), 'manual_review', 'minor → human');
select is(public.media_classification_record(tests.classify_msg((tests.jv('up3') #>> '{1,media_id}')::uuid), (tests.jv('up3') #>> '{1,media_id}')::uuid,
          gen_random_uuid(), 'reject', '{not_relevant}', '[]', false, 'not_relevant'), 'reject', 'irrelevant → rejected');
select tests.as_postgres();
select results_eq($$ select (tests.rmrow(tests.rm('up3'))).state::text, (tests.rmrow(tests.rm('up3'))).minor_flag,
                            (select source from public.moderation_cases where subject_id = tests.media('up3')) $$,
                  $$ values ('manual_review', true, 'pipeline') $$, 'minor-flagged, pipeline case, stays private');
select ok(tests.cleanup_has((tests.jv('up3') #>> '{1,media_id}') || '/card.webp'), 'rejected photo: staging copies deleted');

-- ═══ admin: media cases, reports (Part 4 §3.3, §4) ═══
select tests.act_as('mod', 'aal2');
select throws_ok(format($$ select public.admin_decide_case(%L, 'approve', 'ok') $$, tests.case_of(tests.media('up3'))),
  'P0001', 'USE_MEDIA_DECISION', 'text decision refuses photo cases');
select public.admin_claim_case(tests.case_of(tests.media('up3')));
select lives_ok(format($$ select public.admin_decide_media_case(%L, 'approve', 'relevant_adult_ok', null, true) $$, tests.case_of(tests.media('up3'))),
  'moderator approves (minor flag kept)');
select tests.as_service();
select is(tests.publish(tests.media('up3')), 'published', 'approved by a moderator → published by the orchestrator');

-- ═══ featuring (Part 4 §2.4; Part 7 §48) ═══
select tests.act_as('rec');
select throws_ok(format($$ select public.feature_result(%L, 1) $$, tests.rm('up1')), 'P0001', 'FORBIDDEN', 'reception cannot feature');
select tests.act_as('owner');
select throws_ok(format($$ select public.feature_result(%L, 1) $$, tests.rm('up3')), 'P0001', 'NOT_FEATURABLE', 'minor-flagged photos are never featured');
select throws_ok(format($$ select public.feature_result(%L, 7) $$, tests.rm('up1')), 'P0001', 'INVALID_INPUT', 'ranks 1–6');
select lives_ok(format($$ select public.feature_result(%L, 1) $$, tests.rm('up1')), 'owner features an approved result');
select is(public.get_business_results(tests.id('biz')) #>> '{featured,0,id}', tests.rm('up1')::text, 'featured row (labeled in the UI)');
select ok(not has_function_privilege('authenticated', 'private.remove_review_media(uuid, text)', 'execute')
          and not has_table_privilege('authenticated', 'public.review_media', 'update')
          and not has_table_privilege('authenticated', 'public.review_media', 'delete'),
  'no path for a business to delete, hide or reorder organic results');
select tests.act_as('owner');
select is(jsonb_array_length(public.biz_get_results(tests.id('biz'))), 2, 'B10 lists the business''s published results');

-- ═══ report "that's my photo" → top of the queue ═══
select tests.act_as('c2');
insert into tests.v values ('rep', to_jsonb(public.report_content('review_media', tests.rm('up1'), 'my_photo', '{whole}', 'this is me')));
select tests.as_postgres();
select results_eq($$ select c.subject_type::text, c.priority, c.source from public.moderation_cases c
                     join public.reports r on r.moderation_case_id = c.id where r.id = (tests.jv('rep') #>> '{}')::uuid $$,
                  $$ values ('review_media', 90, 'report') $$, 'photo report keyed by the media asset, priority 90');

-- ═══ removal and retention (Part 7 §49) ═══
select tests.act_as('c1');
select public.delete_my_media(tests.rm('up1'));
select tests.as_anon();
select is(public.get_result(tests.rm('up1')) ->> 'state', 'removed', 'deleted by the author: gone at once');
select is(public.get_business_results(tests.id('biz')) -> 'featured', '[]'::jsonb, 'featured slot cleared');
select tests.as_postgres();
select ok(tests.cleanup_has(tests.media('up1') || '/full.webp') and (tests.asset(tests.media('up1'))).purge_after > now() + interval '29 days'
          and (tests.asset(tests.media('up1'))).public_path is null,
  'public derivatives queued for deletion; private original kept 30 days for appeals');
update public.media_assets set purge_after = now() - interval '1 minute' where id = tests.media('up1');
update public.media_assets set purge_after = now() - interval '1 minute', legal_hold = true where id = tests.media('up2');
select private.job_media_sweep();
select results_eq($$ select (tests.asset(tests.media('up1'))).status::text, (tests.asset(tests.media('up2'))).status::text $$,
                  $$ values ('deleted', 'rejected') $$, 'retention purge deletes originals, never under legal hold');
select tests.act_as('c3');
select public.delete_my_review(tests.rv('v3'));
select tests.as_postgres();
select is((select count(*)::int from public.review_media where review_id = tests.rv('v3') and state <> 'removed'), 0,
  'deleting the review removes its photos');
select tests.as_anon();
select is((public.get_business_results(tests.id('biz')) ->> 'total')::int, 0, 'no results left public');

-- ═══ sweeper: uploads never finalized ═══
select tests.act_as('c2');
insert into tests.v values ('up_stuck', public.request_review_media_upload(tests.rv('v2'), '[{"kind":"result"}]', 'c1'));
select tests.as_postgres();
update public.media_assets set created_at = now() - interval '1 hour' where id = tests.media('up_stuck');
select private.job_media_sweep();
select is((tests.asset(tests.media('up_stuck'))).status::text, 'processing', 'stale upload finalized by the sweeper (worker decides)');
select tests.as_service();
select is(public.media_processing_complete(tests.job(tests.media('up_stuck')), '{"ok":false,"error_code":"MISSING_OBJECT","retryable":false,"processor":"external"}'),
  'rejected', 'nothing was uploaded → rejected quietly');
select tests.as_postgres();
select results_eq($$ select (tests.asset(tests.media('up_stuck'))).rejected_reason,
                            (select count(*)::int from public.notifications where type = 'result_rejected' and payload ->> 'result_id' = tests.rm('up_stuck')::text) $$,
                  $$ values ('upload_incomplete', 0) $$, 'no message for an upload that never arrived');

select * from finish();
rollback;
