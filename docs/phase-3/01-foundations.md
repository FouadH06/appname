# Phase 3 · Part 1 — Foundations, Conventions, Enums, Roles

Phase 3 is split across these files:

| File | Contents |
|---|---|
| `01-foundations.md` (this) | Painful-to-change decisions, conventions, schemas, extensions, all enums, roles & permissions, auth helper functions |
| `02-identity-business-catalog.md` | Profiles, admins, customer & shadow-customer model, businesses, locations, members, settings, catalog/taxonomy, areas, services, staff, schedules |
| `03-booking-availability.md` | Bookings, items, events, holds, waitlist, availability engine, assignment, state transitions, reliability, jobs |
| `04-trust.md` | Reviews, structured ratings, replies, translations, media/customer results, moderation, reports, disputes, fraud |
| `05-discovery-crm-notifications.md` | Search & normalization, ranking config/scores/labels, CRM, favorites & rebooking, notifications, analytics rollups, audit, subscription/payment placeholders |
| `06-rls-and-permissions.md` | Grants, RLS policy matrix + SQL, public RPC surface, storage policies |
| `07-database-tests.md` | Required pgTAP / property / concurrency tests |

DDL is **spec-grade**: names, types, keys and constraints are intended to be final. Phase 4 Milestone 1 turns it into ordered migrations. Where a column list says `…timestamps`, that means `created_at timestamptz not null default now(), updated_at timestamptz not null default now()` with the shared `set_updated_at` trigger.

---

## 1. Decisions that are painful to change after launch

Review these carefully. Everything else (weights, thresholds, templates, UI) can change cheaply.

| # | Decision | Why it's hard to change later | Chosen |
|---|---|---|---|
| P1 | **Tenancy key** | Every row, policy and index depends on it | Every tenant-owned row carries `business_id`. Children reference parents through **composite FKs `(id, business_id)`**, so cross-tenant references are impossible even if app code is wrong. |
| P2 | **Staff & services owned by Business, linked to Locations** | Moving ownership later means rewriting bookings, reviews and analytics | `staff_members.business_id`, `services.business_id`; `staff_locations` is many-to-many; schedules are per (staff, location); every booking item stores `location_id`. |
| P3 | **Booking = header + items; holds are bookings** | The concurrency model and every availability query rely on it | `bookings` (customer, status, source) + `booking_items` (staff, service, time). Holds are `status = 'held'` rows. **One GiST exclusion constraint** on `(staff_id, occupied)` covers holds and real bookings. |
| P4 | **Concrete staff on every item** | Reviews, results, analytics and notifications assume it | `booking_items.staff_id NOT NULL`. `selection_mode` + `requested_staff_id` record how it was chosen. |
| P5 | **Time model** | Wrong choices corrupt history and break DST | Instants as `timestamptz`. Recurring schedules as **local minutes-of-day** + `business_locations.timezone` (IANA, default `Asia/Beirut`). Never fixed offsets. |
| P6 | **Customer identity** | Merging identities later is extremely hard | Platform identity = `auth.users` + `profiles` with **verified E.164 phone**. The business's CRM record = `business_customers` (business-owned, `user_id` nullable = shadow customer). They're linked only through an **explicit claim** (secure token + OTP on that exact phone, customer confirmation for older visits, 12-month limit). Never by name, and never automatically on phone verification. |
| P7 | **Review = one per booking, tier frozen at creation** | Trust weighting and fraud analysis depend on it | `reviews.booking_id UNIQUE`. `trust_tier` is set once by `submit_review`. Ratings, text and each media item have **independent moderation state**. |
| P8 | **Private-first media** | Retrofitting after leaks is impossible | Customer uploads land only in a private bucket; public copies are created only after approval. `media_assets` (file) is separate from `review_media` (meaning + discovery fields). |
| P9 | **Mandatory canonical service mapping** | Search, relevance moderation, benchmarks and visual discovery all hinge on it | `services.canonical_service_id NOT NULL`. |
| P10 | **Immutable attribution** | Commission and marketplace-value analytics need trustworthy history | `bookings.source` set at creation, never updated. `business_customers.acquired_via` is set on first creation. |
| P11 | **Snapshots** | Menu edits must never rewrite revenue or history | Price, duration, buffers and policy are snapshotted onto items and bookings. |
| P12 | **Public reads only via SECURITY DEFINER RPCs** | Opening base tables later invites leaks (e.g. non-bookable staff) | `anon` has **no SELECT on any tenant table** (only on non-sensitive catalog reference data). Every customer-facing read goes through curated functions that enforce `publicly_bookable`, business status and moderation status. |
| P13 | **Append-only audit** | Trust in disputes depends on it | `audit.*` and `booking_events` have no UPDATE/DELETE grants for any role, plus triggers that raise on modification. |
| P14 | **Money** | Mixing currencies later is painful | `numeric(10,2)` + `currency char(3) default 'USD'` on every monetary snapshot. LBP is display-only. |
| P15 | **Enums only for truly stable sets** | Postgres enum values can't be removed | **Enums:** statuses, roles, modes, report reasons (stable and tied to policy logic). **Lookup tables:** categories, canonical services, synonyms, rating dimensions, areas/clusters, plans (these grow and change). |
| P16 | **Slot semantics** | Businesses rely on consistent times | Slot grid anchored to local midnight in `slot_interval_minutes` steps. Buffers are part of `occupied`, not of the displayed time. Ranges are half-open `[start, end)`. |

---

## 2. Conventions

- **Postgres 15+** (Supabase). Requires multiranges (`tstzmultirange`, PG14+) for the availability engine.
- **Primary keys:** `uuid default gen_random_uuid()`. Human-facing references: `businesses.slug` (citext), `bookings.ref` (8-char Crockford base32, unique). Sequences are never exposed.
- **Naming:** snake_case, plural tables, `*_id` FKs, `*_at` timestamps, `is_*`/`has_*` booleans, `*_minute` for minute-of-day, `*_min` for durations in minutes.
- **Soft lifecycle over deletes:** core entities use `status` + `archived_at`. `DELETE` is revoked from client roles on core tables. Hard deletes happen only for holds, expired tokens, and account-deletion jobs (service role).
- **Timestamps:** `created_at`, `updated_at` (trigger `private.set_updated_at()`).
- **Text limits:** enforced with `check (char_length(x) <= n)`, not varchar.
- **Phones:** `text` in E.164 (`^\+[1-9][0-9]{7,14}$`), normalized by `private.normalize_phone(text, default_cc text default '961')`.
- **Search normalization:** `private.normalize_text(text)` (IMMUTABLE), defined in Part 5.
- **All SECURITY DEFINER functions:** `set search_path = ''` and fully qualified names; ownership by a dedicated `app_owner` role (not `postgres`), and `revoke execute ... from public` before granting specifically.

## 3. Schemas

| Schema | Exposed via API? | Contents |
|---|---|---|
| `public` | Yes | Tenant tables (RLS on all), customer/business/admin RPCs. |
| `private` | **No** | Internal tables (reliability, fraud, moderation internals, tokens, idempotency, private review text), helper and engine functions. `authenticated` gets `USAGE` so RLS helper functions can execute, but **no table privileges**. |
| `audit` | **No** | Append-only logs. Read by admins only through RPCs. |
| `extensions` | No | Extensions. |

## 4. Extensions

```sql
create extension if not exists btree_gist   with schema extensions;  -- exclusion constraints with = on uuid/int/date
create extension if not exists citext       with schema extensions;  -- slugs, emails
create extension if not exists pgcrypto     with schema extensions;  -- hold/access tokens (gen_random_bytes, digest)
create extension if not exists pg_trgm      with schema extensions;  -- fuzzy search, Arabizi variants
create extension if not exists unaccent     with schema extensions;  -- French accents
create extension if not exists postgis      with schema extensions;  -- distance search
create extension if not exists pg_cron;                               -- scheduled jobs
create extension if not exists pgmq;                                  -- Supabase Queues (moderation, notifications)
create extension if not exists pg_net;                                -- invoke Edge Functions from DB
create extension if not exists pgtap        with schema extensions;  -- tests (non-prod too)
```

## 5. Enums (complete list)

```sql
-- Identity & roles
create type public.user_status         as enum ('active', 'warned', 'suspended', 'deleted');
create type public.app_locale          as enum ('en', 'ar', 'fr');
create type public.business_role       as enum ('owner', 'manager', 'reception', 'staff');
create type public.member_status       as enum ('invited', 'active', 'revoked');
create type public.admin_role          as enum ('moderator', 'support', 'ops', 'superadmin');

-- Business & catalog
create type public.business_status     as enum ('draft', 'live', 'paused', 'suspended', 'closed');
create type public.location_status     as enum ('draft', 'live', 'paused', 'closed');
create type public.verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.audience            as enum ('women', 'men', 'everyone');
create type public.area_level          as enum ('governorate', 'district', 'area');
create type public.synonym_lang        as enum ('en', 'ar', 'fr', 'arabizi');
create type public.price_type          as enum ('fixed', 'from', 'range', 'on_consultation');
create type public.service_location_type as enum ('at_business', 'at_customer', 'both');
create type public.lifecycle_status    as enum ('active', 'archived');
create type public.booking_mode        as enum ('instant', 'request');

-- Staff
create type public.staff_choice_mode   as enum ('any_or_choose', 'any_only', 'choose_only');
create type public.assignment_rule     as enum ('least_booked', 'priority', 'round_robin', 'minimize_gaps');
create type public.staff_selection_mode as enum ('any', 'specific', 'rebook', 'business');
create type public.time_off_kind       as enum ('vacation', 'sick', 'personal', 'training', 'other');

-- Customers
create type public.acquisition_channel as enum ('marketplace', 'business_link', 'manual', 'import');
create type public.reliability_tier    as enum ('new', 'reliable', 'some_missed', 'restricted', 'blocked');
create type public.reliability_label   as enum ('new_customer', 'reliable', 'some_missed_appointments');

-- Booking
create type public.booking_status      as enum ('held', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.booking_source      as enum ('marketplace_search', 'marketplace_home', 'marketplace_other',
                                                'business_link', 'rebook', 'waitlist', 'promotion', 'manual', 'walk_in');
create type public.actor_kind          as enum ('customer', 'business', 'admin', 'system');
create type public.booking_event_type  as enum ('held', 'confirmed', 'requested', 'accepted', 'declined', 'expired',
                                                'rescheduled', 'staff_changed', 'cancelled', 'completed', 'no_show_marked',
                                                'no_show_contested', 'no_show_resolved', 'note_changed', 'price_changed',
                                                'reminder_sent', 'customer_confirmed', 'claimed');
create type public.payment_status      as enum ('not_required', 'pending', 'paid', 'refunded', 'failed');
create type public.waitlist_status     as enum ('active', 'offered', 'booked', 'expired', 'cancelled');
create type public.offer_status        as enum ('sent', 'claimed', 'expired', 'superseded');

-- Trust
create type public.trust_tier          as enum ('verified_booking', 'verified_visit');
create type public.review_status       as enum ('pending', 'published', 'removed', 'deleted_by_author');
create type public.content_state       as enum ('pending', 'approved', 'approved_redacted', 'manual_review', 'rejected', 'removed');
create type public.rating_state        as enum ('pending_check', 'active', 'quarantined', 'removed');
create type public.media_kind          as enum ('result', 'before', 'after');
create type public.business_media_kind as enum ('cover', 'portfolio', 'logo', 'staff_photo');
create type public.media_status        as enum ('uploaded', 'processing', 'approved', 'manual_review', 'rejected', 'removed', 'deleted');
create type public.moderation_subject  as enum ('review_text', 'reply_text', 'review_media', 'business_media', 'staff_bio', 'business_text');
create type public.moderation_stage    as enum ('validation', 'sanitize', 'hash', 'safety', 'ocr', 'relevance',
                                                'text_rules', 'text_normalize', 'text_llm', 'decision');
create type public.case_state          as enum ('open', 'claimed', 'decided', 'escalated');
create type public.moderation_decision as enum ('approve', 'approve_redacted', 'reject', 'remove_media', 'remove_text',
                                                'remove_review', 'escalate');
create type public.report_subject      as enum ('review', 'review_media', 'review_reply', 'business', 'staff', 'user');
create type public.report_reason       as enum ('never_attended', 'abusive_language', 'personal_information', 'unrelated_image',
                                                'spam', 'fake_review', 'false_information', 'inappropriate', 'harassment',
                                                'my_photo', 'other');
create type public.report_status       as enum ('open', 'in_review', 'resolved_action', 'resolved_no_action', 'rejected');
create type public.dispute_type        as enum ('no_show', 'review_attendance', 'legal', 'ownership');
create type public.dispute_status      as enum ('open', 'awaiting_info', 'resolved', 'void');
create type public.dispute_outcome     as enum ('no_show_upheld', 'no_show_overturned', 'voided', 'review_kept',
                                                'review_text_removed', 'review_media_removed', 'review_removed',
                                                'legal_kept', 'legal_removed', 'ownership_transferred', 'ownership_denied');
create type public.fraud_signal_type   as enum ('new_account_review', 'device_cluster', 'ip_cluster', 'review_burst',
                                                'member_self_review', 'duplicate_text', 'visit_tier_cap', 'no_show_pattern',
                                                'report_abuse', 'phone_cluster');

-- Discovery
create type public.config_status       as enum ('draft', 'active', 'archived');
create type public.discovery_label     as enum ('top_rated', 'top_cleanliness', 'great_punctuality', 'popular_near_you',
                                                'available_today', 'best_value', 'new');

-- Notifications
create type public.notification_channel as enum ('push', 'whatsapp', 'sms', 'email', 'in_app');
create type public.notification_status  as enum ('queued', 'processing', 'sent', 'partially_failed', 'failed', 'cancelled');
create type public.delivery_status      as enum ('queued', 'sent', 'delivered', 'read', 'failed');
create type public.notification_type    as enum (
  -- customer
  'booking_confirmed', 'booking_requested', 'request_accepted', 'request_declined', 'request_expired',
  'booking_reminder_24h', 'booking_reminder_2h', 'booking_cancelled_by_business', 'booking_rescheduled_by_business',
  'staff_changed', 'booking_no_show_marked', 'review_request', 'review_published', 'review_needs_changes', 'result_published', 'result_rejected',
  'waitlist_offer', 'dispute_update', 'otp',
  -- business
  'biz_new_booking', 'biz_new_request', 'biz_booking_cancelled', 'biz_new_review', 'biz_report_resolved',
  'biz_waitlist_claimed', 'biz_schedule_conflict', 'biz_invite', 'biz_daily_summary');

-- Billing placeholders
create type public.subscription_status as enum ('free_launch', 'trialing', 'active', 'past_due', 'cancelled');
```

Note on P15: `report_reason` is an enum because each reason maps to a moderation policy in code. Adding a reason is cheap (`alter type ... add value`); removing one isn't, so new reasons go through a decision log entry.

## 6. Roles and permissions

### 6.1 Postgres roles

| Role | Used by | Posture |
|---|---|---|
| `anon` | Unauthenticated web visitors (SSR public pages) | EXECUTE on public-read RPCs only. No table privileges. |
| `authenticated` | Any signed-in user (customer, business member, admin, **anonymous-auth visitor**) | Table privileges only where RLS policies exist; writes on core tables revoked (RPC only). |
| `service_role` | Edge Functions (moderation, notifications, webhooks), cron | Bypasses RLS; still no UPDATE/DELETE on audit tables. Never shipped to clients. |
| `app_owner` | Owns tables & SECURITY DEFINER functions | Not loginable. |

**Anonymous visitors:** the web booking flow signs visitors in with **Supabase Anonymous Auth** before creating a hold. Holds are then owned by a real `auth.uid()`. The JWT claim `is_anonymous = true` blocks every action except hold/slot RPCs. Verifying a phone either upgrades that anonymous user or signs into an existing account. The hold carries a secret `hold_token`, so it can be confirmed by the user who ends up signed in (see Part 3).

### 6.2 Application roles

| App role | Derived from |
|---|---|
| Visitor | `anon` or `authenticated` with `is_anonymous` |
| Customer | `authenticated`, not anonymous, `profiles.status in ('active','warned')` |
| Business Owner / Manager / Reception / Staff | `business_members(business_id, user_id, role, status='active')` |
| Moderator / Support / Ops / Superadmin | `admin_users(user_id, role, is_active)` **and** JWT `aal = 'aal2'` (MFA) |

One user can be a customer and a member of several businesses at once. Roles are evaluated per business.

### 6.3 Permission matrix (business roles)

| Capability | Owner | Manager | Reception | Staff |
|---|---|---|---|---|
| View calendar (all staff) | ✓ | ✓ | ✓ | own column only |
| Create/move/cancel bookings | ✓ | ✓ | ✓ | own only [SOON: configurable] |
| Mark completed / no-show | ✓ | ✓ | ✓ | own only |
| Accept/decline requests | ✓ | ✓ | ✓ | ✗ |
| Customers list & detail | ✓ | ✓ | ✓ (no spend if `reception_sees_revenue=false`) | upcoming own customers: name + staff-visible notes |
| Customer notes | ✓ | ✓ | ✓ | read staff-visible, write own |
| Services & pricing | ✓ | ✓ | ✗ | ✗ |
| Staff profiles, schedules, time off | ✓ | ✓ | view schedules; time-off without reason | own schedule view; request time off [SOON] |
| Reviews: reply / report / feature | ✓ | ✓ | ✗ | ✗ (read own reviews) |
| Analytics | ✓ | ✓ | ✗ (or limited) | own performance [SOON] |
| Business settings | ✓ | ✓ (not danger zone) | ✗ | ✗ |
| Members & roles | ✓ | ✓ (cannot touch owners/managers) | ✗ | ✗ |
| Danger zone (pause, close, transfer) | ✓ | ✗ | ✗ | ✗ |

### 6.4 Permission matrix (admin roles)

| Capability | Moderator | Support | Ops | Superadmin |
|---|---|---|---|---|
| Moderation queue & decisions | ✓ | ✓ | ✗ | ✓ |
| Warn user | ✓ | ✓ | ✗ | ✓ |
| Suspend user / business | ✗ | ✓ user · ✗ business | ✓ business | ✓ |
| Disputes (no-show, review) | ✗ | ✓ | ✗ | ✓ |
| Legal requests | ✗ | ✗ | ✗ | ✓ |
| Create/onboard/edit businesses | ✗ | read | ✓ | ✓ |
| Catalog & locations | ✗ | ✗ | ✓ | ✓ |
| Ranking config publish | ✗ | ✗ | ✗ | ✓ |
| Reliability adjustments | ✗ | ✓ | ✗ | ✓ |
| Audit log | own actions | ✓ | ✓ | ✓ (+ PII) |
| Admin user management | ✗ | ✗ | ✗ | ✓ |

## 7. Core helper functions

```sql
-- updated_at trigger
create function private.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Caller identity. [Amended in M1, decision log 2026-09-27] These read the request GUCs
-- directly (exactly what auth.uid()/auth.jwt() do) because functions owned by app_owner
-- cannot be granted the auth schema in Supabase. Every SECURITY DEFINER function uses
-- private.jwt()/private.uid(), never auth.*(). RLS policies may use either.
create function private.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;

create function private.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  private.jwt() ->> 'sub')::uuid $$;

create function private.is_anonymous() returns boolean language sql stable as $$
  select coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) $$;

-- Business membership check (SECURITY DEFINER so it can read business_members regardless of RLS)
create function private.has_business_role(p_business_id uuid, p_roles public.business_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (p_roles is null or m.role = any (p_roles))
  ) $$;

-- The caller's staff_members.id within a business (null if none)
create function private.my_staff_id(p_business_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.staff_members s
  where s.business_id = p_business_id and s.user_id = auth.uid() and s.status = 'active' $$;

-- Business ids the caller belongs to (for IN (...) policies on large tables)
create function private.my_business_ids(p_roles public.business_role[] default null)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.business_id from public.business_members m
  where m.user_id = auth.uid() and m.status = 'active'
    and (p_roles is null or m.role = any (p_roles)) $$;

-- Admin check: requires MFA (aal2)
create function private.is_admin(p_roles public.admin_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admin_users a
                 where a.user_id = auth.uid() and a.is_active
                   and (p_roles is null or a.role = any (p_roles) or a.role = 'superadmin')) $$;

-- Active, non-anonymous, not suspended customer
create function private.is_active_customer()
returns boolean language sql stable security definer set search_path = '' as $$
  select not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
     and exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status in ('active', 'warned')
                   and p.phone_verified_at is not null) $$;

-- Phone normalization (Lebanon-aware)
create function private.normalize_phone(p_raw text, p_default_cc text default '961')
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p_raw, ''), '[^0-9+]', '', 'g');
begin
  -- Arabic-Indic digits are translated before this function is called (see normalize_digits)
  if d like '+%' then d := substr(d, 2);
  elsif d like '00%' then d := substr(d, 3);
  elsif d like '0%' then d := p_default_cc || substr(d, 2);          -- 03 123456 → 9613123456
  elsif length(d) between 7 and 8 then d := p_default_cc || d;        -- 3123456 / 70123456
  end if;
  if d !~ '^[1-9][0-9]{7,14}$' then return null; end if;
  return '+' || d;
end $$;

create function private.normalize_digits(p text) returns text language sql immutable as $$
  select translate(p, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789') $$;
```

**Policy performance pattern:** for tenant checks on large tables, policies use `business_id in (select private.my_business_ids('{owner,manager}'))`. The subquery doesn't depend on the row, so Postgres evaluates it once per statement (initPlan) and uses the `business_id` index. `private.has_business_role(business_id, …)` is reserved for single-row checks inside RPCs. `auth.uid()` is always wrapped as `(select auth.uid())` in policies.
