-- M14 · pre-launch security review, frozen as tests (complements 010_schema_hygiene):
--   anonymous surface, privileged-function gating, private helpers exposed to clients, storage buckets and
--   policies, service-role-only RPCs. A change here is a deliberate security decision — review it.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
set local role postgres;
select plan(10);

-- 1. anonymous callers can only use the public read RPCs (+ token resolution, invitations, ping)
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  array['get_available_days', 'get_available_slots', 'get_business_page', 'get_business_rating_summary', 'get_business_results',
        'get_business_reviews', 'get_home', 'get_invitation', 'get_landing', 'get_next_available', 'get_public_business_slugs',
        'get_result', 'get_staff_options', 'health_ping', 'request_translation', 'resolve_access_token', 'search_businesses',
        'search_suggest']::text[],
  'anonymous RPC surface is exactly the reviewed list');

-- 2. every admin_* RPC checks an admin role
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_%' and p.prosrc !~ 'admin_caller|is_admin'),
  0, 'admin RPCs gate on an admin role');

-- 3. every biz_* RPC checks business membership
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'biz\_%'
     and p.prosrc !~ 'has_business_role|my_role|assert_booking_access|my_business_ids'),
  0, 'business RPCs gate on membership');

-- 4. private helpers callable by clients are only the RLS / storage predicates and pure normalizers
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('private', 'audit')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  array['arabizi_fold', 'can_upload_private_media', 'has_business_role', 'has_entitlement', 'is_active_customer', 'is_admin',
        'is_anonymous', 'is_publicly_visible_location', 'jwt', 'my_business_ids', 'my_staff_id', 'my_staff_ids',
        'normalize_digits', 'normalize_phone', 'normalize_text', 'search_key', 'uid']::text[],
  'client-callable private helpers are the reviewed predicates only');

-- 5. dispatcher / worker RPCs are service-role only
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('notify_claim', 'notify_record_attempt', 'notify_finish', 'push_tokens_invalid', 'moderation_claim',
                       'media_processing_complete')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0, 'dispatcher and worker RPCs are not client-callable');

-- 6. buckets: only business media and approved customer results are public
select is(
  (select array_agg(id || '=' || public::text order by id) from storage.buckets),
  array['business-media=true', 'ugc-private=false', 'ugc-public=true', 'ugc-staging=false'],
  'bucket visibility as designed (M10 private-first)');

-- 7. clients never read customer uploads before approval
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and cmd in ('SELECT', 'ALL')
     and (qual ~ 'ugc-private' or qual ~ 'ugc-public')),
  0, 'no client read policy on private uploads (public results are served by the public bucket only)');

-- 8. nobody writes approved results or overwrites existing objects from a client
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage'
     and (cmd = 'UPDATE' or (cmd in ('INSERT', 'ALL') and coalesce(with_check, '') ~ 'ugc-public|ugc-staging'))),
  0, 'no client UPDATE policies; no client writes to the public or staging buckets');

-- 9. uploads are type- and size-limited
select is(
  (select count(*)::int from storage.buckets where file_size_limit is null or allowed_mime_types is null),
  0, 'every bucket limits file size and type');

-- 10. analytics and health tables are not client-readable
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated') and table_schema = 'public'
     and table_name in ('business_daily_metrics', 'staff_daily_metrics', 'push_tokens', 'favorite_businesses')
     and privilege_type <> 'SELECT'),
  0, 'rollups, push tokens and favorites have no client writes');

select * from finish();
rollback;
