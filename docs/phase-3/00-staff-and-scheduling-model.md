# Phase 3 · Input — Staff, Scheduling & Assignment Model

Status: **Superseded in detail by `phase-3/01..07`** (kept as the design rationale). `is_public` was renamed `publicly_bookable` on 2026-09-27.

Original status: **Binding requirements for the Phase 3 schema.** Full DDL for all tables comes in Phase 3. This document fixes the staff/scheduling/booking-item core now, because concurrency and availability depend on it. DDL here is a sketch: names and constraints are intended to survive, while column lists will be completed in Phase 3.

---

## 1. Principles

1. **StaffMember is a first-class entity.** It is never a text field on a booking.
2. **Every booking item has a concrete `staff_id` (NOT NULL)**, including "Any available" bookings, holds and manual bookings.
3. **The database is the final arbiter of "is this person free?"** A single GiST exclusion constraint covers holds and bookings together.
4. **How staff were chosen is recorded** (`selection_mode`, `requested_staff_id`, `assignment_rule_used`). This drives notification rules, analytics ("% specifically requested") and rebooking.
5. **Multi-tenant integrity through composite foreign keys** (`(id, business_id)`), so a row can never reference a staff member, service or location belonging to another business, even if application code is wrong.

## 2. Refinements to Phase 1

| Phase 1 said | Now |
|---|---|
| Services and staff hang off `BusinessLocation` | **Staff and services belong to `Business`.** Staff are linked to locations through `staff_locations` (many-to-many; MVP has exactly one row each). Schedules are per (staff, location). This supports multi-branch staff later with no migration. |
| Separate `SlotHold` table | **Holds are `bookings` rows with status `held`** and an `expires_at`. That way one exclusion constraint covers holds and real bookings, so no race window exists between two tables. Holds are never shown in customer or business UIs, and they're hard-deleted on expiry or replaced on confirm. |
| "No preference" assigned at commit | **Assigned at hold creation**, re-validated at confirm. |

## 3. Entities and relationships

```
Business 1─* StaffMember ─*─* BusinessLocation      (staff_locations)
StaffMember *─* Service                              (staff_services: duration/price overrides, specialty flag)
StaffMember 1─* StaffWeeklyHours                     (per location, effective-dated, multiple intervals/day → breaks)
StaffMember 1─* StaffScheduleOverride                (per date: off, or custom intervals)
StaffMember 1─* StaffTimeOff                         (tstzrange, kind, private reason)
BusinessLocation 1─* LocationClosure                 (holidays: affect all staff)
StaffMember 1─* BookingItem                          (staff_id NOT NULL; exclusion constraint)
StaffMember 1─* Review (via booking item) · 1─* ReviewMedia (Customer Results)
StaffMember 1─* CustomerFavoriteStaff
StaffMember 1─1 StaffStats                           (cached: rating, counts, next available)
StaffMember 0..1─1 auth.users                        (optional login; staff without login are normal)
```

## 4. Enums

```sql
create type staff_status          as enum ('active', 'archived');
create type staff_choice_mode     as enum ('any_or_choose', 'any_only', 'choose_only');
create type assignment_rule       as enum ('least_booked', 'priority', 'round_robin', 'minimize_gaps');
create type staff_selection_mode  as enum ('any', 'specific', 'rebook', 'business');
  -- any:      customer chose "Any available", system assigned
  -- specific: customer chose this person
  -- rebook:   customer used "Book again with {staff}" / favorite shortcut
  -- business: created or assigned by business (manual booking, walk-in)
create type time_off_kind         as enum ('vacation', 'sick', 'personal', 'training', 'other');
create type booking_status        as enum ('held', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show');
```

## 5. Tables (sketch)

```sql
create extension if not exists btree_gist;

-- Composite-key targets on parents (in Phase 3 DDL):
--   businesses(id), business_locations unique (id, business_id), services unique (id, business_id)

create table staff_members (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references businesses(id),
  user_id                 uuid references auth.users(id),          -- optional login
  display_name            text not null check (length(display_name) between 1 and 60),
  slug                    text not null,                           -- /{business}/staff/{slug}
  role_title              text,                                    -- "Senior Hair Stylist"
  bio                     text check (length(bio) <= 500),
  photo_path              text,
  gender                  text check (gender in ('female', 'male')),  -- optional, customer filter
  publicly_bookable       boolean not null default true,           -- true: visible & choosable online; false: internal-only, never in public APIs
  accepts_any_assignment  boolean not null default true,           -- eligible for "Any available"
  assignment_priority     int not null default 100,                -- lower = earlier (Priority rule)
  display_order           int not null default 100,
  last_auto_assigned_at   timestamptz,                             -- Round-robin cursor
  status                  staff_status not null default 'active',
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, slug),
  unique (business_id, user_id),
  check ((status = 'archived') = (archived_at is not null))
);

create table staff_locations (
  staff_id     uuid not null,
  location_id  uuid not null,
  business_id  uuid not null,
  primary key (staff_id, location_id),
  foreign key (staff_id, business_id)    references staff_members (id, business_id),
  foreign key (location_id, business_id) references business_locations (id, business_id)
);

create table staff_services (
  staff_id               uuid not null,
  service_id             uuid not null,
  business_id            uuid not null,
  duration_min_override  int  check (duration_min_override between 5 and 720),
  price_type_override    price_type,                  -- fixed | from | range | on_consultation
  price_min_override     numeric(10,2) check (price_min_override >= 0),
  price_max_override     numeric(10,2),
  is_specialty           boolean not null default false,  -- max 3 per staff (constraint trigger)
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id)   references staff_members (id, business_id),
  foreign key (service_id, business_id) references services (id, business_id),
  check (price_max_override is null or price_max_override >= price_min_override)
);

-- Weekly recurring hours. Multiple intervals per weekday; the gap between them is the break.
-- No rows for a weekday = day off. Effective-dated so schedule changes don't rewrite the past.
create table staff_weekly_hours (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null,
  location_id     uuid not null,
  business_id     uuid not null,
  iso_weekday     smallint not null check (iso_weekday between 1 and 7),   -- 1 = Monday
  start_minute    smallint not null check (start_minute between 0 and 1439),
  end_minute      smallint not null check (end_minute between 1 and 1440),
  effective_from  date not null default current_date,
  effective_to    date,                                                     -- exclusive
  check (end_minute > start_minute),
  check (effective_to is null or effective_to > effective_from),
  foreign key (staff_id, location_id) references staff_locations (staff_id, location_id),
  exclude using gist (
    staff_id with =, iso_weekday with =,
    int4range(start_minute, end_minute) with &&,
    daterange(effective_from, effective_to) with &&
  )
);

-- Date-specific replacement of weekly hours: either "off" (one row, no interval)
-- or one or more custom intervals.
create table staff_schedule_overrides (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null,
  location_id   uuid not null,
  business_id   uuid not null,
  on_date       date not null,
  is_working    boolean not null,
  start_minute  smallint,
  end_minute    smallint,
  note          text,
  foreign key (staff_id, location_id) references staff_locations (staff_id, location_id),
  check ((is_working and start_minute is not null and end_minute > start_minute)
      or (not is_working and start_minute is null and end_minute is null)),
  exclude using gist (
    staff_id with =, on_date with =,
    int4range(coalesce(start_minute, 0), coalesce(end_minute, 1440)) with &&
  )
);

create table staff_time_off (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null,
  business_id  uuid not null,
  period       tstzrange not null check (not isempty(period)),
  kind         time_off_kind not null default 'personal',
  reason       text,                         -- private: owner/manager + the staff member only
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  foreign key (staff_id, business_id) references staff_members (id, business_id)
);

create table location_closures (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null,
  business_id  uuid not null,
  period       daterange not null,
  label        text,                          -- "Christmas", "Eid al-Fitr"
  foreign key (location_id, business_id) references business_locations (id, business_id)
);

-- Booking header: customer, status, source. Items: who does what, when.
create table booking_items (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references bookings(id) on delete cascade,
  business_id           uuid not null,
  location_id           uuid not null,
  service_id            uuid not null,
  staff_id              uuid not null,                          -- ALWAYS concrete
  selection_mode        staff_selection_mode not null,
  requested_staff_id    uuid,                                   -- who the customer asked for (history; survives reassignment)
  assignment_rule_used  assignment_rule,                        -- set when selection_mode = 'any'
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  occupied              tstzrange not null,                     -- [starts_at - buffer_before, ends_at + buffer_after), set by RPC
  blocks_time           boolean not null default true,          -- false when cancelled / no_show; maintained by transition fn
  allow_overlap         boolean not null default false,         -- SOON: manager override, audited
  duration_min          int not null,                           -- snapshot (staff override applied)
  price_type            price_type not null,                    -- snapshot
  price_min             numeric(10,2),
  price_max             numeric(10,2),
  foreign key (staff_id, location_id)   references staff_locations (staff_id, location_id),
  foreign key (service_id, business_id) references services (id, business_id),
  check (ends_at > starts_at),
  check (lower(occupied) <= starts_at and upper(occupied) >= ends_at),
  check ((selection_mode in ('specific', 'rebook')) = (requested_staff_id is not null)),
  check ((selection_mode = 'any') = (assignment_rule_used is not null)),
  -- THE concurrency guarantee: one person cannot be in two places at once
  -- (covers held, pending, confirmed, completed; cancelled/no_show release time).
  exclude using gist (staff_id with =, occupied with &&)
    where (blocks_time and not allow_overlap)
);

create table customer_favorite_staff (
  user_id      uuid not null references auth.users(id) on delete cascade,
  staff_id     uuid not null references staff_members(id),
  business_id  uuid not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, staff_id)
);
-- customer_favorite_businesses(user_id, business_id, created_at) — same shape.

create table staff_stats (                          -- cache, rebuilt by jobs/triggers
  staff_id                       uuid primary key references staff_members(id),
  verified_review_count          int not null default 0,
  rating_display                 numeric(2,1),     -- plain mean of verified reviews; shown only if count >= 5
  completed_verified_appointments int not null default 0,
  specifically_requested_pct     numeric(5,2),
  favorites_count                int not null default 0,
  next_available_at              timestamptz,
  updated_at                     timestamptz not null default now()
);
```

**Business settings (additions):** `staff_choice_mode staff_choice_mode default 'any_or_choose'`, `assignment_rule assignment_rule default 'least_booked'`, `show_staff_price_differences bool default true`, `show_staff_appointment_counts bool default true`, `notify_on_any_reassign bool default false`.

**Reviews & results linkage:** `reviews.booking_id` (unique) + `reviews.staff_id` (denormalized from the item). `review_media.booking_item_id NOT NULL` with denormalized `staff_id`, `service_id`, `canonical_service_id`, `price_snapshot`, `area_id`, `business_id`. That's everything Result Detail and the future visual discovery need, without joins through bookings.

## 6. Indexes (staff-related)

- `booking_items (staff_id, starts_at)` — calendar per staff + availability busy lookup (the GiST exclusion index also serves `occupied &&` queries).
- `booking_items (business_id, starts_at)` — business calendar (all staff).
- `bookings (customer_user_id, business_id, created_at desc)` — "Book again with {staff}" lookup.
- `staff_weekly_hours (staff_id, location_id, iso_weekday)`, `staff_schedule_overrides (staff_id, on_date)`, `staff_time_off using gist (staff_id, period)`.
- `staff_services (service_id)` — "who performs this service".
- `customer_favorite_staff (staff_id)` — favorites count.

## 7. Server functions (the only write paths)

| Function | Behavior |
|---|---|
| `get_available_slots(location, service, staff_id null, from, to)` | `staff_id` null = **Any**: candidates = active, public, `accepts_any_assignment`, performs service, assigned to location. Per candidate: working intervals for date (override if present, else effective weekly hours) − location closures − time off − busy `occupied` ranges (excluding expired holds and the caller's own hold) − min notice; candidate start times on the slot grid where `[t − buffer_before, t + duration(s) + buffer_after)` fits. Returns `slot_start`, and for public callers **no staff IDs** in Any mode, plus `price_min/max` across the free candidates. Specific: same for one staff member. |
| `get_staff_options(location, service)` | Staff cards for C8: public fields, specialties, stats (applying ≥5 / ≥20 display rules and business toggles), next available, overridden price/duration, plus the caller's rebook shortcut and favorite flags. |
| `create_hold(location, service, start, staff_id null, mode, session)` | Deletes the caller's previous hold. Any mode: gathers candidates free at `start`, orders them by rule → tries to insert a `held` booking + item for each in order until one insert succeeds (exclusion-constraint violations are caught → next candidate). Returns assigned staff, price and duration. Sets `last_auto_assigned_at` for round robin. Expired holds overlapping the target range are deleted first, in the same transaction. |
| `change_hold_staff(hold_id, staff_id)` | Moves the hold to another free staff member at the same time (C10 "Change"); mode becomes `specific`. |
| `confirm_booking(hold_id, details, idempotency_key)` | Re-validates everything, flips `held` → `pending`/`confirmed`, writes a booking event, enqueues notifications. |
| `create_manual_booking(...)` | Business path. `selection_mode = 'business'` (or `any` with rule if reception chose "Any available"). Same constraint. |
| `reassign_booking_item(item, new_staff, notify)` | Manager/reception. **Forces `notify = true` when `selection_mode in ('specific','rebook')`.** Keeps `requested_staff_id`. Writes a `staff_changed` event. |
| `archive_staff(staff)` | Refused while future non-cancelled items exist (the UI offers reassign/cancel first). Sets `publicly_bookable = false`, `status = archived`. |

**Assignment rule ordering (Any mode, among staff free at `t`):**
- `least_booked` — fewest booked minutes that local day → then `assignment_priority` → then random.
- `priority` — `assignment_priority` ascending → then least booked.
- `round_robin` — `last_auto_assigned_at` ascending, nulls first.
- `minimize_gaps` ("first available") — smallest gap between that staff member's previous busy end (or shift start) and `t` → then least booked. This keeps days tight.

## 8. RLS strategy (staff objects)

| Object | Customer / anon | Business member | Admin |
|---|---|---|---|
| `staff_members` | No direct access; read via `staff_public` view (active + public + business live; safe columns only) | Read all own-business staff; Owner/Manager write; Staff role may update own `bio`/`photo_path` [SOON] | Full, audited |
| `staff_services`, hours, overrides | None (availability only through the SECURITY DEFINER function) | Read own business; Owner/Manager write | Full |
| `staff_time_off` | None | Owner/Manager: full. Reception: via `staff_time_off_calendar` view (period + kind, **no reason**). Staff: own rows | Full |
| `booking_items` | Own bookings via `my_bookings` view | Own business; Staff role only `staff_id = my staff id` | Full |
| `customer_favorite_staff` | Own rows only | Never row-level (aggregate count via `staff_stats` only) | Read |
| `staff_stats` | Via `staff_public` | Own business | Full |

## 9. Required tests (pgTAP + property-based)

1. No booking item can exist with a null `staff_id`, and an Any-mode confirm always yields a concrete staff member.
2. Two concurrent `create_hold` calls in Any mode for the same time with **2 free staff → both succeed with different staff**; with **1 free → exactly one succeeds**.
3. No overlapping `occupied` ranges for a staff member across held/pending/confirmed/completed (random schedule fuzzing).
4. Any mode never assigns staff who are archived, `publicly_bookable = false`, `accepts_any_assignment = false`, not assigned to the service, not linked to the location, on time off, or outside hours/breaks.
5. Specific mode shows only that staff member's slots, and staff duration/price overrides are applied in slots, holds and snapshots.
6. A date override fully replaces weekly hours for that date; effective-dated weekly hours switch on the right date; location closures block everyone.
7. DST transition days in `Asia/Beirut` produce correct slots.
8. Reassigning a `specific`/`rebook` item without notification is refused; `requested_staff_id` is preserved.
9. Cross-tenant composite-FK attacks fail (a staff member of business A on a service of business B).
10. RLS: Reception can't read time-off reasons; Staff role can't read other staff members' bookings; customers can't read raw schedules.
