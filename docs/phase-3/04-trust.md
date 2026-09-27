# Phase 3 · Part 4 — Trust: Reviews, Ratings, Customer Results, Moderation, Reports, Disputes, Fraud

Principles (locked):
- Verified-only. **One review per booking.** The tier is frozen at creation.
- **Ratings, text, and each image have independent state.** Rejecting a photo never touches the text or stars.
- Businesses can reply, report and feature. They can **never delete, hide or reorder** organic customer content.
- Everything uploaded by customers is **private until approved**.
- Every admin decision is audited (Part 5 §8).

---

## 1. Reviews

```sql
create table public.reviews (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null unique references public.bookings(id),
  booking_item_id       uuid not null references public.booking_items(id),   -- primary item (MVP: the only one)
  business_id           uuid not null references public.businesses(id),
  location_id           uuid not null,
  staff_id              uuid not null,                  -- denormalized from the item (internal-only staff allowed; hidden publicly)
  service_id            uuid not null,
  canonical_service_id  uuid not null references public.canonical_services(id),
  author_user_id        uuid not null references auth.users(id),
  trust_tier            public.trust_tier not null,     -- frozen at insert (trigger blocks update)
  visit_at              timestamptz not null,           -- booking start
  overall               smallint not null check (overall between 1 and 5),
  text_original         text check (char_length(text_original) between 20 and 2000),
  text_display          text,                           -- null = show original (if approved); set only for redactions
  text_state            public.content_state,           -- null when no text
  rating_state          public.rating_state not null default 'pending_check',   -- pending_check → active | quarantined → removed
  fraud_checked_at      timestamptz,
  status                public.review_status not null default 'pending',
  base_weight           numeric(3,2) not null,          -- verified_booking 1.00 · verified_visit 0.50 (from ranking config at insert)
  fraud_multiplier      numeric(3,2) not null default 1.00 check (fraud_multiplier between 0 and 1),
  detected_langs        text[] not null default '{}',   -- {'ar','en','arabizi'}
  edit_count            smallint not null default 0 check (edit_count <= 1),
  editable_until        timestamptz not null,           -- created_at + 7 days
  legal_hold            boolean not null default false, -- blocks hard deletion; content may be hidden
  published_at          timestamptz,
  removed_at            timestamptz,
  removed_reason        text,
  deleted_at            timestamptz,
  …timestamps,
  foreign key (location_id, business_id) references public.business_locations (id, business_id),
  foreign key (staff_id, business_id)    references public.staff_members (id, business_id),
  foreign key (service_id, business_id)  references public.services (id, business_id),
  check ((text_original is null) = (text_state is null)),
  check (status <> 'deleted_by_author' or deleted_at is not null)
);
create index on public.reviews (business_id, published_at desc) where status = 'published';
create index on public.reviews (staff_id, published_at desc) where status = 'published';
create index on public.reviews (author_user_id, created_at desc);
create index on public.reviews (canonical_service_id) where status = 'published';

create table public.review_ratings (                 -- structured dimensions
  review_id     uuid not null references public.reviews(id) on delete cascade,
  dimension_id  uuid not null references public.rating_dimensions(id),
  score         smallint not null check (score between 1 and 5),
  primary key (review_id, dimension_id)
);
-- Trigger: dimension must belong to the business's root category.

create table private.review_text_private (           -- internal-only analysis data
  review_id         uuid primary key references public.reviews(id) on delete cascade,
  text_normalized   text,                              -- Arabizi→Arabic, diacritics stripped, etc.
  pii_spans         jsonb not null default '[]',       -- [{start,end,type}]
  classifier        jsonb,                             -- last LLM output
  updated_at        timestamptz not null default now()
);

create table private.review_text_versions (           -- edit history (admin-visible)
  review_id   uuid not null references public.reviews(id) on delete cascade,
  version     smallint not null,
  text        text,
  overall     smallint,
  created_at  timestamptz not null default now(),
  primary key (review_id, version)
);

create table public.review_replies (
  id               uuid primary key default gen_random_uuid(),
  review_id        uuid not null unique references public.reviews(id) on delete cascade,
  business_id      uuid not null references public.businesses(id),
  author_user_id   uuid not null references auth.users(id),
  text_original    text not null check (char_length(text_original) between 2 and 1500),
  text_display     text,
  text_state       public.content_state not null default 'pending',
  published_at     timestamptz,
  …timestamps
);

create table public.content_translations (
  subject_type   text not null check (subject_type in ('review', 'reply')),
  subject_id     uuid not null,
  target_locale  public.app_locale not null,
  text           text not null,
  source_langs   text[] not null,
  model          text not null,
  created_at     timestamptz not null default now(),
  primary key (subject_type, subject_id, target_locale)
);
```

### 1.1 Visibility rules (public RPCs enforce these)

| Part | Public when |
|---|---|
| Review card (stars + dimensions) | `private.rating_is_counted(review)`: `status = 'published' and rating_state = 'active' and fraud_multiplier > 0`, with no open fraud investigation. **The same predicate is used by the rating summary, staff stats, labels and ranking.** There's exactly one definition. |
| Text | the card is public and `text_state in ('approved','approved_redacted')` → `coalesce(text_display, text_original)` |
| Each photo | the card is public and `review_media.state = 'approved'` |
| Reply | `text_state in ('approved','approved_redacted')` and review text not removed |
| Staff name on card/result | only if the staff member is `publicly_bookable` and active; otherwise "a team member" |

**Publication is event-driven, not timer-driven.** The rating and the text move independently:

| Situation | Rating | Text | Public card |
|---|---|---|---|
| Fraud pre-check clean, text awaiting moderation (incl. manual review) | `active` → counted | `pending` / `manual_review` | Stars only; text appears when approved |
| Image rejected | unchanged (`active`) | unchanged | Card without that image |
| Text rejected for abuse | stays `active` → counted | `rejected` | Stars only |
| Suspected fake / coordinated (fraud signal ≥ investigation threshold) | `quarantined` → **not counted, not displayed** | held | **Hidden entirely** until resolved |
| Investigation dismissed | back to `active` | resumes its own state | Visible |
| Investigation confirmed | `removed` | `removed` | Gone (author notified) |

- **The fraud pre-check is synchronous** inside `submit_review` (`private.fraud_precheck(review_id)`). It runs the fast detectors: member/staff match (hard block), new account, device cluster, IP cluster, burst.
  - All signals below the investigation threshold (`moderation_config.fraud.investigation_threshold`, default **0.5**) → `rating_state = 'active'`, `fraud_checked_at = now()`, `status = 'published'`, `published_at = now()`.
  - Any signal ≥ the threshold → `rating_state = 'quarantined'`, `status` stays `pending`, and a `moderation_cases(source 'fraud')` is opened.
- **Slow detectors** (nightly duplicate text, clusters that form later) can quarantine an already-published review retroactively. The rating summary, staff stats and search documents are recomputed immediately.
- **There's no 30-minute timer.** A review with a clean pre-check publishes its stars at once, whatever the text state.

A `quarantined` review stays visible to its author ("Being checked"). It's excluded from public display, the rating summary, staff stats, labels and ranking until resolved.

### 1.2 Eligibility — `private.review_eligibility(p_booking_id, p_user_id)`

Returns `(eligible boolean, tier trust_tier, reason text)`. It checks:
1. `bookings.customer_user_id = p_user_id`.
2. Status is `completed`, **or** `no_show` with `no_show_disputed = true` and the dispute still open (a pending dispute doesn't block the review).
3. `now() <= review_eligible_until` (completed) or `no_show_at + 30 days` (disputed).
4. No existing review for the booking.
5. The author is not now, and has never been, a member of the business (`business_members`, any status), is not linked to any of its `staff_members.user_id`, and their phone doesn't match any member's verified phone.
6. **Tier:**
   - `verified_booking` when `source not in ('manual','walk_in')` (customer-initiated on the platform, via marketplace or business link).
   - `verified_visit` when `source in ('manual','walk_in')` and `customer_user_id` was set by an explicit claim (Part 2 §2.3 Flow A/B) or by a manual booking on an already-claimed relationship. It's never set by phone verification alone.

### 1.3 Review RPCs

| Function | Behavior |
|---|---|
| `submit_review(booking_id, overall, ratings jsonb {dimension_key: score}, text, idempotency_key)` | Checks eligibility; rate limit (5/day per user); inserts review + ratings (`base_weight` from active ranking config; `editable_until = now() + 7d`). Runs `private.fraud_precheck` in the same transaction, which publishes or quarantines the rating (§1.1). If there's text: `text_state = 'pending'` and a `moderation` job `{subject: review_text}` is enqueued; the text never delays the rating. Notifies the business `biz_new_review` when the rating publishes. |
| `edit_my_review(review_id, overall, ratings, text)` | Once, within `editable_until`. Stores the previous version; text re-enters moderation; `edit_count = 1`. |
| `delete_my_review(review_id)` | `status = 'deleted_by_author'`, `deleted_at`. Media → `deleted` (public copies removed by job), featured cleared. If `legal_hold`, content is hidden but retained. |
| `reply_to_review(review_id, text)` / `edit_reply` / `delete_reply` | owner/manager of the review's business. The reply is moderated with the same text pipeline (`reply_text`). |
| `request_translation(subject_type, subject_id, target_locale)` | Returns the cached translation or enqueues one (only for public content). Rate-limited. |
| Public: `get_business_reviews(business_id, filters, cursor)`, `get_business_rating_summary(business_id)` | Curated payloads per §1.1. |
| Business: `biz_get_reviews(business_id, tab, filters, cursor)` | Same content plus report status and feature controls. **No reviewer phone, no link to the CRM record.** |

### 1.4 Rating summary cache

```sql
create table public.business_rating_summary (
  business_id        uuid primary key references public.businesses(id) on delete cascade,
  review_count       int not null default 0,       -- published, active ratings
  rating_sum         int not null default 0,
  display_rating     numeric(2,1),                 -- plain mean; public only if review_count >= 5
  dimensions         jsonb not null default '{}',  -- {"cleanliness": {"count": 41, "sum": 196}, ...}
  last_review_at     timestamptz,
  updated_at         timestamptz not null default now()
);
```

It's recomputed per business by `private.recompute_rating_summary(business_id)` on review publish/remove/delete/quarantine, and nightly. `staff_stats` is recomputed the same way per staff member.

---

## 2. Media: files, customer results, business portfolio

### 2.1 `media_assets` (the file)

```sql
create table public.media_assets (
  id              uuid primary key default gen_random_uuid(),
  uploader_user_id uuid references auth.users(id) on delete set null,
  business_id     uuid references public.businesses(id),
  purpose         text not null check (purpose in ('review_media', 'business_media', 'dispute_evidence', 'verification')),
  private_bucket  text not null,                -- 'ugc-private' | 'business-media' | 'dispute-evidence' | 'verification-docs'
  private_path    text not null unique,         -- '{user_id}/{media_id}.jpg'
  public_path     text,                         -- set only after approval (ugc-public/...) or for business media
  mime            text check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  bytes           int check (bytes <= 12 * 1024 * 1024),
  width           int, height int,
  sha256          bytea,
  phash           bigint,                       -- 64-bit perceptual hash (duplicate detection)
  blurhash        text,
  status          public.media_status not null default 'uploaded',
  processed_at    timestamptz,
  …timestamps
);
create index on public.media_assets (phash) where phash is not null;
create index on public.media_assets (business_id, purpose);
```

Near-duplicate search (Hamming distance on `phash`) is done in the moderation worker against (a) the same uploader, (b) the business's portfolio, and (c) recent platform uploads in the same canonical service. It's a brute-force scan over bounded sets for now. If volume demands it later, move to a BK-tree or a pgvector bit index.

### 2.2 `review_media` (Customer Results: meaning + discovery fields)

```sql
create table public.review_media (
  id                    uuid primary key default gen_random_uuid(),
  review_id             uuid not null references public.reviews(id) on delete cascade,
  media_asset_id        uuid not null unique references public.media_assets(id),
  booking_item_id       uuid not null references public.booking_items(id),
  kind                  public.media_kind not null default 'result',
  pair_group            uuid,                              -- before/after share a group
  consent_version       text not null,                     -- consent copy version accepted
  consented_at          timestamptz not null,
  -- denormalized for Result Detail & future visual discovery (no joins through bookings)
  business_id           uuid not null references public.businesses(id),
  location_id           uuid not null,
  area_id               uuid not null references public.areas(id),
  staff_id              uuid not null,
  service_id            uuid not null,
  canonical_service_id  uuid not null references public.canonical_services(id),
  price_type            public.price_type not null,
  price_min             numeric(10,2),
  price_max             numeric(10,2),
  currency              char(3) not null default 'USD',
  visit_at              timestamptz not null,
  trust_tier            public.trust_tier not null,
  -- state
  state                 public.content_state not null default 'pending',
  minor_flag            boolean not null default false,    -- never auto-featured; manual review
  is_featured           boolean not null default false,
  featured_rank         smallint check (featured_rank between 1 and 6),
  featured_at           timestamptz,
  featured_by           uuid references auth.users(id),
  published_at          timestamptz,
  removed_at            timestamptz,
  removed_reason        text,
  …timestamps,
  check (kind = 'result' or pair_group is not null),
  check (not is_featured or (state = 'approved' and featured_rank is not null and not minor_flag)),
  check (is_featured or featured_rank is null)
);
create unique index review_media_featured_slot on public.review_media (business_id, featured_rank) where is_featured;
-- Triggers: ≤ 4 media per review; before/after only if canonical_services.allows_before_after;
--           pair has exactly one 'before' and one 'after'.
create index on public.review_media (business_id, published_at desc) where state = 'approved';
create index on public.review_media (staff_id, published_at desc) where state = 'approved';
create index on public.review_media (canonical_service_id, area_id, published_at desc) where state = 'approved';  -- visual discovery
```

**Organic feed order** (never business-controlled): `published_at desc` weighted by review quality signals, computed by the platform in `get_business_results`. **Featured row:** `is_featured` ordered by `featured_rank`, labeled "Featured by {Business}".

### 2.3 Upload flow (private-first)

```text
1. request_review_media_upload(review_id, items jsonb [{kind, pair_group?}], consent_version)
     • caller = review author; review not deleted; now() <= visit_at + 30d; total ≤ 4; kinds allowed
     • creates media_assets(status 'uploaded', private_bucket 'ugc-private',
                             private_path '{uid}/{media_id}') + review_media(state 'pending')
     • returns [{media_id, upload_path}]
2. Client uploads each file to ugc-private at exactly that path
     • storage policy: insert only if a media_assets row exists with that path, uploader = auth.uid(),
       status 'uploaded' (checked by private.can_upload_private_media(name))
     • no select/update/delete for clients on ugc-private
3. finalize_media_upload(media_id)  → status 'processing', enqueue pgmq 'moderation' {subject:'review_media', id}
     • sweeper job finalizes objects stuck in 'uploaded' > 30 min, or deletes orphans > 24h
4. Media pipeline (§2.6) → Image Processor (transform) → Classifier (safety/OCR/relevance) → decision
     • approve: derivatives already produced by the processor are published to ugc-public;
                media_assets.public_path, status 'approved'; review_media.state 'approved', published_at
     • manual_review: moderation_cases row; stays private
     • reject: status 'rejected'; review_media.state 'rejected'; notify author with a reason category
```

### 2.6 Provider-independent media processing

The database and moderation model **don't depend on where image transformation runs**. The heavy transform is behind a single worker contract, and it can run in Supabase Edge Functions or in a small external worker. Swapping one for the other changes no table, enum, RPC or state machine.

**Split of responsibilities:**

| Step | Component | Where it can run |
|---|---|---|
| Orchestration: consume the `moderation` queue, call steps in order, write results | `media-orchestrator` | Edge Function (light, I/O only) |
| **Transform:** decode (HEIC/JPEG/PNG/WebP), strip EXIF/GPS, re-encode WebP, sha256, 64-bit perceptual hash, blurhash, derivatives **320 / 800 / 2048 px** | **`ImageProcessor`** (interface) | `EdgeImageProcessor` **or** `ExternalImageProcessor` (container/serverless with libvips/sharp) |
| Classify: safety, OCR, relevance/minors (vision APIs + LLM) | `ImageClassifier` (interface) | Edge Function (HTTP calls to providers) |
| Decide + persist | `private.media_processing_complete(...)`, `private.moderation_apply_result(...)` | Postgres (RPC) |

**Worker contract (identical for every implementation):**

```text
Input  (job message):
  { job_id, media_id, source: {bucket:'ugc-private', path},
    outputs: {bucket:'ugc-staging', prefix:'{media_id}/'},
    derivatives: [{name:'thumb', max:320}, {name:'card', max:800}, {name:'full', max:2048}],
    format:'webp', quality: 80, strip_metadata: true }

Output (callback → private.media_processing_complete(job_id, result jsonb)):
  { ok: true, processor: 'edge'|'external', processor_version,
    original: {mime, width, height, bytes, sha256},
    phash: '<16 hex>', blurhash,
    derivatives: [{name, path, width, height, bytes}],
    metadata_stripped: true, duration_ms }
  or { ok:false, error_code: 'UNSUPPORTED_FORMAT'|'DECODE_FAILED'|'TOO_LARGE'|'TIMEOUT', retryable: bool }
```

- Derivatives are written to a **private `ugc-staging` bucket**. They move (copy) to `ugc-public` only on approval. Rejected or removed media never have a public copy.
- The worker authenticates to Postgres with a dedicated `media_worker` DB role (EXECUTE on the two callback functions only) or the service role behind the orchestrator. It gets storage credentials scoped to `ugc-private` (read) and `ugc-staging` (write).
- The processor is idempotent per `job_id`. Retries: 3 with backoff; then the case goes to `manual_review` with reason `processing_error`.
- Recorded on `media_assets`: `processor text`, `processor_version text` (columns added), plus a `moderation_results` row for stage `sanitize`/`hash`.
- Which implementation runs is chosen by configuration (`MEDIA_PROCESSOR=edge|external`), and it can differ per environment. The choice is made by the Phase 4 benchmark (M10, with an early feasibility spike S3).

**Removal:** `state → removed` and a job deletes the public derivatives within a minute (the private original is kept for 30 days for appeals, or indefinitely under `legal_hold`).

### 2.4 Business RPCs for results

| Function | Rule |
|---|---|
| `feature_result(review_media_id, rank)` | owner/manager; result belongs to the business, `state = 'approved'`, review published, not `minor_flag`; ranks 1–6. |
| `unfeature_result(review_media_id)` | owner/manager. |
| `report_content('review_media', id, reason, …)` | §4. |
| *(none)* | There's no function that lets a business delete, hide or reorder organic results. |

### 2.5 `business_media` (Business Portfolio)

```sql
create table public.business_media (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id),
  location_id     uuid,
  media_asset_id  uuid not null unique references public.media_assets(id),
  kind            public.business_media_kind not null,
  staff_id        uuid,                          -- kind = staff_photo
  service_id      uuid,                          -- optional tag
  caption         text check (char_length(caption) <= 200),
  sort            int not null default 0,
  state           public.content_state not null default 'approved',   -- async safety check may flip to 'removed'
  …timestamps,
  check ((kind = 'staff_photo') = (staff_id is not null)),
  foreign key (staff_id, business_id) references public.staff_members (id, business_id)
);
create unique index on public.business_media (business_id) where kind = 'cover' and state = 'approved';
alter table public.staff_members add foreign key (photo_media_id) references public.business_media(id);
```

Business uploads go to the public `business-media` bucket under `{business_id}/…` (member-writable by storage policy). They're published immediately with an async safety check (`moderation` job `business_media`) that can remove them. Businesses fully control their portfolio (add, remove, reorder).

---

## 3. Moderation

### 3.1 Tables

```sql
create table private.moderation_results (       -- one row per pipeline stage per run
  id            bigint generated always as identity primary key,
  subject_type  public.moderation_subject not null,
  subject_id    uuid not null,
  run_id        uuid not null,                  -- groups stages of one run (re-moderation creates a new run)
  stage         public.moderation_stage not null,
  outcome       text not null check (outcome in ('pass', 'flag', 'fail', 'error', 'skip')),
  scores        jsonb not null default '{}',    -- {"nudity":0.01,"relevance":0.93,...}
  labels        text[] not null default '{}',
  model         text,
  model_version text,
  latency_ms    int,
  created_at    timestamptz not null default now()
);
create index on private.moderation_results (subject_type, subject_id, created_at desc);

create table public.moderation_cases (          -- the human queue (admin-only via RLS)
  id                   uuid primary key default gen_random_uuid(),
  subject_type         public.moderation_subject not null,
  subject_id           uuid not null,
  business_id          uuid references public.businesses(id),
  author_user_id       uuid references auth.users(id),
  source               text not null check (source in ('pipeline', 'report', 'appeal', 'fraud')),
  report_id            uuid,
  reasons              text[] not null default '{}',   -- 'safety','relevance','pii','abuse','spam','minor','duplicate','low_confidence'
  auto_decision        public.moderation_decision,
  auto_confidence      real,
  priority             int not null default 50,        -- severity × age; reports +20; minors/CSAM-suspect 100
  state                public.case_state not null default 'open',
  claimed_by           uuid references auth.users(id),
  claimed_at           timestamptz,
  decided_by           uuid references auth.users(id),
  decision             public.moderation_decision,
  decision_reason_code text,
  redaction            jsonb,                          -- spans to redact for approve_redacted
  user_action          text check (user_action in ('none', 'warn', 'suspend')),
  note                 text,
  sla_due_at           timestamptz not null,
  created_at           timestamptz not null default now(),
  decided_at           timestamptz
);
create unique index moderation_one_open_case on public.moderation_cases (subject_type, subject_id)
  where state in ('open', 'claimed', 'escalated');
create index on public.moderation_cases (state, priority desc, created_at) where state <> 'decided';
```

### 3.2 Pipelines (orchestrated from the pgmq `moderation` queue; the image transform runs in the `ImageProcessor` from §2.6)

**Image (`review_media`):**

| Stage | Check | Result |
|---|---|---|
| validation | magic bytes, size, dimensions (≥ 300px), count | fail → reject |
| sanitize | decode + re-encode webp, strip all metadata incl. GPS | error → retry ×3 then manual |
| hash | sha256 exact dup; phash near-dup vs uploader / business portfolio / same-service recent | portfolio or other-user dup → reject ("not your result"); own dup → skip |
| safety | nudity/sexual, violence/gore, hate symbols (vision safety API) | above hard threshold → reject + fraud/abuse flag; grey zone → manual |
| ocr | text overlay, phone numbers, URLs, QR codes, ID/document detection | document/ID → manual; contact info/QR → reject |
| relevance | vision LLM with booking context: canonical service name + `relevance_hints`; also `minors_present`, `face_count` | < 0.40 reject · 0.40–0.75 manual · ≥ 0.75 pass; minor → `minor_flag` + manual |
| decision | combine | approve / manual_review / reject |

**Text (`review_text`, `reply_text`):**

| Stage | Check |
|---|---|
| text_rules | length, URL, phone regex (after `normalize_digits`: `+961`, `03/70/71/76/78/79/81` patterns, 7–8 digit runs), emails, repeated characters, spam blocklist |
| text_normalize | language detection (ar / en / fr / arabizi / mixed); Arabizi → Arabic approximation; diacritics/tatweel stripped → `review_text_private.text_normalized` |
| text_llm | Structured output: `{categories[], target: service\|business\|staff_named\|other_person\|group\|none, severity 0–3, contains_pii, pii_spans[], is_spam, is_threat, is_hate, sentiment, confidence}`, with booking context (service, business name, staff names) |
| decision | Matrix below |

**Text decision matrix:**

| Condition | Decision |
|---|---|
| threat or hate or sexual harassment | `reject` + author flag |
| PII only (phone, address, private full name) | `approve_redacted` (spans → `[removed]`, stored in `text_display`) |
| profanity targeted at a person (`target in staff_named, other_person`) with severity ≥ 2 | `manual_review` (usual outcome: text rejected, ratings kept, author asked to rewrite) |
| profanity about the service/experience (`target in service, business`) | `approve` |
| spam / advertising / competitor promotion | `reject` |
| confidence < 0.70 on any harmful class | `manual_review` |
| otherwise | `approve` |

The moderation thresholds and matrix live in `private.moderation_config` (jsonb, versioned). They're cheap to tune.

### 3.3 Admin decision RPC

`admin_decide_case(case_id, decision, reason_code, note, redaction jsonb default null, user_action default 'none')`:
- Requires `is_admin('{moderator,support}')`. The case must be claimed by the caller, or be open.
- Applies the decision to the subject:
  - `approve` → state `approved` (+ publish media derivatives)
  - `approve_redacted` → `text_display`
  - `reject` → `rejected`
  - `remove_media` / `remove_text` → `removed` for that part only
  - `remove_review` → review `removed`, ratings `removed`, media `removed`
  - `escalate` → state `escalated`, superadmin queue
- `user_action`: `warn` → `profiles.status = 'warned'` (only if currently active); `suspend` → requires `support`/`superadmin`.
- Writes `audit.admin_actions` (before/after), notifies the author (and the business if the case came from its report), recomputes the rating summary and staff stats.
- Other helpers: `admin_claim_case(case_id)`, `admin_release_case(case_id)`. Claims auto-expire after 15 min.

---

## 4. Reports

```sql
create table public.reports (
  id                   uuid primary key default gen_random_uuid(),
  reporter_user_id     uuid not null references auth.users(id),
  reporter_kind        text not null check (reporter_kind in ('business', 'customer')),
  reporter_business_id uuid references public.businesses(id),     -- when reporting as a business
  subject_type         public.report_subject not null,
  subject_id           uuid not null,
  subject_business_id  uuid references public.businesses(id),     -- business the subject belongs to
  reason               public.report_reason not null,
  parts                text[] not null default '{}',              -- {'text'} | {'media:<uuid>'} | {'whole'}
  details              text check (char_length(details) <= 1000),
  status               public.report_status not null default 'open',
  moderation_case_id   uuid references public.moderation_cases(id),
  dispute_id           uuid,
  resolution_note      text,                                      -- shown to the reporter
  resolved_by          uuid references auth.users(id),
  resolved_at          timestamptz,
  created_at           timestamptz not null default now(),
  check ((reporter_kind = 'business') = (reporter_business_id is not null))
);
create unique index reports_one_open_per_reporter on public.reports (reporter_user_id, subject_type, subject_id)
  where status in ('open', 'in_review');
create index on public.reports (status, created_at);
create index on public.reports (reporter_business_id, status);
```

`report_content(subject_type, subject_id, reason, parts, details, as_business_id default null)`:
- As a business: owner/manager of `as_business_id`, and the subject belongs to that business. Cap of 10 open reports per business, with rate limits. A high rejected-report ratio creates a `report_abuse` fraud signal.
- As a customer: any active customer (e.g. `my_photo`, `harassment`, reporting a business).
- Creates or attaches a `moderation_cases` row (`source 'report'`, priority +20).
- **`never_attended`** on a review → creates a `disputes(type 'review_attendance')` instead.
- Auto-hide while pending happens only if an immediate re-run of the text/image pipeline confirms PII, threat or explicit content. Otherwise the content stays live until a human decides.

---

## 5. Disputes

```sql
create table public.disputes (
  id                 uuid primary key default gen_random_uuid(),
  type               public.dispute_type not null,
  booking_id         uuid references public.bookings(id),
  review_id          uuid references public.reviews(id),
  business_id        uuid not null references public.businesses(id),
  customer_user_id   uuid references auth.users(id),
  opened_by_user_id  uuid not null references auth.users(id),
  opened_by_kind     public.actor_kind not null,
  status             public.dispute_status not null default 'open',
  outcome            public.dispute_outcome,
  legal_hold         boolean not null default false,
  due_at             timestamptz not null,          -- SLA: 48h; parties' response window 7d
  assigned_to        uuid references auth.users(id),
  resolved_by        uuid references auth.users(id),
  resolved_at        timestamptz,
  resolution_note    text,                          -- shared with parties
  created_at         timestamptz not null default now(),
  check (type <> 'no_show' or booking_id is not null),
  check (type <> 'review_attendance' or review_id is not null),
  check ((status = 'resolved') = (outcome is not null))
);
create unique index disputes_one_open_no_show on public.disputes (booking_id)
  where type = 'no_show' and status in ('open', 'awaiting_info');
create index on public.disputes (status, due_at);

create table public.dispute_messages (
  id             uuid primary key default gen_random_uuid(),
  dispute_id     uuid not null references public.disputes(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  author_kind    public.actor_kind not null,
  visibility     text not null default 'parties' check (visibility in ('parties', 'internal')),
  body           text not null check (char_length(body) <= 2000),
  media_ids      uuid[] not null default '{}',     -- dispute-evidence bucket
  created_at     timestamptz not null default now()
);
```

`admin_resolve_dispute(dispute_id, outcome, resolution_note)` (support/superadmin; legal → superadmin):

| Outcome | Effects (same transaction) |
|---|---|
| `no_show_overturned` | booking `no_show → completed` (actor admin); reliability `dispute_overturned` (−1.0); review eligibility until `now() + 30d`; business dispute-loss counter (quality-score reliability input) |
| `no_show_upheld` | if the customer reviewed this booking during the dispute → review `removed` (reason `dispute_upheld`), author notified |
| `voided` | no reliability change either way; review stays |
| `review_kept` / `review_text_removed` / `review_media_removed` / `review_removed` | applied as moderation decisions on the review |
| `legal_kept` / `legal_removed` | content kept or removed; `legal_hold = true` on related content (retention) |

**Default rules when parties don't respond** (7 days, applied by the nightly job, audited as `system`):
- No-show dispute where the customer tapped **Confirm** on the reminder (`customer_confirmed_at`) and the business gives no evidence → overturned.
- Otherwise → voided.

---

## 6. Fraud

```sql
create table private.fraud_signals (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('review', 'user', 'business')),
  subject_id    uuid not null,
  signal        public.fraud_signal_type not null,
  score         real not null check (score between 0 and 1),
  evidence      jsonb not null default '{}',
  status        text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  reviewed_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
create index on private.fraud_signals (subject_type, subject_id);
create index on private.fraud_signals (status, score desc);
```

| Detector | Runs | Signal |
|---|---|---|
| Review from an account < 7 days old with a first-ever booking at that business | on submit | `new_account_review` (0.3) |
| Several reviewers for one business sharing a `device_hash` | on submit + nightly | `device_cluster` (0.6–0.9) |
| IP-hash clusters within 72h | nightly | `ip_cluster` |
| Weekly review volume > 3× the business's trailing average | nightly | `review_burst` |
| Author phone/device matches a business member or staff user | on submit (also blocks eligibility) | `member_self_review` (1.0) |
| Near-duplicate text (trigram similarity > 0.8) across reviewers | nightly | `duplicate_text` |
| Verified Visit share over the cap | nightly | `visit_tier_cap` (informational; the cap is applied in ranking) |
| High no-show-mark rate with a high overturn rate | nightly | `no_show_pattern` (business) |
| High rejected-report ratio | nightly | `report_abuse` (business) |

**Automatic effect:** an open signal with `score ≥ investigation_threshold` (default 0.5, in `private.moderation_config`) on a review, or on its author for that business, does the following:
- sets `rating_state = 'quarantined'` and `fraud_multiplier = 0` (reversible)
- hides the review publicly
- recomputes the summaries and ranking inputs
- opens a `moderation_cases(source 'fraud')`

Signals below the threshold are logged for pattern analysis only. Dismissing the investigation restores both fields; confirming it removes the review. Nothing is deleted automatically.
