# Phase 3 · Part 6 — Row Level Security, Grants, RPC Surface, Storage

## 1. Security model in five rules

1. **RLS is enabled on every table in `public`.** A test fails the build if any table has `relrowsecurity = false`.
2. **Default deny.** Start from `revoke all` for `anon` and `authenticated`, then grant table privileges only where a policy exists, and **column-level** grants for updates.
3. **Customer-facing reads go through SECURITY DEFINER RPCs** that return curated payloads. That's where `publicly_bookable`, business visibility and moderation state are enforced. `anon` has **no SELECT on tenant tables**; the only exception is non-sensitive catalog reference data (§3.1).
4. **Correctness-critical writes go through RPCs** (bookings, reviews, media, reports, disputes, members, statuses). Clients can write directly only to simple business-owned configuration (services, staff profiles, schedules) and personal preferences, and always under RLS plus column grants.
5. **Anonymous-auth users are `authenticated` but not customers.** Every customer policy and RPC requires `not private.is_anonymous()` (via `private.is_active_customer()` in RPCs).

## 2. Baseline grants

```sql
revoke all on all tables    in schema public  from anon, authenticated;
revoke all on all functions in schema public  from public, anon, authenticated;
revoke all on all tables    in schema private from public, anon, authenticated;
revoke all on all tables    in schema audit   from public, anon, authenticated;
grant usage on schema private to authenticated, anon;   -- so RLS helper functions resolve; no table grants
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
-- every table:
alter table public.<t> enable row level security;
```

Additional helper (next to Part 1 §7):

```sql
create function private.my_staff_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff_members s
  join public.business_members m on m.business_id = s.business_id and m.user_id = s.user_id and m.status = 'active'
  where s.user_id = auth.uid() and s.status = 'active' $$;
```

Shorthand used below:
- `MB(roles)` = `business_id in (select private.my_business_ids(roles))`
- `ADMIN(roles)` = `(select private.is_admin(roles))`
- `ME` = `(select auth.uid())`

## 3. Policy matrix

**Legend:** R = select, I = insert, U = update, D = delete. "RPC" = no direct table access for that audience; they use functions.

### 3.1 Reference & catalog

| Table | anon | Customer | Business member | Admin |
|---|---|---|---|---|
| categories, rating_dimensions, canonical_services, service_synonyms, areas, area_aliases, clusters, cluster_areas | R (active/live rows only) | R | R | R; I/U `ADMIN(ops)` |
| catalog_suggestions | — | — | I/R own business `MB(owner,manager)` | R/U `ADMIN(ops)` |
| reserved_slugs, business_slug_history | — | — | — | R `ADMIN(ops)` |

### 3.2 Identity

| Table | Customer | Business member | Admin |
|---|---|---|---|
| profiles | R own; U own (`first_name, last_name, locale, default_area_id`) | — (names come via RPC projections) | R `ADMIN(support,ops)`; U via RPC |
| admin_users | — | — | R `ADMIN()`; I/U `ADMIN(superadmin)` |
| private.* (devices, reliability, fraud, tokens…) | — | — | via admin RPCs only |

### 3.3 Business configuration

| Table | Owner/Manager | Reception | Staff | Admin |
|---|---|---|---|---|
| businesses | R; U cols (`name, description, audience, amenities, instagram_handle, website_url`) | R | R | R; U via RPC (`ADMIN(ops)`) |
| business_locations | R; U cols (`name, area_id, address_line, building, floor, landmark, geo, phone_e164, whatsapp_e164`) | R | R | R |
| location_hours, location_closures | R/I/U/D | R | R | R |
| business_settings | R; U (all except `business_id`) | R | R | R |
| business_categories | R/I/D | R | R | R |
| business_members | R | R (self row) | R (self row) | R |
| service_groups, services, service_combo_items | R/I/U (column grants; no D — archive via `status`) | R | R | R |
| staff_members | R/I; U cols (`display_name, slug, role_title, bio, photo_media_id, gender, publicly_bookable, accepts_any_assignment, assignment_priority, display_order`) | R | R | R |
| staff_locations, staff_services | R/I/U/D | R | R (own rows) | R |
| staff_weekly_hours, staff_schedule_overrides | R/I/U/D | R | R (own) | R |
| staff_time_off | R/I/U/D | via `biz_get_calendar` (no `reason`) | R/I own [SOON: I = request] | R |
| business_media | R/I/U/D | R/I | R | R; U (`state`) via RPC |
| business_verifications | R/I (owner) | — | — | R/U `ADMIN(ops)` |
| business_subscriptions, plans, plan_entitlements | R | — | — | R/U `ADMIN(superadmin)` |

Status fields (`businesses.status`, `business_locations.status`, `staff_members.status/archived_at`, `slug`, member roles) change **only via RPCs** (`publish_business`, `pause_online_booking`, `archive_staff`, `change_business_slug`, member RPCs). All are audited.

### 3.4 Operations data

| Table | Customer | Owner/Manager | Reception | Staff | Admin |
|---|---|---|---|---|---|
| bookings | RPC (`get_my_bookings`) | R `MB(owner,manager)` | R `MB(reception)` | R where it has an item with `staff_id in my_staff_ids()` | R `ADMIN(support)` |
| booking_items | RPC | R | R | R own `staff_id` | R |
| booking_events | RPC (timeline subset) | R | R | R own bookings | R |
| business_customers | — | R | RPC (`biz_search_customers`, projected) | RPC (projected) | R `ADMIN(support)` |
| customer_notes | — | R/I/U (soft delete via U) | R/I/U | RPC (visible_to_staff) | R |
| waitlist_entries | RPC (own) | R | R | — | R |
| business_daily_metrics | — | R | — (unless setting) | — | R |
| staff_daily_metrics | — | R | — | R own [SOON] | R |
| staff_stats | — | R | R | R own | R |

**Writes to bookings, items, events, waitlist: RPC only** (no INSERT/UPDATE/DELETE grants to any client role).

### 3.5 Trust

| Table | Customer | Business (owner/manager) | Admin |
|---|---|---|---|
| reviews, review_ratings | RPC (`get_my_reviews`; public via `get_business_reviews`) | RPC (`biz_get_reviews`) | R `ADMIN(moderator,support)` |
| review_replies | public via RPC | RPC (reply/edit/delete) | R |
| review_media, media_assets | RPC | RPC (`feature_result`, `unfeature_result`) | R |
| content_translations | via RPC | via RPC | R |
| moderation_cases | — | — | R/U via RPC `ADMIN(moderator,support)` |
| reports | R own (status + resolution_note) | R own business's reports | R `ADMIN(moderator,support)` |
| disputes, dispute_messages | R where party (`customer_user_id = ME`, `visibility = 'parties'`); I messages via RPC | R where `MB(owner,manager)` and party; I messages via RPC | R/U via RPC `ADMIN(support)`; legal: `ADMIN(superadmin)` |

### 3.6 Discovery, favorites, notifications

| Table | anon | Customer | Business | Admin |
|---|---|---|---|---|
| search_documents | RPC | RPC | RPC | R |
| ranking_configs, business_quality_scores(+history), business_labels | — | — | R own score [LATER: "profile strength" tips] | R; drafts/publish via RPC `ADMIN(superadmin)` |
| business_rating_summary | RPC | RPC | R own | R |
| customer_favorite_businesses, customer_favorite_staff | — | R own (`user_id = ME and not is_anonymous`); writes via RPC | — (aggregates only) | R |
| notifications | — | R own (`recipient_user_id = ME`); U `read_at` via RPC | R own (member as recipient) | R |
| notification_deliveries | — | — | — | R |
| notification_preferences | — | R/I/U own (at-least-one-channel rule enforced by RPC `set_notification_preference`; direct writes revoked) | — | R |
| business_notification_settings | — | — | R/I/U own row (`user_id = ME and MB()`) | R |
| push_tokens | — | I/U/D own | own | R |
| notification_templates | — | — | — | R/I/U `ADMIN(ops)` |
| payments, marketplace_fees, sponsored_placements | — | — | — | R `ADMIN(superadmin)` |

## 4. Representative policy SQL

```sql
-- SERVICES: members read; owner/manager write; business_id immutable via column grants
grant select, insert on public.services to authenticated;
grant update (group_id, canonical_service_id, name, description, price_type, price_min, price_max, currency,
              duration_min, buffer_before_min, buffer_after_min, location_type, audience,
              is_online_bookable, is_combo, status, sort) on public.services to authenticated;

create policy services_member_read on public.services for select to authenticated
  using (business_id in (select private.my_business_ids()) or (select private.is_admin()));
create policy services_manage_insert on public.services for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,manager}')));
create policy services_manage_update on public.services for update to authenticated
  using      (business_id in (select private.my_business_ids('{owner,manager}')))
  with check (business_id in (select private.my_business_ids('{owner,manager}')));

-- STAFF MEMBERS: identical pattern; user_id/status/archived_at/last_auto_assigned_at excluded from grants
grant select, insert on public.staff_members to authenticated;
grant update (display_name, slug, role_title, bio, photo_media_id, gender, publicly_bookable,
              accepts_any_assignment, assignment_priority, display_order) on public.staff_members to authenticated;

-- STAFF TIME OFF: owner/manager full; staff read own; reception gets no direct access (reason is private)
create policy time_off_manage on public.staff_time_off for all to authenticated
  using      (business_id in (select private.my_business_ids('{owner,manager}')))
  with check (business_id in (select private.my_business_ids('{owner,manager}')));
create policy time_off_self_read on public.staff_time_off for select to authenticated
  using (staff_id in (select private.my_staff_ids()));

-- BOOKINGS: read-only for members (enables Realtime for the calendar); no write grants at all
grant select on public.bookings, public.booking_items, public.booking_events to authenticated;
create policy bookings_desk_read on public.bookings for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}')));
create policy bookings_staff_read on public.bookings for select to authenticated
  using (exists (select 1 from public.booking_items bi
                 where bi.booking_id = bookings.id and bi.staff_id in (select private.my_staff_ids())));
create policy booking_items_desk_read on public.booking_items for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}')));
create policy booking_items_staff_read on public.booking_items for select to authenticated
  using (staff_id in (select private.my_staff_ids()));
create policy bookings_admin_read on public.bookings for select to authenticated
  using ((select private.is_admin('{support}')));

-- FAVORITES: own rows, never anonymous
grant select on public.customer_favorite_staff to authenticated;
create policy fav_staff_own on public.customer_favorite_staff for select to authenticated
  using (user_id = (select auth.uid()) and not (select private.is_anonymous()));

-- NOTIFICATIONS: own inbox
grant select on public.notifications to authenticated;
create policy notif_own on public.notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()));

-- CATALOG: public reference data
grant select on public.canonical_services to anon, authenticated;
create policy canon_public on public.canonical_services for select to anon, authenticated using (is_active);
create policy canon_ops_write on public.canonical_services for all to authenticated
  using ((select private.is_admin('{ops}'))) with check ((select private.is_admin('{ops}')));

-- AUDIT immutability (every audit table and booking_events)
create function audit.deny_mutation() returns trigger language plpgsql as $$
begin raise exception 'audit rows are immutable'; end $$;
create trigger admin_actions_immutable before update or delete on audit.admin_actions
  for each row execute function audit.deny_mutation();
```

**Realtime:** the business calendar subscribes to `postgres_changes` on `booking_items` (filtered by `business_id`). Realtime honors the SELECT policies above, so staff receive only their own items. On each event the client refetches that booking through `biz_get_calendar`. Payloads stay minimal, and customer names never travel over Realtime.

**Reception projection:** the calendar and CRM for reception and staff come from `biz_get_calendar(business_id, from, to, staff_ids)` and `biz_get_customer(...)`. They join customers' names, pinned notes, reliability labels, and time-off blocks **without reasons**, following the role rules in Part 1 §6.3.

## 5. RPC surface (who may execute)

| Audience | Functions |
|---|---|
| `anon` + `authenticated` (public reads) | `get_business_page`, `resolve_slug`, `get_available_slots`, `get_available_days`, `get_next_available`, `get_staff_options`, `search_suggest`, `search_businesses`, `get_business_reviews`, `get_business_rating_summary`, `get_business_results`, `get_result_detail`, `get_catalog` |
| `authenticated` incl. anonymous (booking funnel) | `create_hold`, `extend_hold`, `change_hold_staff`, `release_hold`, `resolve_access_token` |
| `authenticated` customer (checked in-function) | `confirm_booking`, `get_my_bookings`, `get_my_booking`, `cancel_my_booking`, `reschedule_my_booking`, `contest_no_show`, `claim_booking`, `get_claimable_visits`, `claim_visits`, `dismiss_claimable_visits`, `submit_review`, `edit_my_review`, `delete_my_review`, `get_my_reviews`, `request_review_media_upload`, `finalize_media_upload`, `request_translation`, `toggle_favorite_business`, `toggle_favorite_staff`, `get_my_favorites`, `get_rebook_suggestions`, `get_my_notifications`, `mark_notifications_read`, `set_notification_preference`, `register_push_token`, `report_content`, `update_my_profile`, `delete_my_account`, `add_dispute_message`, `join_waitlist` [SOON], `claim_waitlist_offer` [SOON] |
| `authenticated` business member (role checked in-function) | `biz_get_calendar`, `biz_get_available_slots`, `create_manual_booking`, `accept_request`, `decline_request`, `biz_cancel_booking`, `biz_reschedule_booking`, `reassign_booking_item`, `mark_completed`, `mark_completed_bulk`, `mark_no_show`, `undo_no_show`, `update_booking_note`, `biz_search_customers`, `biz_get_customer`, `biz_upsert_customer`, `biz_add_note`, `biz_update_note`, `biz_delete_note`, `biz_get_reviews`, `reply_to_review`, `edit_reply`, `delete_reply`, `feature_result`, `unfeature_result`, `biz_get_analytics`, `archive_staff`, `publish_business`, `pause_online_booking`, `change_business_slug`, `invite_member`, `accept_invitation`, `change_member_role`, `revoke_member`, `transfer_ownership`, `register_business_media`, `create_location_closure` (with affected-bookings handling) |
| `authenticated` admin (`is_admin` + role checked in-function) | `admin_create_business`, `admin_update_business`, `admin_set_business_status`, `admin_verify_business`, `admin_claim_case`, `admin_release_case`, `admin_decide_case`, `admin_resolve_report`, `admin_resolve_dispute`, `admin_set_user_status`, `admin_forgive_reliability`, `admin_quarantine_review`, `admin_restore_review`, `admin_create_ranking_draft`, `admin_publish_ranking`, `admin_rollback_ranking`, `admin_explain_rank`, `admin_get_audit`, `admin_search` |
| `service_role` only (Edge Functions, cron) | `private.moderation_apply_result`, `private.claim_due_notifications`, `private.record_delivery_status`, `private.customer_confirm_attendance`, `private.job_*`, `private.refresh_search_document`, `private.compute_quality_scores` |

**SECURITY DEFINER checklist (every function):**
- `set search_path = ''`, owner `app_owner`
- first statement validates the caller (`auth.uid()`, role helpers)
- the business is resolved from the target row, **never trusted from a parameter alone**
- no dynamic SQL built from input
- a stable error code on failure
- `revoke execute from public`, then explicit grants

## 6. Storage buckets & policies

| Bucket | Public? | Write | Read |
|---|---|---|---|
| `ugc-private` | No | `authenticated` insert only when `private.can_upload_private_media(name)` (a matching `media_assets` row with that path, `uploader_user_id = auth.uid()`, `status = 'uploaded'`, not anonymous); no update/delete | `service_role` only (moderators view via short-lived signed URLs from an admin RPC) |
| `ugc-staging` | No | Image processor (`media_worker` credentials / service role) | `service_role` only; copied to `ugc-public` on approval |
| `ugc-public` | Yes (CDN) | `service_role` only (approved derivatives) | Public |
| `business-media` | Yes | Members `MB(owner,manager,reception)` where `(storage.foldername(name))[1]::uuid` is their business; registration via `register_business_media` | Public |
| `dispute-evidence` | No | Dispute parties at `{dispute_id}/{uid}/…` (checked against `disputes`) | `service_role`; admins via signed URLs |
| `verification-docs` | No | Owner at `{business_id}/…` | `service_role`; admins via signed URLs |

```sql
create policy ugc_private_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ugc-private' and (select private.can_upload_private_media(name)));

create policy business_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'business-media'
              and ((storage.foldername(name))[1])::uuid in (select private.my_business_ids('{owner,manager,reception}')));
```

## 7. Operational security settings

> **Amendments from the M4 implementation (2026-09-28).**
> - **OTP routing** (`public.otp_route`, service_role only): WhatsApp first; a resend after 30 s goes by SMS; SMS only for allowed country prefixes (default `+961`, foreign numbers stay on WhatsApp); a WhatsApp error or missing WhatsApp config falls back to SMS in the same request; 5 codes per 15 min and 10 per day per number. Attempts and receipts go in `private.otp_deliveries` (30-day retention).
> - **Admin TOTP needs an email on the account:** Supabase Auth labels TOTP factors with the account email, and a phone-only account can't enroll. Admin provisioning sets both the role and an email (runbook in `docs/engineering/environments.md`); admins still sign in by phone, then TOTP.
> - Phone confirmations are on; the hook secret, CAPTCHA secret and provider credentials are configured per environment, never committed.

- Supabase Auth:
  - phone OTP with the WhatsApp-first **Send SMS hook**
  - OTP rate limits
  - anonymous sign-ins enabled (web funnel), with CAPTCHA/Turnstile on anonymous sign-in and OTP send, to limit hold spam
  - MFA (TOTP) required for admin accounts
- PostgREST `max_rows = 200`. Every list RPC paginates with cursors.
- The admin app is on a separate domain. Admin JWTs must have `aal2` (checked in `is_admin`).
- Secrets (WhatsApp, SMS, AI providers, IP-hash salt) live in Edge Function secrets, never in the DB.
- Backups: Supabase PITR enabled before launch.
