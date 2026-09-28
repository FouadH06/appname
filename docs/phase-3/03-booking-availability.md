# Phase 3 · Part 3 — Bookings, Availability, Assignment, State Transitions

This is the correctness-critical core. Rules:
1. **Clients never write `bookings` / `booking_items` directly.** INSERT/UPDATE/DELETE are revoked from `anon` and `authenticated`, and every change goes through the functions in this file.
2. **The exclusion constraint on `booking_items` is the final arbiter.** Application checks are there for good error messages; the constraint is there for correctness.
3. **Every status change goes through `private.apply_transition`**, which validates the transition against a table and writes a `booking_events` row.

Requires `pgcrypto` (hold tokens): `create extension if not exists pgcrypto with schema extensions;`

> **Amendments from the M3 implementation (2026-09-29, decision log).** The design below stands; these are the places where the code is more precise:
> 1. **Status changes:** `private.apply_transition` is split into `private.assert_transition(from, to, actor)` (actor-specific rules, called by every RPC) plus a **`bookings` BEFORE UPDATE trigger** (`private.booking_status_guard`). The trigger rejects any status change not in the table for *any* caller, and it owns every status-derived column (confirmed/completed/cancelled/no-show timestamps, expiry, hold fields). Each RPC then changes status and its other fields in **one UPDATE**, which the row CHECKs require.
> 2. **Pending expiry bounded by start:** CHECK `status <> 'pending' or expires_at <= starts_at`. Confirm sets `least(now() + request_expiry, starts_at)`; reschedule re-bounds it; accept rejects after expiry or start; the per-minute job cancels at expiry.
> 3. **Concurrency hardening:** concurrent conflicting inserts under an exclusion constraint can deadlock (each waits for the other's uncommitted row). Every write that claims staff time takes a per-staff advisory lock (`private.lock_staff`) **inside the same sub-transaction** as the write; a failed attempt releases it, so waiting transactions never hold another staff lock. `deadlock_detected` is caught as a backstop. The exclusion constraint remains the final arbiter.
> 4. **Idempotent confirm under parallel retries:** if the hold was just consumed by a concurrent retry with the same key, `confirm_booking` returns that booking instead of `HOLD_NOT_FOUND`.
> 5. **Notifications:** RPCs record `notify` in `booking_events.data`. M7 derives the outbox from `booking_events`, in the same transaction, so M3 RPCs don't change when messaging lands.
> 6. **Deferred to the milestone that needs them:** customer read models (`get_my_bookings`, `get_my_booking`) → M8; `contest_no_show` → M8/M9 (needs `disputes`); waitlist tables → Soon; claim RPCs → M4.
> 7. **Assignment tie-break:** deterministic (`staff_id`) instead of `random()`, so tests and support investigations are reproducible.
> 8. New error codes: `OUTSIDE_HOURS`, `REASON_REQUIRED`, `NOT_SUPPORTED` (multi-item not yet), `INVALID_PHONE`, `NOT_FOUND`, `IMMUTABLE_FIELD`.
> 9. **Availability performance:** the per-staff free-time CTE in `compute_slots` is `MATERIALIZED` (otherwise Postgres inlines it per grid row), and `booking_items` has a second GiST index `(staff_id, occupied) where blocks_time` for busy-time lookups. The exclusion constraint's partial index (`blocks_time and not allow_overlap`) can't serve queries that filter `blocks_time` only.

---

## 1. Tables

### 1.1 `bookings` (header)

```sql
create table public.bookings (
  id                     uuid primary key default gen_random_uuid(),
  ref                    text not null unique default private.gen_booking_ref(),   -- 8-char Crockford base32
  business_id            uuid not null references public.businesses(id),
  location_id            uuid not null,
  business_customer_id   uuid,                        -- null only while held, or anonymous walk-in
  customer_user_id       uuid references auth.users(id) on delete set null,       -- platform customer (online booker or claimed)
  status                 public.booking_status not null,
  source                 public.booking_source not null,                          -- immutable (trigger)
  is_request             boolean not null default false,
  expires_at             timestamptz,                 -- held: hold expiry · pending: request expiry
  hold_owner_user_id     uuid,                        -- auth.uid() that created the hold (may be anonymous)
  hold_token_hash        bytea,                       -- sha256(token); null once confirmed
  starts_at              timestamptz not null,        -- envelope of items (maintained by functions)
  ends_at                timestamptz not null,
  customer_note          text check (char_length(customer_note) <= 200),
  internal_note          text check (char_length(internal_note) <= 500),
  policy_snapshot        jsonb not null default '{}', -- {cancellation_window_minutes, booking_mode, min_notice_minutes}
  currency               char(3) not null default 'USD',
  total_price_min        numeric(10,2),
  total_price_max        numeric(10,2),
  payment_status         public.payment_status not null default 'not_required',
  created_by_kind        public.actor_kind not null,
  created_by_user_id     uuid references auth.users(id),
  confirmed_at           timestamptz,
  completed_at           timestamptz,
  completed_by_kind      public.actor_kind,
  cancelled_at           timestamptz,
  cancelled_by_kind      public.actor_kind,
  cancel_reason          text check (char_length(cancel_reason) <= 300),
  is_late_cancel         boolean not null default false,
  no_show_at             timestamptz,
  no_show_disputed       boolean not null default false,
  review_eligible_until  timestamptz,
  customer_confirmed_at  timestamptz,                 -- tapped "Confirm" on WhatsApp reminder
  rescheduled_count      int not null default 0,
  idempotency_key        text check (char_length(idempotency_key) <= 64),
  attribution            jsonb not null default '{}', -- {utm_source, utm_campaign, referrer_host, search_id}
  …timestamps,
  unique (id, business_id),
  unique (id, business_id, location_id),
  foreign key (location_id, business_id)          references public.business_locations (id, business_id),
  foreign key (business_customer_id, business_id) references public.business_customers (id, business_id),
  check (ends_at > starts_at),
  check ((status = 'held') = (hold_token_hash is not null)),
  check (status not in ('held', 'pending') or expires_at is not null),
  check (status = 'held' or business_customer_id is not null or source = 'walk_in'),
  check ((status = 'cancelled') = (cancelled_at is not null and cancelled_by_kind is not null)),
  check (status <> 'completed' or completed_at is not null),
  check (status <> 'no_show' or no_show_at is not null),
  check (source not in ('manual', 'walk_in') or created_by_kind in ('business', 'admin'))
);
create unique index bookings_idempotency_uq on public.bookings (customer_user_id, idempotency_key)
  where idempotency_key is not null;
create index on public.bookings (business_id, starts_at);
create index on public.bookings (location_id, starts_at);
create index on public.bookings (customer_user_id, starts_at desc) where customer_user_id is not null;
create index on public.bookings (business_customer_id, starts_at desc);
create index on public.bookings (expires_at) where status in ('held', 'pending');
create index on public.bookings (ends_at) where status = 'confirmed';
create index on public.bookings (hold_owner_user_id) where status = 'held';

alter table public.business_customers
  add foreign key (first_booking_id) references public.bookings(id);
```

### 1.2 `booking_items` (who, what, when)

```sql
create table public.booking_items (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null,
  business_id           uuid not null,
  location_id           uuid not null,
  position              smallint not null default 1,
  service_id            uuid not null,
  canonical_service_id  uuid not null references public.canonical_services(id),   -- snapshot for trust/discovery
  staff_id              uuid not null,                                            -- ALWAYS concrete
  selection_mode        public.staff_selection_mode not null,
  requested_staff_id    uuid,                        -- what the customer asked for; survives reassignment
  assignment_rule_used  public.assignment_rule,      -- set iff selection_mode = 'any'
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  buffer_before_min     int not null default 0,
  buffer_after_min      int not null default 0,
  occupied              tstzrange not null,          -- [starts_at - buffer_before, ends_at + buffer_after)
  blocks_time           boolean not null default true,   -- synced from booking status by trigger
  allow_overlap         boolean not null default false,  -- [SOON] manager override (audited)
  duration_min          int not null check (duration_min between 5 and 720),
  price_type            public.price_type not null,
  price_min             numeric(10,2),
  price_max             numeric(10,2),
  price_overridden      boolean not null default false,
  …timestamps,
  unique (booking_id, position),
  foreign key (booking_id, business_id, location_id) references public.bookings (id, business_id, location_id) on delete cascade,
  foreign key (staff_id, location_id)   references public.staff_locations (staff_id, location_id),
  foreign key (service_id, business_id) references public.services (id, business_id),
  check (ends_at > starts_at),
  check (occupied = tstzrange(starts_at - make_interval(mins => buffer_before_min),
                              ends_at   + make_interval(mins => buffer_after_min), '[)')),
  check ((selection_mode in ('specific', 'rebook')) = (requested_staff_id is not null)),
  check ((selection_mode = 'any') = (assignment_rule_used is not null)),

  -- ══ THE CONCURRENCY GUARANTEE ══
  -- One staff member can never have two time-blocking items overlapping, whether they're
  -- holds, pending requests, confirmed or completed bookings, online or manual.
  constraint booking_items_no_staff_overlap
    exclude using gist (staff_id with =, occupied with &&)
    where (blocks_time and not allow_overlap)
);
create index on public.booking_items (staff_id, starts_at);
create index on public.booking_items (business_id, starts_at);
create index on public.booking_items (booking_id);
```

> The `occupied = tstzrange(...)` check is a plain CHECK. `timestamptz ± interval` is only STABLE, so a generated column isn't allowed. The functions compute `occupied`; the check guarantees consistency.

**Status sync trigger:** `AFTER UPDATE OF status ON bookings` sets `booking_items.blocks_time = new.status in ('held','pending','confirmed','completed')`. Cancelled and no-show release the time, so reception can give a no-show's slot to a walk-in.

### 1.3 `booking_events` (append-only audit of every change)

```sql
create table public.booking_events (
  id              bigint generated always as identity primary key,
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  business_id     uuid not null,
  event           public.booking_event_type not null,
  actor_kind      public.actor_kind not null,
  actor_user_id   uuid,
  from_status     public.booking_status,
  to_status       public.booking_status,
  data            jsonb not null default '{}',    -- e.g. {old_start, new_start, old_staff_id, new_staff_id, reason}
  created_at      timestamptz not null default now()
);
create index on public.booking_events (booking_id, created_at);
create index on public.booking_events (business_id, created_at desc);
-- Trigger: raise exception on UPDATE or DELETE (except cascade from account-deletion job, which anonymizes instead).
```

Holds don't generate events (noise). The first event of a booking is `confirmed` or `requested`.

### 1.4 Transition table

```sql
create table private.booking_transitions (
  from_status  public.booking_status not null,
  to_status    public.booking_status not null,
  actor        public.actor_kind not null,
  primary key (from_status, to_status, actor)
);
insert into private.booking_transitions values
  ('held',      'pending',   'customer'),
  ('held',      'confirmed', 'customer'),
  ('pending',   'confirmed', 'business'),
  ('pending',   'cancelled', 'customer'), ('pending', 'cancelled', 'business'),
  ('pending',   'cancelled', 'system'),   ('pending', 'cancelled', 'admin'),
  ('confirmed', 'cancelled', 'customer'), ('confirmed', 'cancelled', 'business'),
  ('confirmed', 'cancelled', 'system'),   ('confirmed', 'cancelled', 'admin'),
  ('confirmed', 'completed', 'business'), ('confirmed', 'completed', 'system'),
  ('confirmed', 'no_show',   'business'),
  ('completed', 'no_show',   'business'),              -- only within 24h of start (checked in fn)
  ('no_show',   'completed', 'admin'),                 -- dispute overturned
  ('no_show',   'completed', 'business');              -- business corrects its own mistake within 24h
```

### 1.5 Waitlist ([SOON] UI; schema now)

```sql
create table public.waitlist_entries (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,
  location_id         uuid not null,
  service_id          uuid not null,
  staff_id            uuid,                          -- null = any staff
  user_id             uuid not null references auth.users(id) on delete cascade,
  date_from           date not null,
  date_to             date not null check (date_to >= date_from and date_to - date_from <= 14),
  window_start_minute smallint not null default 0,
  window_end_minute   smallint not null default 1440 check (window_end_minute > window_start_minute),
  status              public.waitlist_status not null default 'active',
  …timestamps,
  foreign key (location_id, business_id) references public.business_locations (id, business_id),
  foreign key (service_id, business_id)  references public.services (id, business_id)
);
create index on public.waitlist_entries (location_id, service_id, date_from) where status = 'active';
create unique index on public.waitlist_entries (user_id, location_id, service_id, date_from) where status = 'active';

create table public.waitlist_offers (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.waitlist_entries(id) on delete cascade,
  slot_start    timestamptz not null,
  staff_id      uuid not null,
  batch_no      smallint not null,
  status        public.offer_status not null default 'sent',
  sent_at       timestamptz not null default now(),
  expires_at    timestamptz not null
);
```

### 1.6 Access tokens, rate limits, error codes

```sql
create table private.access_tokens (
  id                    uuid primary key default gen_random_uuid(),
  token_hash            bytea not null unique,             -- sha256(raw token)
  purpose               text not null check (purpose in ('manage_booking', 'review', 'claim_visit')),
  booking_id            uuid references public.bookings(id) on delete cascade,
  business_customer_id  uuid,
  phone_e164            text,
  expires_at            timestamptz not null,
  used_at               timestamptz,
  created_at            timestamptz not null default now()
);

create table private.rate_limits (
  bucket        text not null,         -- 'create_hold', 'otp', 'submit_review', 'upload'
  subject       text not null,         -- user id / ip hash / phone
  window_start  timestamptz not null,
  hits          int not null default 1,
  primary key (bucket, subject, window_start)
);
-- private.hit_rate_limit(bucket, subject, max_hits, window interval) raises 'RATE_LIMITED'.
```

**Error contract:** functions raise `errcode = 'P0001'` with `message` = a stable code, and `detail` = JSON for UI hints. `packages/i18n` maps codes to copy.

| Code | Meaning |
|---|---|
| `AUTH_REQUIRED`, `PHONE_NOT_VERIFIED`, `ACCOUNT_RESTRICTED` | identity |
| `NOT_BOOKABLE` | business/location/service/staff not publicly bookable |
| `INVALID_SLOT` | off-grid, outside min notice / max advance, outside schedule |
| `SLOT_TAKEN` | no eligible staff free (detail: nearest alternatives) |
| `STAFF_NOT_FREE` | specific staff busy |
| `HOLD_NOT_FOUND`, `HOLD_EXPIRED` | hold lifecycle |
| `CUSTOMER_BLOCKED`, `TOO_MANY_ACTIVE_BOOKINGS`, `OVERLAP_SAME_BUSINESS` | customer limits |
| `TRANSITION_NOT_ALLOWED`, `OUTSIDE_WINDOW` | state machine |
| `FORBIDDEN` | role check failed (never reveals existence) |
| `RATE_LIMITED` | abuse protection |

---

## 2. Availability engine

One engine serves the public booking flow, the business dashboard, search "next available", and waitlist matching.

### 2.1 Building blocks (private, STABLE)

```sql
-- Effective terms for (staff, service): overrides win
create function private.staff_service_terms(p_staff_id uuid, p_service_id uuid)
returns table (duration_min int, buffer_before_min int, buffer_after_min int,
               price_type public.price_type, price_min numeric, price_max numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(ss.duration_min_override, s.duration_min),
         s.buffer_before_min, s.buffer_after_min,
         coalesce(ss.price_type_override, s.price_type),
         case when ss.price_type_override is not null then ss.price_min_override else s.price_min end,
         case when ss.price_type_override is not null then ss.price_max_override else s.price_max end
  from public.staff_services ss
  join public.services s on s.id = ss.service_id and s.business_id = ss.business_id
  where ss.staff_id = p_staff_id and ss.service_id = p_service_id $$;

-- Working time: (override intervals, else effective weekly hours) ∩ location hours − location closures
create function private.staff_working_time(p_staff_id uuid, p_location_id uuid, p_from date, p_to date)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  with loc as (select timezone as tz from public.business_locations where id = p_location_id),
  days as (select d::date as d from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d),
  ovr as (select * from public.staff_schedule_overrides o
          where o.staff_id = p_staff_id and o.location_id = p_location_id and o.on_date between p_from and p_to),
  intervals as (
    select o.on_date as d, o.start_minute as s, o.end_minute as e from ovr o where o.is_working
    union all
    select days.d, w.start_minute, w.end_minute
    from days
    join public.staff_weekly_hours w
      on w.staff_id = p_staff_id and w.location_id = p_location_id
     and w.iso_weekday = extract(isodow from days.d)
     and days.d >= w.effective_from and (w.effective_to is null or days.d < w.effective_to)
    where not exists (select 1 from ovr where ovr.on_date = days.d)
  ),
  open_hours as (
    select days.d, h.start_minute as s, h.end_minute as e
    from days join public.location_hours h
      on h.location_id = p_location_id and h.iso_weekday = extract(isodow from days.d)
  )
  select
    coalesce((select range_agg(tstzrange((i.d + make_interval(mins => i.s)) at time zone loc.tz,
                                         (i.d + make_interval(mins => i.e)) at time zone loc.tz, '[)'))
              from intervals i, loc), '{}'::tstzmultirange)
  * coalesce((select range_agg(tstzrange((h.d + make_interval(mins => h.s)) at time zone loc.tz,
                                         (h.d + make_interval(mins => h.e)) at time zone loc.tz, '[)'))
              from open_hours h, loc), '{}'::tstzmultirange)
  - coalesce((select range_agg(tstzrange(lower(c.period)::timestamp at time zone loc.tz,
                                         upper(c.period)::timestamp at time zone loc.tz, '[)'))
              from public.location_closures c, loc
              where c.location_id = p_location_id and c.period && daterange(p_from, p_to, '[]')),
             '{}'::tstzmultirange)
$$;

-- Busy time: blocking items (ignoring expired holds and optionally one booking, e.g. during reschedule)
create function private.staff_busy_time(p_staff_id uuid, p_window tstzrange, p_ignore_booking_id uuid default null)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(bi.occupied), '{}'::tstzmultirange)
  from public.booking_items bi
  join public.bookings b on b.id = bi.booking_id
  where bi.staff_id = p_staff_id and bi.blocks_time and bi.occupied && p_window
    and not (b.status = 'held' and b.expires_at <= now())
    and (p_ignore_booking_id is null or b.id <> p_ignore_booking_id) $$;

-- Free time = working − time off − busy
create function private.staff_free_time(p_staff_id uuid, p_location_id uuid, p_from date, p_to date,
                                        p_ignore_booking_id uuid default null)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  with loc as (select timezone as tz from public.business_locations where id = p_location_id),
  win as (select tstzrange(p_from::timestamp at time zone loc.tz,
                           (p_to + 1)::timestamp at time zone loc.tz, '[)') as w from loc)
  select private.staff_working_time(p_staff_id, p_location_id, p_from, p_to)
       - coalesce((select range_agg(t.period) from public.staff_time_off t, win
                   where t.staff_id = p_staff_id and t.period && win.w), '{}'::tstzmultirange)
       - private.staff_busy_time(p_staff_id, (select w from win), p_ignore_booking_id)
$$;
```

### 2.2 Candidate staff

```sql
-- p_audience: 'public_any' | 'public_specific' | 'internal_any' | 'internal_specific'
create function private.candidate_staff(p_location_id uuid, p_service_id uuid, p_staff_id uuid, p_audience text)
returns table (staff_id uuid, assignment_priority int, last_auto_assigned_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.assignment_priority, s.last_auto_assigned_at
  from public.staff_members s
  join public.staff_locations sl on sl.staff_id = s.id and sl.location_id = p_location_id
  join public.staff_services  ss on ss.staff_id = s.id and ss.service_id = p_service_id
  where s.status = 'active'
    and case p_audience
          when 'public_any'        then s.publicly_bookable and s.accepts_any_assignment
          when 'public_specific'   then s.publicly_bookable and s.id = p_staff_id
          when 'internal_any'      then s.accepts_any_assignment
          when 'internal_specific' then s.id = p_staff_id
        end $$;
```

**`publicly_bookable` is enforced here, once, for every public path.** The internal audiences are only reachable from functions that first verify business membership.

### 2.3 Slot computation (single engine)

```sql
create function private.compute_slots(p_location_id uuid, p_service_id uuid, p_staff_id uuid,
                                      p_from date, p_to date, p_audience text, p_apply_min_notice boolean)
returns table (slot_start timestamptz, staff_id uuid, price_type public.price_type,
               price_min numeric, price_max numeric, duration_min int)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text; v_step int; v_notice int; v_earliest timestamptz;
begin
  select l.timezone, st.slot_interval_minutes, st.min_notice_minutes
    into v_tz, v_step, v_notice
  from public.business_locations l join public.business_settings st on st.business_id = l.business_id
  where l.id = p_location_id;

  v_earliest := case when p_apply_min_notice then now() + make_interval(mins => v_notice) else now() end;

  return query
  with c as (
    select cs.staff_id, t.*,
           private.staff_free_time(cs.staff_id, p_location_id, p_from, p_to) as free
    from private.candidate_staff(p_location_id, p_service_id, p_staff_id, p_audience) cs
    cross join lateral private.staff_service_terms(cs.staff_id, p_service_id) t
  ),
  grid as (
    select c.*, (d + make_interval(mins => m)) at time zone v_tz as t
    from c
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
    cross join generate_series(0, 1439, v_step) m
  )
  select g.t, g.staff_id, g.price_type, g.price_min, g.price_max, g.duration_min
  from grid g
  where g.t >= v_earliest
    and not isempty(g.free)
    and tstzrange(g.t - make_interval(mins => g.buffer_before_min),
                  g.t + make_interval(mins => g.duration_min + g.buffer_after_min), '[)') <@ g.free;
end $$;
```

The slot grid is anchored to local midnight in `slot_interval_minutes` steps (P16). Complexity is roughly staff × days × (1440 / step). For 10 staff, 14 days and 15-min steps that's about 13k containment checks, which runs in milliseconds.

### 2.4 Public wrapper (customer web/app)

```sql
create function public.get_available_slots(p_location_id uuid, p_service_id uuid, p_staff_id uuid default null,
                                           p_date_from date default null, p_date_to date default null)
returns table (slot_start timestamptz, price_type public.price_type, price_min numeric, price_max numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_biz uuid; v_tz text; v_set public.business_settings; v_today date; v_from date; v_to date;
begin
  if not private.is_publicly_visible_location(p_location_id) then return; end if;
  select l.business_id, l.timezone into v_biz, v_tz from public.business_locations l where l.id = p_location_id;
  select * into v_set from public.business_settings where business_id = v_biz;
  if not v_set.allow_online_booking then return; end if;
  if not exists (select 1 from public.services s where s.id = p_service_id and s.business_id = v_biz
                 and s.status = 'active' and s.is_online_bookable) then return; end if;
  if (p_staff_id is null and v_set.staff_choice_mode = 'choose_only')
  or (p_staff_id is not null and v_set.staff_choice_mode = 'any_only') then return; end if;

  v_today := (now() at time zone v_tz)::date;
  v_from  := greatest(coalesce(p_date_from, v_today), v_today);
  v_to    := least(coalesce(p_date_to, v_from + 13), v_from + 30, v_today + v_set.max_advance_days);
  if v_to < v_from then return; end if;

  return query
  select cs.slot_start, min(cs.price_type), min(cs.price_min), max(coalesce(cs.price_max, cs.price_min))
  from private.compute_slots(p_location_id, p_service_id, p_staff_id, v_from, v_to,
                             case when p_staff_id is null then 'public_any' else 'public_specific' end, true) cs
  group by cs.slot_start
  order by cs.slot_start;
end $$;
```

- Returns **no staff identifiers** in Any mode. In specific mode, the staff member is already known to the caller.
- Companion public functions built on the same engine:
  - `public.get_next_available(location, service, staff default null)`: the earliest slot within the horizon (used by C1 chips and staff cards).
  - `public.get_available_days(location, service, staff, from, to)`: days with ≥1 slot (for the date strip).

### 2.5 Business wrapper

`public.biz_get_available_slots(p_location_id, p_service_id, p_staff_id, p_date)`:
- Requires `private.has_business_role(business, '{owner,manager,reception}')`, or the staff role with `p_staff_id = my_staff_id`.
- Uses the `internal_*` audiences (includes internal-only staff), `p_apply_min_notice = false`.
- Returns `slot_start, staff_id[]`, so the appointment-creation drawer can show "Next free 4:30, 5:15".

---

## 3. Staff assignment ("Any available")

```sql
create function private.rank_free_staff(p_location_id uuid, p_service_id uuid, p_start timestamptz,
                                        p_audience text, p_rule public.assignment_rule)
returns table (staff_id uuid, rnk int)
language sql stable security definer set search_path = '' as $$
  with loc as (select timezone as tz from public.business_locations where id = p_location_id),
  day as (select (p_start at time zone loc.tz)::date as d, loc.tz from loc),
  c as (
    select cs.staff_id, cs.assignment_priority, cs.last_auto_assigned_at, t.duration_min,
           t.buffer_before_min, t.buffer_after_min
    from private.candidate_staff(p_location_id, p_service_id, null, p_audience) cs
    cross join lateral private.staff_service_terms(cs.staff_id, p_service_id) t
  ),
  free_c as (
    select c.*,
      tstzrange(p_start - make_interval(mins => c.buffer_before_min),
                p_start + make_interval(mins => c.duration_min + c.buffer_after_min), '[)') as need
    from c, day
    where tstzrange(p_start - make_interval(mins => c.buffer_before_min),
                    p_start + make_interval(mins => c.duration_min + c.buffer_after_min), '[)')
          <@ private.staff_free_time(c.staff_id, p_location_id, day.d, day.d)
  ),
  metrics as (
    select f.*,
      -- booked minutes that local day
      coalesce((select sum(extract(epoch from (upper(bi.occupied) - lower(bi.occupied))) / 60)
                from public.booking_items bi, day
                where bi.staff_id = f.staff_id and bi.blocks_time
                  and bi.occupied && tstzrange(day.d::timestamp at time zone day.tz,
                                               (day.d + 1)::timestamp at time zone day.tz)), 0) as booked_min,
      -- gap since the previous busy end (or day start) → minimize_gaps
      coalesce(extract(epoch from (lower(f.need) - (
                select max(upper(bi.occupied)) from public.booking_items bi
                where bi.staff_id = f.staff_id and bi.blocks_time
                  and upper(bi.occupied) <= lower(f.need)
                  and upper(bi.occupied) > lower(f.need) - interval '12 hours'))) / 60, 1e6) as gap_min
    from free_c f
  )
  select m.staff_id,
         row_number() over (order by
           case p_rule when 'least_booked'  then m.booked_min end asc nulls last,
           case p_rule when 'priority'      then m.assignment_priority end asc nulls last,
           case p_rule when 'round_robin'   then extract(epoch from coalesce(m.last_auto_assigned_at, 'epoch')) end asc nulls last,
           case p_rule when 'minimize_gaps' then m.gap_min end asc nulls last,
           m.booked_min asc, m.assignment_priority asc, random())::int
  from metrics m $$;
```

The ranking is advisory. The actual winner is whoever's insert passes the exclusion constraint first (§4.1). That makes concurrent "Any" holds safe: two customers picking the same time with two free staff both succeed, each getting a different person.

---

## 4. Booking functions (RPC surface)

All are `SECURITY DEFINER`, `set search_path = ''`, `revoke execute from public`, and granted to `authenticated` unless noted.

### 4.1 `public.create_hold` (customer / visitor, including anonymous auth)

```sql
create function public.create_hold(
  p_location_id uuid, p_service_id uuid, p_start timestamptz,
  p_staff_id uuid default null,
  p_selection_mode public.staff_selection_mode default null,   -- 'specific' | 'rebook' when p_staff_id given
  p_source public.booking_source default 'business_link',
  p_attribution jsonb default '{}')
returns table (booking_id uuid, hold_token text, expires_at timestamptz, staff_id uuid,
               staff_first_name text, starts_at timestamptz, ends_at timestamptz,
               price_type public.price_type, price_min numeric, price_max numeric, selection_mode public.staff_selection_mode)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_biz uuid; v_tz text; v_set public.business_settings;
  v_mode public.staff_selection_mode; v_audience text; v_day date;
  v_cand record; v_terms record; v_occ tstzrange; v_bid uuid; v_token text; v_chosen uuid;
  v_svc public.services;
begin
  if v_uid is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  perform private.hit_rate_limit('create_hold', v_uid::text, 20, interval '10 minutes');
  if p_source in ('manual', 'walk_in') then raise exception using errcode = 'P0001', message = 'FORBIDDEN'; end if;
  if not private.is_publicly_visible_location(p_location_id) then
    raise exception using errcode = 'P0001', message = 'NOT_BOOKABLE'; end if;

  select l.business_id, l.timezone into v_biz, v_tz from public.business_locations l where l.id = p_location_id;
  select * into v_set from public.business_settings where business_id = v_biz;
  select * into v_svc from public.services where id = p_service_id and business_id = v_biz
    and status = 'active' and is_online_bookable;
  if not found or not v_set.allow_online_booking then
    raise exception using errcode = 'P0001', message = 'NOT_BOOKABLE'; end if;

  -- mode
  if p_staff_id is null then
    if v_set.staff_choice_mode = 'choose_only' then raise exception using errcode='P0001', message='NOT_BOOKABLE'; end if;
    v_mode := 'any'; v_audience := 'public_any';
  else
    if v_set.staff_choice_mode = 'any_only' then raise exception using errcode='P0001', message='NOT_BOOKABLE'; end if;
    v_mode := coalesce(p_selection_mode, 'specific');
    if v_mode not in ('specific', 'rebook') then raise exception using errcode='P0001', message='INVALID_SLOT'; end if;
    v_audience := 'public_specific';
  end if;

  -- slot validity: on grid, notice, horizon
  v_day := (p_start at time zone v_tz)::date;
  if (extract(hour from p_start at time zone v_tz) * 60 + extract(minute from p_start at time zone v_tz))::int
       % v_set.slot_interval_minutes <> 0
     or extract(second from p_start) <> 0
     or p_start < now() + make_interval(mins => v_set.min_notice_minutes)
     or v_day > (now() at time zone v_tz)::date + v_set.max_advance_days then
    raise exception using errcode = 'P0001', message = 'INVALID_SLOT';
  end if;

  -- one active hold per user
  delete from public.bookings b where b.hold_owner_user_id = v_uid and b.status = 'held';

  for v_cand in
    select r.staff_id from private.rank_free_staff(p_location_id, p_service_id, p_start, v_audience, v_set.assignment_rule) r
    where v_mode = 'any'
    union all
    select cs.staff_id from private.candidate_staff(p_location_id, p_service_id, p_staff_id, v_audience) cs
    where v_mode <> 'any'
    -- (union order preserved by ordering on rnk in the any-branch; implementation uses an ordered array)
  loop
    select * into v_terms from private.staff_service_terms(v_cand.staff_id, p_service_id);
    v_occ := tstzrange(p_start - make_interval(mins => v_terms.buffer_before_min),
                       p_start + make_interval(mins => v_terms.duration_min + v_terms.buffer_after_min), '[)');

    -- clear expired holds that would collide
    delete from public.bookings b using public.booking_items bi
     where bi.booking_id = b.id and b.status = 'held' and b.expires_at <= now()
       and bi.staff_id = v_cand.staff_id and bi.occupied && v_occ;

    -- schedule check (working hours, breaks, time off, closures, busy)
    continue when not (v_occ <@ private.staff_free_time(v_cand.staff_id, p_location_id, v_day, v_day));

    begin  -- subtransaction: both inserts roll back together on conflict
      v_token := encode(extensions.gen_random_bytes(24), 'base64');
      insert into public.bookings (business_id, location_id, status, source, expires_at, hold_owner_user_id,
                                   hold_token_hash, starts_at, ends_at, created_by_kind, created_by_user_id,
                                   currency, total_price_min, total_price_max, attribution)
      values (v_biz, p_location_id, 'held', p_source, now() + interval '5 minutes', v_uid,
              extensions.digest(v_token, 'sha256'), p_start,
              p_start + make_interval(mins => v_terms.duration_min), 'customer', v_uid,
              v_svc.currency, v_terms.price_min, coalesce(v_terms.price_max, v_terms.price_min),
              coalesce(p_attribution, '{}'))
      returning id into v_bid;

      insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id,
                                        staff_id, selection_mode, requested_staff_id, assignment_rule_used,
                                        starts_at, ends_at, buffer_before_min, buffer_after_min, occupied,
                                        duration_min, price_type, price_min, price_max)
      values (v_bid, v_biz, p_location_id, p_service_id, v_svc.canonical_service_id,
              v_cand.staff_id, v_mode,
              case when v_mode in ('specific', 'rebook') then v_cand.staff_id end,
              case when v_mode = 'any' then v_set.assignment_rule end,
              p_start, p_start + make_interval(mins => v_terms.duration_min),
              v_terms.buffer_before_min, v_terms.buffer_after_min, v_occ,
              v_terms.duration_min, v_terms.price_type, v_terms.price_min, v_terms.price_max);

      v_chosen := v_cand.staff_id;
      exit;
    exception when exclusion_violation then
      v_bid := null;   -- someone got there first; try next candidate
    end;
  end loop;

  if v_chosen is null then
    raise exception using errcode = 'P0001',
      message = case when v_mode = 'any' then 'SLOT_TAKEN' else 'STAFF_NOT_FREE' end;
  end if;

  if v_mode = 'any' then
    update public.staff_members set last_auto_assigned_at = now() where id = v_chosen;
  end if;

  return query
  select v_bid, v_token, b.expires_at, v_chosen, split_part(s.display_name, ' ', 1), b.starts_at, b.ends_at,
         v_terms.price_type, v_terms.price_min, v_terms.price_max, v_mode
  from public.bookings b join public.staff_members s on s.id = v_chosen where b.id = v_bid;
end $$;
```

In a real implementation, the candidate loop iterates over an ordered `uuid[]` built first (by `rnk` for Any, or the single staff member for specific), to guarantee the order. The sketch above shows the logic.

### 4.2 Other customer RPCs

| Function | Behavior |
|---|---|
| `extend_hold(booking_id, hold_token)` | Called when OTP is requested. Sets `expires_at = greatest(expires_at, now() + 10 min)` if still held and not expired. |
| `change_hold_staff(booking_id, hold_token, staff_id)` | C10 "Change". Target must pass `public_specific`. Updates the item's `staff_id`, terms, `occupied`, `selection_mode = 'specific'`, `requested_staff_id`, clears `assignment_rule_used`, and updates booking prices. The exclusion constraint decides → `STAFF_NOT_FREE`. |
| `release_hold(booking_id, hold_token)` | Deletes the hold. |
| `confirm_booking(booking_id, hold_token, first_name, last_name, customer_note, idempotency_key)` | See §4.3. |
| `cancel_my_booking(booking_id, reason)` | Customer cancel (§4.5). |
| `reschedule_my_booking(booking_id, new_start, staff_id default null (keep), selection_mode default null)` | Atomic in-place move (§4.6). |
| `contest_no_show(booking_id, statement, evidence_media_ids uuid[])` | Within 7 days of `no_show_at`, once. Creates a `disputes` row (Part 4), sets `no_show_disputed`, event `no_show_contested`. |
| `claim_booking(token)` | Explicit claim of one manual booking + its business-customer relationship after OTP (Part 2 §2.3 Flow A). Returns other claimable-visit offers. |
| `get_claimable_visits()` / `claim_visits(business_ids[])` / `dismiss_claimable_visits(business_ids[])` | Flow B: per-business offers (name, count, latest month only); linked only after explicit confirmation, max 12 months back. |
| `resolve_access_token(token)` | For WhatsApp magic links. Returns a limited booking summary. It never claims anything; claiming needs `claim_booking` with a matching OTP-verified phone. |
| `get_my_bookings(scope, cursor)`, `get_my_booking(booking_id)` | Customer read models. Staff first name included for the customer's own bookings, even if the staff member is internal-only; no profile, photo or rating. |

### 4.3 `confirm_booking` logic

1. `private.is_active_customer()` must be true (not anonymous, phone verified, not suspended); otherwise `PHONE_NOT_VERIFIED` / `ACCOUNT_RESTRICTED`.
2. **Idempotency:** if a booking exists with `(customer_user_id = uid, idempotency_key)` → return it.
3. `select … for update` on the booking where `id = p_booking_id and status = 'held' and hold_token_hash = digest(p_hold_token)`. Missing → `HOLD_NOT_FOUND` (it may have expired and been reclaimed). The token, not `hold_owner_user_id`, proves ownership, so a hold created as an anonymous user can be confirmed after signing into an existing account.
4. If `expires_at <= now()` but the row still exists, the time is still exclusively ours (the constraint guarantees it). Continue.
5. Re-validate: business/location visible, online booking on, service active, staff still `publicly_bookable` and active, `starts_at > now()`.
6. Customer checks:
   - reliability tier `blocked` → `CUSTOMER_BLOCKED`
   - `business_customers.is_blocked_online` → `CUSTOMER_BLOCKED`
   - active future bookings at this business ≥ `max_active_bookings_per_customer` → `TOO_MANY_ACTIVE_BOOKINGS`
   - overlap with the customer's own blocking bookings at the same business → `OVERLAP_SAME_BUSINESS`
7. Resolve `business_customers`:
   - existing `(business_id, user_id)` row, else
   - insert a new record. **An unclaimed shadow with the same phone is never merged here** (Part 2 §2.3). If one exists, `acquired_via` is inherited from it and the business is added to the caller's claimable offers plus `private.possible_duplicates`. Otherwise `acquired_via = case source when 'business_link' then 'business_link' else 'marketplace' end`.
8. `v_request := booking_mode = 'request' or tier = 'restricted'`.
9. `private.apply_transition(booking, case when v_request then 'pending' else 'confirmed' end, 'customer', …)`, and set:
   - `customer_user_id`, `business_customer_id`, `customer_note`
   - `policy_snapshot`, `idempotency_key`
   - `hold_token_hash = null`, `hold_owner_user_id = null`
   - `expires_at = case when v_request then least(now() + request_expiry, starts_at) end`
   - `is_request = v_request`
10. Set `business_customers.first_booking_id` if null. Fill in empty profile names.
11. Enqueue notifications (Part 5):
    - customer `booking_confirmed` / `booking_requested`
    - business `biz_new_booking` / `biz_new_request`
    - if confirmed: scheduled `booking_reminder_24h` and `booking_reminder_2h` (skipped if already past)
    - create a `manage_booking` access token for the WhatsApp link
12. Return the booking read model.

### 4.4 Business RPCs

| Function | Roles | Behavior |
|---|---|---|
| `create_manual_booking(location, customer jsonb, service, staff default null, start, duration_override, price_override jsonb, internal_note, notify bool default true, allow_outside_hours bool default false, as_walk_in bool default false, mark_completed bool default false)` | owner/manager/reception; staff (own column only) | Resolves or creates `business_customers` from `{business_customer_id}` or `{phone, name}` (null allowed only for walk-ins). Staff: explicit (any active staff at location who performs the service, **including internal-only**) or Any via `rank_free_staff(..., 'internal_any', rule)`. The schedule check is skipped if `allow_outside_hours` (owner/manager/reception only; audited in event data). The exclusion constraint always applies. `source = 'walk_in'` or `'manual'`; `selection_mode = 'business'` (or `'any'`); `created_by_kind = 'business'`. Status `confirmed`, or `completed` if `mark_completed` and the start is in the past (same local day only). Notifies the customer if a phone exists and `notify`, including a `claim_visit` token link. If the record is already a claimed relationship (`user_id` set), `customer_user_id` is set on the new booking automatically; otherwise it stays null until an explicit claim. |
| `accept_request(booking)` / `decline_request(booking, reason)` | owner/manager/reception | pending → confirmed / cancelled(business). Accept fails with `OUTSIDE_WINDOW` if expired or past start. |
| `biz_cancel_booking(booking, reason, notify bool default true)` | owner/manager/reception; staff own | → cancelled(business). Always notifies for customer-initiated bookings. Business-initiated cancellations of marketplace bookings feed the reliability component of the quality score. |
| `biz_reschedule_booking(booking, new_start, new_staff default null, notify, allow_outside_hours)` | same | §4.6 |
| `reassign_booking_item(item, new_staff, notify)` | owner/manager/reception | **`notify` is forced true when `selection_mode in ('specific','rebook')`**; `requested_staff_id` is kept; event `staff_changed`. For `any` bookings it notifies only if `notify` or `notify_customer_on_any_reassign`. |
| `mark_completed(booking)` / `mark_completed_bulk(booking_ids[])` | owner/manager/reception; staff own | confirmed → completed, allowed from `starts_at`. Sets `completed_at`, `review_eligible_until = now() + 30 days`, reliability event `completed`, schedules `review_request` at `ends_at + 2h`, recomputes CRM stats. |
| `mark_no_show(booking)` | same | confirmed/completed → no_show, only while `now()` is between `starts_at` and `starts_at + 24h`. Reliability event `no_show`; notifies customer with a contest link; releases time. |
| `undo_no_show(booking)` | same | no_show → completed within 24h if not disputed (business correcting itself); reverses the reliability event. |
| `update_booking_note(booking, internal_note)` | members | event `note_changed` |

### 4.5 Cancellation rules

- **Customer:** allowed from pending/confirmed while `now() < starts_at`. If `now() > starts_at - cancellation_window` (from `policy_snapshot`), then `is_late_cancel = true` and reliability event `late_cancel`.
- **Business:** allowed from pending/confirmed at any time before completion. A reason is required for customer-initiated bookings.
- **System:** request expiry, account deletion, business suspension (with notifications).
- Every cancellation:
  - releases time (trigger)
  - cancels scheduled reminders (`notifications` by `booking_id`, status queued → cancelled)
  - enqueues waitlist matching for the freed range ([SOON])

### 4.6 Reschedule (atomic, no hold needed)

```text
lock booking row (for update); validate actor & state (pending/confirmed; customer: before cancellation window closes)
new staff := coalesce(p_new_staff, current staff)   -- customer: must pass public_specific or public_any rules
compute new occupied with that staff member's terms
customer path: require slot validity (grid, notice, horizon) AND occupied <@ staff_free_time(..., p_ignore_booking_id => booking)
business path: schedule check unless allow_outside_hours
UPDATE booking_items SET starts_at, ends_at, occupied, staff_id, (selection_mode/requested_staff_id if customer changed staff)
   → exclusion constraint decides atomically; the old slot is released in the same statement
UPDATE bookings SET starts_at, ends_at, rescheduled_count += 1
event 'rescheduled' {old_start,new_start,old_staff,new_staff}; re-schedule reminders; notify the other party
```

### 4.7 `private.apply_transition`

```sql
create function private.apply_transition(p_booking_id uuid, p_to public.booking_status, p_actor public.actor_kind,
                                         p_actor_user uuid, p_event public.booking_event_type, p_data jsonb default '{}')
returns public.bookings language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'FORBIDDEN'; end if;
  if not exists (select 1 from private.booking_transitions t
                 where t.from_status = b.status and t.to_status = p_to and t.actor = p_actor) then
    raise exception using errcode = 'P0001', message = 'TRANSITION_NOT_ALLOWED',
      detail = jsonb_build_object('from', b.status, 'to', p_to)::text;
  end if;
  update public.bookings set
    status            = p_to,
    confirmed_at      = case when p_to = 'confirmed' then now() else confirmed_at end,
    completed_at      = case when p_to = 'completed' then coalesce(completed_at, now()) else completed_at end,
    completed_by_kind = case when p_to = 'completed' then p_actor else completed_by_kind end,
    cancelled_at      = case when p_to = 'cancelled' then now() else cancelled_at end,
    cancelled_by_kind = case when p_to = 'cancelled' then p_actor else cancelled_by_kind end,
    no_show_at        = case when p_to = 'no_show' then now() else no_show_at end,
    expires_at        = case when p_to in ('confirmed', 'completed', 'cancelled', 'no_show') then null else expires_at end
  where id = p_booking_id returning * into b;
  insert into public.booking_events (booking_id, business_id, event, actor_kind, actor_user_id, from_status, to_status, data)
  values (b.id, b.business_id, p_event, p_actor, p_actor_user, (p_data->>'from')::public.booking_status, p_to, p_data);
  return b;
end $$;
```

(`from_status` is captured before the update in the real implementation. The sketch shortens that.)

**Side effects by transition** (in the calling RPC, same transaction):

| To | Reliability event | CRM stats | Notifications | Other |
|---|---|---|---|---|
| confirmed | — | recompute | customer + business; schedule reminders | — |
| pending | — | — | customer "requested"; business request alert | — |
| completed | `completed` (−0.15) | recompute | schedule review request | `review_eligible_until` |
| cancelled (customer, late) | `late_cancel` (0.4) | recompute | business | waitlist |
| cancelled (business) | — | recompute | customer (mandatory for customer-initiated bookings) | quality-score reliability input |
| no_show | `no_show` (1.0) | recompute | customer with contest link | release time |
| no_show → completed (admin) | `dispute_overturned` (−1.0) | recompute | customer + business | review eligibility restored |

---

## 5. Customer-business stats (CRM cache)

`private.recompute_business_customer_stats(p_business_customer_id)` recomputes, rather than incrementing, from `bookings`:
- `visit_count` (completed), `no_show_count`, `cancel_count`, `late_cancel_count`
- `lifetime_spend` = Σ item `price_min` of completed bookings. It's labeled "estimated" when price types aren't fixed.
- `first_visit_at` / `last_visit_at`
- `preferred_staff_id` (mode of staff over completed items; ties broken by most recent)
- `favorite_service_id`

It's called from every transition that touches that customer. It's O(customer's bookings), which is cheap.

---

## 6. Scheduled jobs (pg_cron, UTC)

| Schedule | Job | Behavior |
|---|---|---|
| every minute | `private.job_expire_holds()` | Delete `held` where `expires_at < now() - interval '2 minutes'`. |
| every minute | `private.job_expire_requests()` | pending with `expires_at <= now()` → cancelled(system), event `expired`, notify both parties. |
| every 5 min | `private.job_auto_complete()` | confirmed with `ends_at + auto_complete_after_minutes <= now()` → completed(system). |
| every minute | `private.job_dispatch_notifications()` | Part 5. |
| every 15 min | `private.job_refresh_next_available()` | `staff_stats.next_available_at` and `search_documents.next_available_at` for live locations (public audiences only). |
| nightly 01:00 UTC (03:00/04:00 Beirut) | `private.job_nightly()` | Reliability decay recompute, staff stats, quality scores and labels (Part 5), price levels, daily analytics rollups, token cleanup, rate-limit cleanup. |

All jobs are idempotent and process in batches (`limit 500`, `for update skip locked`).
