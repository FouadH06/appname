# Phase 3 · Part 2 — Identity, Customers, Businesses, Catalog, Services, Staff, Schedules

Conventions from Part 1 apply. `…timestamps` = `created_at`/`updated_at` + trigger.

> **Amendments from the M4 implementation (2026-09-28, decision log).** The design below stands; the code is more precise here:
> 1. **System-authored CRM notes:** `customer_notes.author_user_id` is nullable only for `is_system = true` notes. The safe merge writes its "Also known as …" note this way (§2.3 step 3 has no human author).
> 2. **Claim tokens:** `private.access_tokens` gains `used_by` (idempotent retries, support). A `claim_visit` token must carry booking, customer record and phone. `resolve_access_token` also returns a masked phone hint (`+961 70 ••• 456`) so the holder knows which number to verify.
> 3. **Offers exclude records claimed by someone else** (recycled numbers), and a visit recorded after a dismissal brings the offer back (`booking.created_at > dismissed_at`).
> 4. **Invitations:** `revoked_at` added. A new invite for the same number replaces the pending one. Owner invitations only come from ops admins (aal2) for a business without an owner (Phase 2 A4 "Send owner invite"). Extra RPCs: `get_invitation` (logged-out preview), `list_invitations`, `revoke_invitation`. Revoking a member also unlinks their staff profile's login.
> 5. **`get_my_access()`** (new): the caller's phone hint, memberships, admin role and whether MFA is satisfied, for app routing and the admin MFA gate. `is_admin()` itself stays aal2-only.
> 6. **Account deletion** runs as `private.job_process_account_deletions` (every 15 min). An active owner is routed to support first. The auth user is deleted last by a service worker (Auth admin API, M7/ops). Reviews/results removal joins in M9/M10.

---

## 1. Identity

### 1.1 `profiles` (1:1 with `auth.users`)

```sql
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  first_name         text check (char_length(first_name) <= 50),
  last_name          text check (char_length(last_name) <= 50),
  phone_e164         text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at  timestamptz,
  email              extensions.citext,
  locale             public.app_locale not null default 'en',
  default_area_id    uuid references public.areas(id),
  status             public.user_status not null default 'active',
  status_reason      text,
  deleted_at         timestamptz,
  …timestamps
);
create unique index profiles_phone_uq on public.profiles (phone_e164)
  where phone_e164 is not null and status <> 'deleted';
```

- **Source of truth for the phone is `auth.users.phone` / `phone_confirmed_at`.** A trigger on `auth.users` (insert/update of `phone`, `phone_confirmed_at`) runs `private.sync_profile_from_auth()`, which upserts `profiles.phone_e164` and `phone_verified_at` **and nothing else**. Verifying a phone never links any business history by itself. Claiming is always explicit (§2.3).
- The public display name is always `first_name || ' ' || left(last_name, 1) || '.'`, computed in RPCs, never stored.
- **Account deletion** (`delete_my_account` RPC → service job): sets `status = 'deleted'`, nulls personal fields, removes reviews/results (`deleted_by_author`), detaches `business_customers.user_id` (the business keeps its own record), cancels future bookings with notifications, deletes the `auth.users` row last.

### 1.2 `admin_users`

```sql
create table public.admin_users (
  user_id     uuid primary key references auth.users(id),
  role        public.admin_role not null,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  …timestamps
);
```

### 1.3 Devices & signals (private)

```sql
create table private.user_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_hash   text not null,               -- salted hash of app install id / web fingerprint
  platform      text not null check (platform in ('ios', 'android', 'web')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (user_id, device_hash)
);
create index on private.user_devices (device_hash);

create table private.user_ip_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  ip_hash     text not null,                 -- HMAC(ip, secret); raw IPs are not stored
  action      text not null,                 -- 'signup' | 'otp' | 'booking' | 'review'
  created_at  timestamptz not null default now()
);
create index on private.user_ip_events (ip_hash, created_at);
```

---

## 2. Customer & shadow-customer model

### 2.1 Concepts

| Concept | Table | Owner | Purpose |
|---|---|---|---|
| Platform customer | `auth.users` + `profiles` | the person | Login, verified phone, reviews, favorites, cross-platform reliability |
| Business's customer record | `business_customers` | the business | CRM: name as the business knows it, notes, visit stats. **`user_id` null = shadow customer** (manual/walk-in, never verified). |

A person can have one `business_customers` row per business. The business record is never overwritten by platform data (the business keeps the name it typed).

### 2.2 `business_customers`

```sql
create table public.business_customers (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id),
  user_id             uuid references auth.users(id) on delete set null,   -- null = shadow
  phone_e164          text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),    -- contact snapshot; null allowed (anonymous walk-in record)
  display_name        text not null check (char_length(display_name) between 1 and 80),
  acquired_via        public.acquisition_channel not null,                 -- set on insert, immutable (trigger)
  first_booking_id    uuid,                                                -- FK added after bookings exists
  claimed_at          timestamptz,
  is_blocked_online   boolean not null default false,                      -- [SOON] business blocks online booking
  tags                text[] not null default '{}',                        -- [SOON]
  -- cached stats (recomputed by private.recompute_business_customer_stats)
  visit_count         int not null default 0,       -- completed
  no_show_count       int not null default 0,
  cancel_count        int not null default 0,
  late_cancel_count   int not null default 0,
  lifetime_spend      numeric(12,2) not null default 0,
  first_visit_at      timestamptz,
  last_visit_at       timestamptz,
  preferred_staff_id  uuid,
  favorite_service_id uuid,
  archived_at         timestamptz,
  …timestamps,
  unique (id, business_id)
);
-- A platform user has at most one record per business
create unique index business_customers_user_uq on public.business_customers (business_id, user_id)
  where user_id is not null;
-- Shadows are unique by phone per business (claimed rows may share an old phone snapshot)
create unique index business_customers_shadow_phone_uq on public.business_customers (business_id, phone_e164)
  where user_id is null and phone_e164 is not null and archived_at is null;
create index on public.business_customers (business_id, phone_e164);
create index business_customers_name_trgm on public.business_customers
  using gin ((private.normalize_text(display_name)) extensions.gin_trgm_ops);
create index on public.business_customers (business_id, last_visit_at desc);
```

> The name search combines the trigram index with the `business_id` btree via a bitmap AND. RLS already restricts rows to the caller's business. If this gets slow at scale, enable `btree_gin` and replace it with a composite `(business_id, name)` GIN index.

### 2.3 Claim model (explicit, shadow → platform)

**Principle:** nothing is ever attached to a customer's account just because they verified a phone number. There are two separate questions, and both need an explicit action from the customer:
- **Business side:** is this CRM record the same person as this platform user? (`business_customers.user_id`)
- **Customer side:** can this person see this visit in their account and review it? (`bookings.customer_user_id`)

Column added to `business_customers`:
```sql
  merged_into_id  uuid references public.business_customers(id),   -- set when a shadow is merged away (row archived)
```

#### Flow A: claim from a booking link (primary)

```text
Manual booking → business enters phone → WhatsApp confirmation contains a secure link
  (access_tokens.purpose = 'claim_visit', bound to booking_id + phone_e164, expires 30 days after the visit)
→ customer opens link → OTP-verifies that exact phone (or is already signed in with it verified)
→ public.claim_booking(p_token):
     • token valid, unused, not expired; caller not anonymous; caller's verified phone = token.phone_e164
       = the booking's business_customers.phone_e164  (else CLAIM_PHONE_MISMATCH)
     • booking.starts_at >= now() - 12 months                        (else CLAIM_TOO_OLD)
     • claims the RELATIONSHIP: private.link_business_customer(business_customer_id, uid)
         - if the user already has a record at this business → merge the shadow into it (below)
         - else set user_id = uid, claimed_at = now()
     • claims THIS BOOKING only: bookings.customer_user_id = uid; event 'claimed' {via:'token'}
     • marks token used
     • returns { claimed_booking, offers: private.find_claimable_visits(uid) summary }
```

#### Flow B: "We found previous visits associated with this number. Add them to your account?"

- `public.get_claimable_visits()` (non-anonymous caller with a verified phone) returns **offers grouped by business**. Each offer includes only: business name/area, number of visits, and the most recent visit month. **No services, staff, prices or exact dates are shown before claiming**, so a recycled number reveals as little as possible. Candidates:
  - bookings in the last 12 months, and
  - whose `business_customers.phone_e164` equals the caller's verified phone, and
  - where `bookings.customer_user_id is null`, and
  - that aren't cancelled-by-business drafts.
- `public.claim_visits(p_business_ids uuid[])`: the customer explicitly confirms per business. For each business it links the relationship (with merge) and sets `customer_user_id` on those candidate bookings (≤ 12 months only), with event `claimed` `{via:'offer'}`.
- `public.dismiss_claimable_visits(p_business_ids uuid[])`: stores the dismissal in `private.claim_dismissals (user_id, business_id, dismissed_at)` so the prompt isn't repeated. New visits after the dismissal can be offered again.
- **Where the prompt appears:** after Flow A (other visits found), and in the app/web account after login as a dismissible card. It's never applied silently.

#### After a relationship is claimed

Future manual bookings the business creates **on that claimed record** get `customer_user_id` set automatically. The customer already proved ownership for this business relationship, and they'll receive the booking confirmation anyway. Past unclaimed bookings still need Flow A or B.

#### Merging duplicates safely (`private.link_business_customer`)

When the user already has a `business_customers` row at that business (e.g. they booked online before):
1. Re-point **all** of the shadow's bookings and notes to the surviving record (business-side history is the business's own data).
2. Set `customer_user_id` **only** on bookings that are being claimed in this call, and only within 12 months.
3. Survivor keeps the business-entered `display_name` (the business's choice). The shadow's name goes into a note ("Also known as …").
4. Shadow: `merged_into_id = survivor`, `archived_at = now()`, phone kept for the audit trail. The shadow-phone unique index excludes archived rows (`where user_id is null and phone_e164 is not null and archived_at is null`).
5. Recompute stats; audit via `audit.entity_changes`.

#### Online booking where a shadow exists (no auto-merge)

When a verified customer confirms an online booking at a business that has an **unclaimed shadow with the same phone**, `confirm_booking` does **not** merge or link it. It:
- uses (or creates) the user's own record, with **`acquired_via` inherited from the shadow** (`manual`/`import`). The business already had this customer, so a future marketplace fee must never apply to them.
- adds the business to the caller's claimable offers, so the customer can choose to merge the history.
- flags the pair for the business CRM as a possible duplicate (`private.possible_duplicates (business_id, a_id, b_id)`); a business-side merge UI comes [SOON].

**Verified Visit** reviews are possible only for bookings whose `customer_user_id` was set by Flow A, Flow B, or a manual booking on an already-claimed relationship.

### 2.4 Reliability (private; business sees a label only)

```sql
create table private.reliability_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  booking_id   uuid,                                   -- FK added in Part 3
  kind         text not null check (kind in ('no_show', 'late_cancel', 'completed', 'forgiven', 'dispute_overturned')),
  weight       numeric(4,2) not null,                  -- no_show 1.0, late_cancel 0.4, completed −0.15, forgiven/overturned negate
  occurred_at  timestamptz not null,
  created_by   uuid,                                   -- admin for 'forgiven'
  note         text
);
create index on private.reliability_events (user_id, occurred_at desc);

create table private.customer_reliability (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  score        numeric(6,3) not null default 0,
  tier         public.reliability_tier not null default 'new',
  computed_at  timestamptz not null default now()
);
```

**Formula (configurable in code; not painful to change):**
- `score = Σ weight × 0.5^(age_days / 60)` over the last 180 days, floored at 0. Completed visits reduce the score, capped at −1.0 total.
- Tier:
  - `new`: fewer than 2 completed visits and score < 1.5.
  - `reliable`: score < 1.5.
  - `some_missed`: 1.5 ≤ score < 2.5.
  - `restricted`: 2.5 ≤ score < 4 (online bookings become requests).
  - `blocked`: ≥ 4 (admin review; appeal via support).
- One no-show (score 1.0) never changes the label and fades within weeks. Two recent no-shows, or one no-show plus late cancellations, are needed to show "Some missed appointments".
- Recomputed on each event and nightly (decay).
- `public.customer_reliability_label(p_user_id)` (SECURITY DEFINER, callable only by members of a business where the user has a `business_customers` row) returns only a `reliability_label`: `new_customer` | `reliable` | `some_missed_appointments` (`restricted`/`blocked` map to the last).

---

## 3. Locations taxonomy (areas & clusters)

```sql
create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.areas(id),
  level       public.area_level not null,
  slug        extensions.citext not null unique,          -- 'achrafieh', 'hazmieh'
  name_en     text not null,
  name_ar     text not null,
  name_fr     text,
  centroid    extensions.geography(Point, 4326),
  boundary    extensions.geography(MultiPolygon, 4326),   -- optional
  is_live     boolean not null default false,
  …timestamps,
  check ((level = 'governorate') = (parent_id is null))
);

create table public.area_aliases (                -- "Ashrafieh", "الأشرفية", "achrafiye"
  area_id           uuid not null references public.areas(id) on delete cascade,
  alias             text not null,
  alias_normalized  text generated always as (private.normalize_text(alias)) stored,
  primary key (area_id, alias)
);
create index on public.area_aliases using gin (alias_normalized extensions.gin_trgm_ops);

create table public.clusters (                    -- launch clusters
  id          uuid primary key default gen_random_uuid(),
  slug        extensions.citext not null unique,  -- 'achrafieh-mar-mikhael'
  name_en     text not null,
  name_ar     text not null,
  target_businesses int not null default 20,
  is_live     boolean not null default false,
  sort        int not null default 0
);
create table public.cluster_areas (
  cluster_id  uuid not null references public.clusters(id) on delete cascade,
  area_id     uuid not null references public.areas(id),
  primary key (cluster_id, area_id)
);
```

Seed data (migration): governorates → districts → areas for Lebanon; clusters `achrafieh-mar-mikhael`, `hamra-verdun`, `hazmieh-baabda` (live), `jounieh-kaslik` (not live).

---

## 4. Catalog / taxonomy

```sql
create table public.categories (
  id                            uuid primary key default gen_random_uuid(),
  parent_id                     uuid references public.categories(id),
  slug                          extensions.citext not null unique,   -- 'beauty-grooming', 'barber'
  name_en text not null, name_ar text not null, name_fr text,
  icon                          text,
  is_live                       boolean not null default false,
  allows_before_after_default   boolean not null default false,
  requires_consultation_default boolean not null default false,
  sort                          int not null default 0,
  …timestamps
);

-- Structured rating dimensions, defined on a root category (subcategories inherit)
create table public.rating_dimensions (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id),
  key          text not null,                    -- 'service_quality', 'cleanliness', 'punctuality', ...
  label_en text not null, label_ar text not null, label_fr text,
  sort         int not null default 0,
  is_active    boolean not null default true,
  unique (category_id, key)
);

create table public.canonical_services (
  id                    uuid primary key default gen_random_uuid(),
  category_id           uuid not null references public.categories(id),
  slug                  extensions.citext not null unique,   -- 'balayage', 'gel-manicure', 'beard-trim'
  name_en text not null, name_ar text not null, name_fr text,
  typical_duration_min  int check (typical_duration_min between 5 and 720),
  allows_before_after   boolean not null default false,
  relevance_hints       text[] not null default '{}',        -- image moderation: {'hair','hairstyle','hair color'}
  is_active             boolean not null default true,
  sort                  int not null default 0,
  …timestamps
);

create table public.service_synonyms (
  id                    uuid primary key default gen_random_uuid(),
  canonical_service_id  uuid not null references public.canonical_services(id) on delete cascade,
  term                  text not null check (char_length(term) <= 60),
  lang                  public.synonym_lang not null,
  term_normalized       text generated always as (private.normalize_text(term)) stored,
  weight                real not null default 1.0,        -- exact name 1.0, loose synonym 0.6
  unique (canonical_service_id, term)
);
create index on public.service_synonyms using gin (term_normalized extensions.gin_trgm_ops);

-- Business "Other" mappings awaiting ops review
create table public.catalog_suggestions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id),
  service_id    uuid,                                  -- FK below
  proposed_name text not null,
  status        text not null default 'open' check (status in ('open', 'mapped', 'created', 'rejected')),
  resolved_canonical_service_id uuid references public.canonical_services(id),
  resolved_by   uuid references auth.users(id),
  …timestamps
);
```

A fallback canonical service `other-{category}` exists per root category, so `services.canonical_service_id` can stay NOT NULL while a suggestion is pending.

---

## 5. Businesses

```sql
create table public.businesses (
  id                   uuid primary key default gen_random_uuid(),
  slug                 extensions.citext not null unique
                       check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'),
  name                 text not null check (char_length(name) between 2 and 80),
  description          text check (char_length(description) <= 1500),
  primary_category_id  uuid not null references public.categories(id),
  audience             public.audience not null default 'everyone',
  status               public.business_status not null default 'draft',
  status_reason        text,
  verification_status  public.verification_status not null default 'unverified',
  verified_at          timestamptz,
  instagram_handle     text check (instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'),
  website_url          text,
  amenities            text[] not null default '{}',     -- 'private_room','parking','card_accepted','wheelchair'
  price_level          smallint check (price_level between 1 and 3),   -- computed nightly
  is_test              boolean not null default false,
  published_at         timestamptz,
  claimed_at           timestamptz,
  created_by           uuid references auth.users(id),     -- ops user for assisted onboarding
  …timestamps
);
create index on public.businesses (status) where not is_test;

create table public.reserved_slugs (slug extensions.citext primary key);   -- 'search','biz','login','r','m','review', area slugs...
create table public.business_slug_history (
  old_slug     extensions.citext primary key,
  business_id  uuid not null references public.businesses(id),
  changed_at   timestamptz not null default now()
);
-- Trigger: slug may not collide with reserved_slugs or business_slug_history of another business;
-- on slug change, insert old slug into history (301 redirects).

create table public.business_categories (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  category_id  uuid not null references public.categories(id),
  is_primary   boolean not null default false,
  primary key (business_id, category_id)
);
create unique index on public.business_categories (business_id) where is_primary;
```

### 5.1 Locations

```sql
create table public.business_locations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id),
  name            text,                                   -- null for single-location businesses
  area_id         uuid not null references public.areas(id),
  address_line    text check (char_length(address_line) <= 200),
  building        text check (char_length(building) <= 80),
  floor           text check (char_length(floor) <= 20),
  landmark        text check (char_length(landmark) <= 160),
  geo             extensions.geography(Point, 4326) not null,
  timezone        text not null default 'Asia/Beirut'
                  check (timezone in ('Asia/Beirut')),    -- widen deliberately when expanding
  phone_e164      text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_e164   text check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status          public.location_status not null default 'draft',
  is_primary      boolean not null default true,
  …timestamps,
  unique (id, business_id)
);
create unique index on public.business_locations (business_id) where is_primary;
create index on public.business_locations using gist (geo);
create index on public.business_locations (area_id) where status = 'live';

create table public.location_hours (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null,
  business_id   uuid not null,
  iso_weekday   smallint not null check (iso_weekday between 1 and 7),
  start_minute  smallint not null check (start_minute between 0 and 1439),
  end_minute    smallint not null check (end_minute between 1 and 1440),
  check (end_minute > start_minute),
  foreign key (location_id, business_id) references public.business_locations (id, business_id) on delete cascade,
  exclude using gist (location_id with =, iso_weekday with =, int4range(start_minute, end_minute) with &&)
);

create table public.location_closures (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null,
  business_id  uuid not null,
  period       daterange not null check (not isempty(period)),
  label        text check (char_length(label) <= 60),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  foreign key (location_id, business_id) references public.business_locations (id, business_id) on delete cascade
);
create index on public.location_closures using gist (location_id, period);
```

**Public visibility rule:** a location appears publicly only when `businesses.status = 'live' and not is_test and business_locations.status = 'live'`. It's implemented once, in `private.is_publicly_visible_location(location_id)`, and used by every public RPC.

### 5.2 Members & invitations

```sql
create table public.business_members (
  business_id  uuid not null references public.businesses(id),
  user_id      uuid not null references auth.users(id),
  role         public.business_role not null,
  status       public.member_status not null default 'active',
  invited_by   uuid references auth.users(id),
  …timestamps,
  primary key (business_id, user_id)
);
create index on public.business_members (user_id) where status = 'active';
-- Exactly one active owner per business
create unique index business_one_owner on public.business_members (business_id)
  where role = 'owner' and status = 'active';

create table private.business_invitations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id),
  phone_e164   text not null,
  role         public.business_role not null,
  staff_id     uuid,                                  -- link staff role invite to staff_members row
  token_hash   text not null unique,                  -- sha256(token); raw token only in the WhatsApp link
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
```

Member changes go through RPCs (`invite_member`, `accept_invitation`, `change_member_role`, `revoke_member`, `transfer_ownership`), each audited. Managers can't modify owners or managers.

### 5.3 Settings

```sql
create table public.business_settings (
  business_id                        uuid primary key references public.businesses(id) on delete cascade,
  allow_online_booking               boolean not null default true,
  booking_mode                       public.booking_mode not null default 'instant',
  request_expiry_minutes             int not null default 240 check (request_expiry_minutes between 15 and 1440),
  min_notice_minutes                 int not null default 60  check (min_notice_minutes between 0 and 10080),
  max_advance_days                   int not null default 30  check (max_advance_days between 1 and 365),
  slot_interval_minutes              int not null default 15  check (slot_interval_minutes in (5, 10, 15, 20, 30, 60)),
  cancellation_window_minutes        int not null default 120 check (cancellation_window_minutes between 0 and 10080),
  staff_choice_mode                  public.staff_choice_mode not null default 'any_or_choose',
  assignment_rule                    public.assignment_rule not null default 'least_booked',
  show_staff_price_differences       boolean not null default true,
  show_staff_appointment_counts      boolean not null default true,
  notify_customer_on_any_reassign    boolean not null default false,
  max_active_bookings_per_customer   int not null default 3 check (max_active_bookings_per_customer between 1 and 20),
  auto_complete_after_minutes        int not null default 360 check (auto_complete_after_minutes between 30 and 2880),
  reception_sees_revenue             boolean not null default false,
  staff_see_customer_phone           boolean not null default false,
  …timestamps,
  check ((max_advance_days * 1440) > min_notice_minutes)
);
```

Settings are per business in the MVP. A `location_settings` override table (same columns, nullable) can be added for multi-location without migrating this one.

### 5.4 Verification (placeholder, [SOON])

```sql
create table public.business_verifications (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id),
  status        public.verification_status not null default 'pending',
  documents     jsonb not null default '[]',        -- storage paths in 'verification-docs' bucket
  checks        jsonb not null default '{}',        -- {phone:true, address:true, owner_id:false, social:true}
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  note          text,
  …timestamps
);
```

---

## 6. Services

```sql
create table public.service_groups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id),
  name         text not null check (char_length(name) between 1 and 60),
  sort         int not null default 0,
  …timestamps,
  unique (id, business_id)
);

create table public.services (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id),
  group_id              uuid,
  canonical_service_id  uuid not null references public.canonical_services(id),
  name                  text not null check (char_length(name) between 1 and 80),
  description           text check (char_length(description) <= 600),
  price_type            public.price_type not null,
  price_min             numeric(10,2) check (price_min >= 0),
  price_max             numeric(10,2),
  currency              char(3) not null default 'USD',
  duration_min          int not null check (duration_min between 5 and 720),
  buffer_before_min     int not null default 0 check (buffer_before_min between 0 and 120),
  buffer_after_min      int not null default 0 check (buffer_after_min between 0 and 120),
  location_type         public.service_location_type not null default 'at_business',
  audience              public.audience not null default 'everyone',
  is_online_bookable    boolean not null default true,
  is_combo              boolean not null default false,
  status                public.lifecycle_status not null default 'active',
  sort                  int not null default 0,
  …timestamps,
  unique (id, business_id),
  foreign key (group_id, business_id) references public.service_groups (id, business_id),
  check (
    (price_type = 'fixed'           and price_min is not null and price_max is null) or
    (price_type = 'from'            and price_min is not null and price_max is null) or
    (price_type = 'range'           and price_min is not null and price_max is not null and price_max > price_min) or  -- [M2: NULL-safe]
    (price_type = 'on_consultation' and price_min is null and price_max is null and not is_online_bookable)
  )
);
create index on public.services (business_id) where status = 'active';
create index on public.services (canonical_service_id) where status = 'active';

-- Combos map to several canonical services for search ("Hair + Beard" → haircut, beard-trim)
create table public.service_combo_items (
  service_id            uuid not null references public.services(id) on delete cascade,
  canonical_service_id  uuid not null references public.canonical_services(id),
  primary key (service_id, canonical_service_id)
);
```

`[SOON]` processing-time segments: `service_segments(service_id, seq, kind active|gap, minutes)`. Occupancy then becomes a multirange per item. That's additive, and the exclusion constraint moves to a per-segment table. It's planned, but not built in the MVP.

---

## 7. Staff

```sql
create table public.staff_members (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id),
  user_id                 uuid references auth.users(id),
  display_name            text not null check (char_length(display_name) between 1 and 60),
  slug                    extensions.citext not null check (slug ~ '^[a-z0-9-]{1,40}$'),
  role_title              text check (char_length(role_title) <= 60),
  bio                     text check (char_length(bio) <= 500),
  photo_media_id          uuid,                              -- business_media (kind staff_photo); FK in Part 4
  gender                  text check (gender in ('female', 'male')),
  -- Visibility & assignment (independent flags)
  publicly_bookable       boolean not null default true,
      -- true : customers can see and specifically choose this person online
      -- false: internal-only; fully usable in dashboard (calendar, manual booking, schedules,
      --        analytics, history) but NEVER returned by any public/customer-facing API
  accepts_any_assignment  boolean not null default true,
      -- true : eligible for automatic assignment when customer picks "Any available"
  assignment_priority     int not null default 100,
  display_order           int not null default 100,
  last_auto_assigned_at   timestamptz,
  status                  public.lifecycle_status not null default 'active',
  archived_at             timestamptz,
  …timestamps,
  unique (id, business_id),
  unique (business_id, slug),
  check ((status = 'archived') = (archived_at is not null)),
  -- An internal-only worker can't receive online "Any" bookings either
  check (publicly_bookable or not accepts_any_assignment)
);
create unique index staff_user_per_business on public.staff_members (business_id, user_id) where user_id is not null;
create index on public.staff_members (business_id) where status = 'active';
```

**The flags combine like this.** The check constraint rules out the one inconsistent combination.

| Worker | `publicly_bookable` | `accepts_any_assignment` | Online "Choose someone" | Online "Any" | Dashboard (calendar, manual booking, "Any" in manual booking, schedules, analytics) |
|---|---|---|---|---|---|
| Normal barber | true | true | ✓ | ✓ | ✓ |
| Senior stylist | true | false | ✓ | ✗ | ✓ (manual "Any" also skips them) |
| Owner / VIP-only | false | false | ✗ never visible | ✗ | ✓ (manual booking must pick them explicitly) |
| *(invalid)* | false | true | — | — | rejected by check constraint |

**Non-leak rule for `publicly_bookable = false` (enforced in every public RPC):**
- Never in staff lists, staff profiles, next-available, slot computation, search documents, or rebook/favorite shortcuts.
- Reviews and results for their bookings **still count toward the business rating**, but public payloads omit the staff name and show "a team member".
- The customer's *own* booking detail and WhatsApp confirmation may show the worker's first name, because it's the customer's own appointment and they know who served them. This is the only customer-facing exception, and it never includes profile, rating or photo.
- A test (Part 7) asserts that no public RPC returns a non-bookable `staff_id` or name.

```sql
create table public.staff_locations (
  staff_id     uuid not null,
  location_id  uuid not null,
  business_id  uuid not null,
  is_primary   boolean not null default true,
  primary key (staff_id, location_id),
  foreign key (staff_id, business_id)    references public.staff_members (id, business_id),
  foreign key (location_id, business_id) references public.business_locations (id, business_id)
);
create index on public.staff_locations (location_id);

create table public.staff_services (
  staff_id               uuid not null,
  service_id             uuid not null,
  business_id            uuid not null,
  duration_min_override  int check (duration_min_override between 5 and 720),
  price_type_override    public.price_type,
  price_min_override     numeric(10,2) check (price_min_override >= 0),
  price_max_override     numeric(10,2),
  is_specialty           boolean not null default false,
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id)   references public.staff_members (id, business_id),
  foreign key (service_id, business_id) references public.services (id, business_id),
  check (price_type_override is null or price_type_override <> 'on_consultation'),
  check ((price_type_override is null) = (price_min_override is null)),
  check (price_max_override is null or price_max_override > price_min_override),
  check (price_type_override is distinct from 'range' or price_max_override is not null),       -- [M2]
  check (price_max_override is null or price_type_override is not distinct from 'range')        -- [M2: NULL-safe]
);
create index on public.staff_services (service_id);
-- Constraint trigger: at most 3 rows with is_specialty per staff_id.
```

**Effective price/duration** for (staff, service) = override if set, else the service's value. It's computed only in `private.staff_service_terms(staff_id, service_id)`, which returns `(duration_min, buffer_before_min, buffer_after_min, price_type, price_min, price_max)`.

---

## 8. Staff schedules

```sql
-- Weekly recurring hours per (staff, location). Multiple intervals/day; gaps = breaks; no rows = day off.
create table public.staff_weekly_hours (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null,
  location_id     uuid not null,
  business_id     uuid not null,
  iso_weekday     smallint not null check (iso_weekday between 1 and 7),
  start_minute    smallint not null check (start_minute between 0 and 1439),
  end_minute      smallint not null check (end_minute between 1 and 1440),
  effective_from  date not null default current_date,
  effective_to    date,                                   -- exclusive; null = open-ended
  check (end_minute > start_minute),
  check (effective_to is null or effective_to > effective_from),
  foreign key (staff_id, location_id) references public.staff_locations (staff_id, location_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff_members (id, business_id),              -- [M2: tenant integrity]
  exclude using gist (
    staff_id with =, iso_weekday with =,
    int4range(start_minute, end_minute) with &&,
    daterange(effective_from, effective_to) with &&
  )
);
create index on public.staff_weekly_hours (staff_id, location_id, iso_weekday);
```

A cross-location overlap check (same staff, two locations, overlapping hours) is a constraint trigger. It becomes relevant only with multi-location.

```sql
-- Date-specific replacement. If any row exists for (staff, date), weekly hours are ignored that date.
create table public.staff_schedule_overrides (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null,
  location_id   uuid not null,
  business_id   uuid not null,
  on_date       date not null,
  is_working    boolean not null,
  start_minute  smallint check (start_minute between 0 and 1439),
  end_minute    smallint check (end_minute between 1 and 1440),
  note          text check (char_length(note) <= 120),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  foreign key (staff_id, location_id) references public.staff_locations (staff_id, location_id) on delete cascade,
  check ((is_working and start_minute is not null and end_minute is not null and end_minute > start_minute)  -- [M2: NULL-safe]
      or (not is_working and start_minute is null and end_minute is null)),
  foreign key (staff_id, business_id) references public.staff_members (id, business_id),              -- [M2: tenant integrity]
  exclude using gist (
    staff_id with =, on_date with =,
    int4range(coalesce(start_minute, 0), coalesce(end_minute, 1440)) with &&
  )
);
-- Constraint trigger: a date can't have both an is_working=false row and working rows.

create table public.staff_time_off (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null,
  business_id  uuid not null,
  period       tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  kind         public.time_off_kind not null default 'personal',
  reason       text check (char_length(reason) <= 200),   -- private (owner/manager/self)
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff_members (id, business_id)
);
create index on public.staff_time_off using gist (staff_id, period);
```

Time off may overlap existing bookings. The DB allows it on purpose, and the UI runs the "keep / reassign / cancel & notify" flow. Availability simply stops offering the time.

### 8.1 Staff stats cache

```sql
create table public.staff_stats (
  staff_id                         uuid primary key references public.staff_members(id) on delete cascade,
  business_id                      uuid not null,
  verified_review_count            int not null default 0,
  rating_sum                       int not null default 0,
  rating_display                   numeric(2,1),        -- plain mean; shown publicly only if count >= 5
  completed_verified_appointments  int not null default 0,
  specifically_requested_count     int not null default 0,
  completed_count                  int not null default 0,
  favorites_count                  int not null default 0,
  next_available_at                timestamptz,         -- public-bookable staff only
  updated_at                       timestamptz not null default now()
);
```
