# Phase 3 · Part 5 — Search, Ranking, CRM, Favorites & Rebooking, Notifications, Analytics, Audit, Billing Placeholders

---

## 1. Text normalization (search)

```sql
-- IMMUTABLE wrapper (unaccent with an explicit dictionary is safe to mark immutable)
create function private.normalize_text(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(
             translate(
               lower(extensions.unaccent('extensions.unaccent'::regdictionary, private.normalize_digits(coalesce(p, '')))),
               'أإآٱىةؤئ', 'اااايهوي'),              -- alef forms→ا, ى→ي, ة→ه, ؤ→و, ئ→ي
             '[ً-ْٰـ]', '', 'g'),   -- harakat, dagger alef, tatweel
           '\s+', ' ', 'g')) $$;

-- Arabizi folding for Latin tokens that contain digits: 2→'' 3→a 5→kh 6→t 7→h 8→gh 9→q,
-- collapse doubled letters. "7ala2" → "hala", "m3allim" → "maalim" → "malim".
create function private.arabizi_fold(p text) returns text language plpgsql immutable parallel safe ...;

-- The search key used everywhere
create function private.search_key(p text) returns text language sql immutable parallel safe as $$
  select private.arabizi_fold(private.normalize_text(p)) $$;
```

- `service_synonyms.term_normalized`, `area_aliases.alias_normalized` and search documents all use `search_key`. Explicit synonyms still carry most of the work: ops add real variants ("7ala2", "حلاق", "coiffeur homme", "barber") in the Catalog screen.
- **Arabizi → Arabic normalization for moderation isn't done in SQL.** The moderation worker (TypeScript + LLM) writes it to `review_text_private.text_normalized`. SQL folding is for search matching only.

---

## 2. Search

### 2.1 `search_documents` (one row per publicly visible location)

```sql
create table public.search_documents (
  location_id            uuid primary key references public.business_locations(id) on delete cascade,
  business_id            uuid not null references public.businesses(id),
  business_slug          extensions.citext not null,
  name                   text not null,
  name_key               text not null,                 -- search_key(name)
  area_id                uuid not null,
  cluster_id             uuid,
  geo                    extensions.geography(Point, 4326) not null,
  category_ids           uuid[] not null,
  canonical_service_ids  uuid[] not null,               -- only services with ≥1 public-bookable staff (or on_consultation)
  service_terms          text not null,                 -- search_key of service names + synonyms
  tsv                    tsvector not null,             -- 'simple' config: name (A) + service_terms (B) + area aliases (C)
  audience               public.audience not null,
  price_level            smallint,
  service_prices         jsonb not null default '{}',   -- {canonical_id: {"type":"from","min":65,"max":null,"duration":150}}
  display_rating         numeric(2,1),                  -- null when < 5 reviews
  review_count           int not null default 0,
  quality_score          numeric(5,2) not null default 0,
  labels                 public.discovery_label[] not null default '{}',
  published_at           timestamptz,
  next_available_at      timestamptz,                   -- public audiences only
  updated_at             timestamptz not null default now()
);
create index on public.search_documents using gin (tsv);
create index on public.search_documents using gin (name_key extensions.gin_trgm_ops);
create index on public.search_documents using gin (service_terms extensions.gin_trgm_ops);
create index on public.search_documents using gin (canonical_service_ids);
create index on public.search_documents using gist (geo);
create index on public.search_documents (cluster_id, quality_score desc);
```

- **Only publicly visible locations get a row.** The refresh deletes the row when the business/location stops being visible.
- **No staff data is stored here.** Staff never appear in search at launch. Searching by staff name ([LATER]) would index only `publicly_bookable` staff.
- **Refresh:** triggers on businesses, locations, services, staff_services, staff_members, synonyms and reviews summary insert the `location_id` into `private.search_refresh_queue (location_id pk, requested_at)`. A per-minute job rebuilds the queued documents (`private.refresh_search_document(location_id)`). A full rebuild runs nightly.

### 2.2 Search RPCs (public, `anon` + `authenticated`)

| Function | Returns |
|---|---|
| `search_suggest(q, cluster_id default null)` | Up to 5 each of: **services** (synonym trigram/prefix match → canonical service + count of places offering it in the cluster), **businesses** (name_key trigram), **areas** (alias trigram). Uses `search_key(q)`. |
| `search_businesses(q, canonical_service_id, category_id, cluster_id, area_id, lat, lng, filters jsonb, sort, cursor)` | Cards: business, location, area, distance, rating/labels, price level, next available, and — when a service is known — that service's price/duration and next slot for it. |
| `get_business_page(slug)` | Everything C1 needs in one payload (identity, services with public-bookable staff counts, public staff, featured + organic results preview, rating summary, 3 reviews, hours, contact). Resolves `business_slug_history` for redirects (returns `redirect_to`). |
| `get_staff_options(location_id, service_id)` | C8 cards: public staff only, specialties, stats (display rules), next available, overrides, plus the caller's rebook shortcut and favorites (if signed in). |

**`filters` keys:** `available_today`, `date`, `time_from`, `time_to`, `price_levels[]`, `min_rating`, `audience`, `max_km`, `staff_gender` [SOON], `verified_only` [SOON].

- `available_today` uses `next_available_at` (fast).
- `date`/time windows run the availability engine for at most the top 40 candidates after the other filters (bounded cost).

**Query-time scoring (sort = recommended):**

```
score = w_quality   × quality_score / 100
      + w_proximity × exp(−distance_km / proximity_scale_km)          (0 if no location)
      + w_avail     × availability_fit                                (1 today/within window, 0.5 within 3 days, 0)
      + w_personal  × personal                                        (favorited 1, booked before 0.7; signed-in only)
      + new_boost   × max(0, 1 − days_since_published / new_boost_days)
```

The weights come from the active `ranking_configs.params.query`. Text relevance is a **gate** (it must match the service, category or name), not a score component, so businesses can't keyword-stuff their way up.

- `private.search_log (id, q, q_key, cluster_id, canonical_service_id, results_count, user_hash, created_at)` feeds the admin "zero-result queries" list.
- **Sponsored results are merged only by `search_businesses_with_sponsored`** ([LATER]) into fixed positions, with `is_sponsored = true`. The organic function never reads the sponsored tables.

---

## 3. Ranking configuration, scores, labels

```sql
create table public.ranking_configs (
  id            uuid primary key default gen_random_uuid(),
  version       int not null unique,
  status        public.config_status not null default 'draft',
  params        jsonb not null check (private.validate_ranking_params(params)),
  reason        text,
  created_by    uuid not null references auth.users(id),
  published_by  uuid references auth.users(id),
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);
create unique index ranking_one_active on public.ranking_configs ((true)) where status = 'active';
```

**`params` (version 1 seed):**

```json
{
  "quality_weights": { "rating": 35, "volume": 20, "recent": 15, "reliability": 10, "completeness": 10, "responsiveness": 10 },
  "bayes": { "prior_strength_c": 10, "prior_scope": "root_category_x_cluster", "half_life_days": 180, "recent_window_days": 60,
             "overall_share": 0.6, "dimensions_share": 0.4 },
  "trust": { "verified_booking": 1.0, "verified_visit": 0.5, "verified_visit_cap_share": 0.4 },
  "volume": { "window_days": 90, "count_sources": ["marketplace_search","marketplace_home","marketplace_other","business_link","rebook","waitlist","promotion"] },
  "query": { "quality": 0.55, "proximity": 0.20, "availability": 0.15, "personal": 0.10,
             "proximity_scale_km": 3, "new_boost": 0.08, "new_boost_days": 60 },
  "labels": {
    "top_rated":         { "min_display_rating": 4.7, "min_reviews": 25, "top_quality_pct": 20 },
    "top_cleanliness":   { "dimension": "cleanliness", "min_avg": 4.7, "min_ratings": 20 },
    "great_punctuality": { "dimension": "punctuality", "min_avg": 4.7, "min_ratings": 20 },
    "popular_near_you":  { "top_bookings_pct": 15, "window_days": 30 },
    "best_value":        { "dimension": "value_for_money", "min_avg": 4.6, "max_price_level_vs_median": 0 },
    "new":               { "max_days_live": 60 },
    "priority": ["top_rated","available_today","top_cleanliness","great_punctuality","best_value","popular_near_you","new"],
    "max_per_card": 2
  }
}
```

`private.validate_ranking_params(jsonb)` (IMMUTABLE) checks that the required keys exist, `quality_weights` sum to 100, and every value is in range. RPCs: `admin_create_ranking_draft(params, reason)`, `admin_publish_ranking(version, reason)` (superadmin; switches active atomically **after** the recompute job finishes with the new version), `admin_rollback_ranking(version, reason)`, `admin_explain_rank(business_id, q)`.

```sql
create table public.business_quality_scores (
  business_id     uuid primary key references public.businesses(id) on delete cascade,
  config_version  int not null,
  score           numeric(5,2) not null,        -- 0..100
  bayes_rating    numeric(4,3),                 -- internal; never displayed
  components      jsonb not null,               -- {"rating":0.83,"volume":0.41,...,"inputs":{...}}
  computed_at     timestamptz not null default now()
);

create table public.business_quality_score_history (
  business_id     uuid not null references public.businesses(id) on delete cascade,
  day             date not null,
  config_version  int not null,
  score           numeric(5,2) not null,
  components      jsonb not null,
  primary key (business_id, day, config_version)
);

create table public.business_labels (
  business_id     uuid not null references public.businesses(id) on delete cascade,
  label           public.discovery_label not null,
  config_version  int not null,
  computed_at     timestamptz not null default now(),
  primary key (business_id, label)
);
```

`available_today` is computed at query time from `next_available_at`, not stored.

**`private.compute_quality_scores(p_version int)`** is set-based SQL, run nightly and on publish:
1. **Review weight** `w = base_weight × fraud_multiplier × 0.5^(age_days / half_life)` for reviews where `private.rating_is_counted(review)` (quarantined, pending-check and removed ratings are excluded).
2. **Verified Visit cap:** per business, if `Σw_visit > cap/(1−cap) × Σw_booking`, scale the visit weights down to exactly the cap share.
3. **Prior mean** `m` per (root category × cluster). **Bayesian:** `bayes = (C·m + Σ w·r) / (C + Σ w)`. The same is done per dimension and blended by `overall_share` / `dimensions_share`. Normalize with `(bayes − 1) / 4`.
4. **Volume:** percentile of `ln(1 + completed bookings from count_sources in window)` within root category × cluster.
5. **Recent:** Bayesian over `recent_window_days`.
6. **Reliability:** `1 − clamp(2 × business_cancel_rate + expired_request_rate + no_show_overturn_rate, 0, 1)`, over 90 days.
7. **Completeness:** fraction of: cover, ≥5 portfolio photos, description, hours, ≥80% services mapped to non-"other" canonical, public staff with photos, verified (Soon).
8. **Responsiveness:** median request acceptance time score + review reply rate within 7 days.
9. `score = Σ weight_i × component_i`. Then write scores, the daily history, labels (from rules), and enqueue search document refresh.

**Displayed rating ≠ ranking score by design:** `display_rating` is the plain mean of published verified ratings; `bayes_rating` stays internal.

---

## 4. Business CRM

`business_customers` is defined in Part 2. Additions:

```sql
create table public.customer_notes (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null,
  business_customer_id  uuid not null,
  author_user_id        uuid not null references auth.users(id),
  body                  text not null check (char_length(body) between 1 and 1000),
  is_pinned             boolean not null default false,        -- pinned note shows on calendar popover
  visible_to_staff      boolean not null default false,
  deleted_at            timestamptz,
  …timestamps,
  foreign key (business_customer_id, business_id) references public.business_customers (id, business_id)
);
create index on public.customer_notes (business_customer_id, created_at desc) where deleted_at is null;
```

**CRM read model via RPCs (role-projected):**
- `biz_search_customers(business_id, q, segment, sort, cursor)`: phone digits → exact/prefix on `phone_e164`; letters → trigram on the name.
- `biz_get_customer(business_id, business_customer_id)`: stats, upcoming bookings, history, notes, and `reliability_label` (via `customer_reliability_label`, only when `user_id` is set; otherwise `new_customer`).
  - **Reception:** `lifetime_spend` omitted unless `reception_sees_revenue`.
  - **Staff:** only customers with an upcoming booking with them; name, upcoming visits, `visible_to_staff` notes; phone only if `staff_see_customer_phone`.
  - **Never included:** the customer's reviews, cross-business data, platform profile fields.
- Writes: `biz_upsert_customer(business_id, {id?, display_name, phone})`, `biz_add_note`, `biz_update_note`, `biz_delete_note` (soft), `biz_set_blocked_online` [SOON], `biz_import_customers(csv rows)` [SOON].

---

## 5. Favorites & rebooking

```sql
create table public.customer_favorite_businesses (
  user_id      uuid not null references auth.users(id) on delete cascade,
  business_id  uuid not null references public.businesses(id),
  created_at   timestamptz not null default now(),
  primary key (user_id, business_id)
);
create table public.customer_favorite_staff (
  user_id      uuid not null references auth.users(id) on delete cascade,
  staff_id     uuid not null references public.staff_members(id),
  business_id  uuid not null references public.businesses(id),
  created_at   timestamptz not null default now(),
  primary key (user_id, staff_id)
);
create index on public.customer_favorite_staff (staff_id);
```

| Function | Behavior |
|---|---|
| `toggle_favorite_business(business_id)` | The business must be publicly visible to add; removing is always allowed. |
| `toggle_favorite_staff(staff_id)` | To add, the staff member must be `publicly_bookable`, active, at a visible business. Sets `business_id` from the staff member. |
| `get_my_favorites()` | `{people:[…], places:[…]}`, each with next available. People whose staff member is no longer bookable come back with `bookable = false` and a reason (`left_business` / `not_bookable_online`) and **no staff profile data** beyond the stored first name. |
| `get_rebook_suggestions(limit 3)` | `DISTINCT ON (business_id)` over the caller's completed bookings, most recent first. For each: business (if visible), service (if still active and online-bookable), staff (**only if still `publicly_bookable`, active, linked to the location, and performing the service**; else null + `staff_unavailable_reason`), `days_since`, next available for (service, staff or Any). Favorited staff are appended if not already present. |

Rebooking uses `create_hold(..., p_staff_id, p_selection_mode => 'rebook', p_source => 'rebook')`.

---

## 6. Notifications

```sql
create table public.notification_templates (
  type                    public.notification_type not null,
  channel                 public.notification_channel not null,
  locale                  public.app_locale not null,
  version                 int not null default 1,
  provider_template_name  text,                      -- WhatsApp approved template name
  body                    text not null,             -- rendering source for push/sms/in_app/email
  variables               text[] not null default '{}',
  status                  text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected')),
  is_active               boolean not null default false,
  created_at              timestamptz not null default now(),
  primary key (type, channel, locale, version)
);
create unique index on public.notification_templates (type, channel, locale) where is_active;

create table public.notifications (                  -- outbox + in-app inbox
  id                     uuid primary key default gen_random_uuid(),
  type                   public.notification_type not null,
  recipient_user_id      uuid references auth.users(id) on delete cascade,
  recipient_phone        text,                       -- shadow customers (no account)
  recipient_business_id  uuid references public.businesses(id),   -- set for business notifications
  booking_id             uuid references public.bookings(id) on delete cascade,
  review_id              uuid references public.reviews(id) on delete set null,
  payload                jsonb not null default '{}',               -- template variables + deep link
  locale                 public.app_locale not null default 'en',
  dedupe_key             text unique,                -- e.g. 'reminder_24h:{booking_id}'
  scheduled_for          timestamptz not null default now(),
  status                 public.notification_status not null default 'queued',
  attempts               smallint not null default 0,
  last_error             text,
  sent_at                timestamptz,
  read_at                timestamptz,                -- in-app inbox
  created_at             timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_phone is not null)
);
create index on public.notifications (status, scheduled_for) where status = 'queued';
create index on public.notifications (recipient_user_id, created_at desc);
create index on public.notifications (booking_id);

create table public.notification_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  notification_id      uuid not null references public.notifications(id) on delete cascade,
  channel              public.notification_channel not null,
  provider             text not null,                -- 'meta_whatsapp' | 'expo' | 'sms_provider' | 'resend'
  provider_message_id  text,
  status               public.delivery_status not null default 'queued',
  error_code           text,
  cost_micros          bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index on public.notification_deliveries (provider, provider_message_id) where provider_message_id is not null;

create table public.notification_preferences (
  user_id   uuid not null references auth.users(id) on delete cascade,
  channel   public.notification_channel not null,
  enabled   boolean not null default true,
  primary key (user_id, channel)
);

create table public.business_notification_settings (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         public.notification_type not null,
  channels     public.notification_channel[] not null default '{whatsapp,push}',
  primary key (business_id, user_id, type)
);

create table public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  expo_token    text not null unique,
  platform      text not null check (platform in ('ios', 'android')),
  last_seen_at  timestamptz not null default now(),
  disabled_at   timestamptz
);

create table private.whatsapp_inbound (
  id                   uuid primary key default gen_random_uuid(),
  provider_message_id  text not null unique,
  from_phone           text not null,
  kind                 text not null check (kind in ('button', 'text', 'status')),
  payload              jsonb not null,
  processed_at         timestamptz,
  created_at           timestamptz not null default now()
);
```

**Routing (config in `private.notification_routes (type, primary channel[], fallback channel[], critical bool)`):**

| Type group | Primary | Fallback (critical only) |
|---|---|---|
| Booking confirmed / requested / cancelled / rescheduled / staff changed / reminders | WhatsApp (buttons: Confirm · Cancel · Reschedule link) + in-app | SMS if WhatsApp fails or is undeliverable |
| Waitlist offer | push + WhatsApp | SMS |
| Review request, review/result published or rejected, dispute update | push (app) or WhatsApp (web-only customers) + in-app | — |
| OTP | WhatsApp | SMS |
| Business alerts | per `business_notification_settings` (default WhatsApp + push) | — |

- **Customer preferences are respected, but at least one of push / WhatsApp / SMS must stay enabled** (enforced in `set_notification_preference`).
- **Dispatch:** a pg_cron job (every minute) calls the `notify-dispatch` Edge Function via `pg_net`. The function claims due rows with `private.claim_due_notifications(limit)` (`for update skip locked`, status → processing), renders the template, sends, writes deliveries, and sets the final status. Retries use backoff (1, 5, 15 min, max 4 attempts).
- **Reminders** are inserted at confirm/reschedule with `dedupe_key`. Cancellation or reschedule marks the old ones `cancelled`.
- **WhatsApp webhook** (Edge Function, signature verified): statuses → `notification_deliveries`. Buttons:
  - **Confirm** → `private.customer_confirm_attendance(booking_id, from_phone)`, which checks that the phone matches the booking customer and sets `customer_confirmed_at` (event `customer_confirmed`).
  - **Cancel** → replies with the manage link. It doesn't cancel directly, so the customer sees the policy first and can't cancel by accident.
- **In-app inbox:** `get_my_notifications(cursor)`, `mark_notifications_read(ids)`.

---

## 7. Business analytics rollups

```sql
create table public.business_daily_metrics (
  business_id               uuid not null,
  location_id               uuid not null,
  day                       date not null,               -- local (Beirut) day
  bookings_created          int not null default 0,
  bookings_completed        int not null default 0,
  revenue_min               numeric(12,2) not null default 0,
  revenue_max               numeric(12,2) not null default 0,
  cancellations_customer    int not null default 0,
  cancellations_business    int not null default 0,
  late_cancels              int not null default 0,
  no_shows                  int not null default 0,
  new_customers             int not null default 0,
  returning_customers       int not null default 0,
  booked_minutes            int not null default 0,
  available_minutes         int not null default 0,      -- from staff working time
  src_marketplace           int not null default 0,
  src_business_link         int not null default 0,
  src_manual                int not null default 0,
  src_rebook                int not null default 0,
  primary key (business_id, location_id, day)
);

create table public.staff_daily_metrics (
  staff_id                 uuid not null,
  business_id              uuid not null,
  day                      date not null,
  bookings_completed       int not null default 0,
  revenue_min              numeric(12,2) not null default 0,
  booked_minutes           int not null default 0,
  available_minutes        int not null default 0,
  specifically_requested   int not null default 0,
  no_shows                 int not null default 0,
  primary key (staff_id, day)
);
```

- Built nightly for the **last 7 days** (late no-show marks and completions change recent days). `biz_get_analytics(business_id, from, to, compare)` merges the rollups with a live computation for today.
- Internal-only staff appear normally in business analytics.
- Product/funnel analytics go to **PostHog**, not Postgres. There's no generic event table in the MVP.

---

## 8. Audit

```sql
create table audit.admin_actions (
  id              bigint generated always as identity primary key,
  actor_user_id   uuid not null,
  actor_role      public.admin_role not null,
  action          text not null,              -- 'moderation.decide','business.suspend','ranking.publish',...
  subject_type    text not null,
  subject_id      uuid,
  business_id     uuid,
  reason_code     text not null,
  note            text,
  before          jsonb,
  after           jsonb,
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index on audit.admin_actions (subject_type, subject_id, created_at desc);
create index on audit.admin_actions (actor_user_id, created_at desc);
create index on audit.admin_actions (business_id, created_at desc);

create table audit.entity_changes (
  id             bigint generated always as identity primary key,
  table_name     text not null,
  row_id         uuid not null,
  business_id    uuid,
  actor_user_id  uuid,                        -- auth.uid() at time of change (null = system/service)
  actor_kind     public.actor_kind not null,
  op             text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  changed        jsonb not null,              -- {"column": [old, new], ...} (UPDATE: changed columns only)
  created_at     timestamptz not null default now()
);
create index on audit.entity_changes (table_name, row_id, created_at desc);
create index on audit.entity_changes (business_id, created_at desc);
```

- **Generic trigger `audit.capture()`** runs on: businesses, business_settings, business_members, business_locations, location_hours, location_closures, services, staff_members, staff_services, staff_weekly_hours, staff_schedule_overrides, staff_time_off, customer_notes (UPDATE/DELETE), review_replies, admin_users, ranking_configs, business_subscriptions.
- **Immutability:** `revoke update, delete, truncate on all tables in schema audit from public, anon, authenticated, service_role;` plus a `before update or delete` trigger that raises. `booking_events` gets the same treatment.
- Admin read: `admin_get_audit(filters, cursor)`. PII in `before`/`after` is masked for non-superadmin roles.
- Retention: 2 years online. Monthly partitioning (pg_partman) is added when volume warrants it; that's additive.

---

## 9. Subscription / payment placeholders (schema only; no writers at launch)

```sql
create table public.plans (
  id             uuid primary key default gen_random_uuid(),
  key            extensions.citext not null unique,      -- 'launch_free', 'free', 'pro', 'business'
  name           text not null,
  price_monthly  numeric(10,2),
  currency       char(3) not null default 'USD',
  is_public      boolean not null default false,
  is_active      boolean not null default true,
  sort           int not null default 0
);
create table public.plan_entitlements (
  plan_id  uuid not null references public.plans(id) on delete cascade,
  key      text not null,                 -- 'crm','advanced_analytics','staff_max','promotions','multi_location'
  value    jsonb not null,                -- true | 10 | {"limit":...}
  primary key (plan_id, key)
);
create table public.business_subscriptions (
  business_id                uuid primary key references public.businesses(id),
  plan_id                    uuid not null references public.plans(id),
  status                     public.subscription_status not null default 'free_launch',
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  provider                   text,
  provider_customer_ref      text,
  provider_subscription_ref  text,
  cancel_at                  timestamptz,
  …timestamps
);
-- private.has_entitlement(business_id, key) → boolean; 'launch_free' grants all MVP features.

create table public.payments (                 -- future deposits / subscription charges
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id),
  booking_id    uuid references public.bookings(id),
  kind          text not null check (kind in ('deposit', 'full', 'refund', 'subscription')),
  amount        numeric(10,2) not null check (amount >= 0),
  currency      char(3) not null default 'USD',
  provider      text not null,
  provider_ref  text,
  status        public.payment_status not null,
  created_at    timestamptz not null default now()
);

create table public.marketplace_fees (         -- future acquisition fee ledger (never on business-owned customers)
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null unique references public.bookings(id),
  business_id  uuid not null references public.businesses(id),
  basis        text not null check (basis in ('marketplace_acquired_first_booking')),
  amount       numeric(10,2) not null,
  currency     char(3) not null default 'USD',
  status       text not null default 'accrued' check (status in ('accrued', 'waived', 'invoiced')),
  created_at   timestamptz not null default now()
);

create table public.sponsored_placements (     -- [LATER]; organic ranking never reads this table
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id),
  cluster_id            uuid references public.clusters(id),
  category_id           uuid references public.categories(id),
  canonical_service_id  uuid references public.canonical_services(id),
  position              smallint not null check (position between 1 and 20),
  starts_at             timestamptz not null,
  ends_at               timestamptz not null check (ends_at > starts_at),
  status                text not null default 'scheduled' check (status in ('scheduled', 'active', 'ended', 'cancelled')),
  created_by            uuid not null references auth.users(id),
  created_at            timestamptz not null default now()
);
```

Everything this future work needs is already captured at launch: `bookings.source`, `business_customers.acquired_via`, `first_booking_id`, `payment_status`.
