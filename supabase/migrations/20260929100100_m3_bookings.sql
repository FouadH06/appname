-- M3 · Bookings, items (THE concurrency constraint), events, transitions, access tokens
-- Spec: Phase 3 Part 3 §1, §4.7; review requirement: pending expiry bounded by start

-- ─── Booking reference (8-char Crockford base32) ───────────────────────────
create function private.gen_booking_ref() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  b bytea := extensions.gen_random_bytes(8);
  out text := '';
begin
  for i in 0 .. 7 loop
    out := out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return out;
end $$;

-- ─── bookings (header) ─────────────────────────────────────────────────────
create table public.bookings (
  id                     uuid primary key default gen_random_uuid(),
  ref                    text not null unique default private.gen_booking_ref(),
  business_id            uuid not null references public.businesses(id),
  location_id            uuid not null,
  business_customer_id   uuid,
  customer_user_id       uuid references auth.users(id) on delete set null,
  status                 public.booking_status not null,
  source                 public.booking_source not null,
  is_request             boolean not null default false,
  expires_at             timestamptz,
  hold_owner_user_id     uuid,
  hold_token_hash        bytea,
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  customer_note          text check (char_length(customer_note) <= 200),
  internal_note          text check (char_length(internal_note) <= 500),
  policy_snapshot        jsonb not null default '{}',
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
  customer_confirmed_at  timestamptz,
  rescheduled_count      int not null default 0,
  idempotency_key        text check (char_length(idempotency_key) <= 64),
  attribution            jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, business_id),
  unique (id, business_id, location_id),
  foreign key (location_id, business_id)          references public.business_locations (id, business_id),
  foreign key (business_customer_id, business_id) references public.business_customers (id, business_id),
  check (ends_at > starts_at),
  check ((status = 'held') = (hold_token_hash is not null)),
  check (status not in ('held', 'pending') or expires_at is not null),
  -- Review requirement (M2): a pending request can never outlive the appointment start
  check (status <> 'pending' or expires_at <= starts_at),
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
create trigger bookings_updated_at before update on public.bookings
  for each row execute function private.set_updated_at();

alter table public.business_customers
  add foreign key (first_booking_id) references public.bookings(id);

-- ─── booking_items (who, what, when) ───────────────────────────────────────
create table public.booking_items (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null,
  business_id           uuid not null,
  location_id           uuid not null,
  position              smallint not null default 1 check (position >= 1),
  service_id            uuid not null,
  canonical_service_id  uuid not null references public.canonical_services(id),
  staff_id              uuid not null,
  selection_mode        public.staff_selection_mode not null,
  requested_staff_id    uuid,
  assignment_rule_used  public.assignment_rule,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  buffer_before_min     int not null default 0 check (buffer_before_min between 0 and 120),
  buffer_after_min      int not null default 0 check (buffer_after_min between 0 and 120),
  occupied              tstzrange not null,
  blocks_time           boolean not null default true,
  allow_overlap         boolean not null default false,
  duration_min          int not null check (duration_min between 5 and 720),
  price_type            public.price_type not null,
  price_min             numeric(10,2),
  price_max             numeric(10,2),
  price_overridden      boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (booking_id, position),
  foreign key (booking_id, business_id, location_id) references public.bookings (id, business_id, location_id) on delete cascade,
  foreign key (staff_id, location_id)   references public.staff_locations (staff_id, location_id),
  foreign key (service_id, business_id) references public.services (id, business_id),
  check (ends_at > starts_at),
  check (occupied = tstzrange(starts_at - make_interval(mins => buffer_before_min),
                              ends_at   + make_interval(mins => buffer_after_min), '[)')),
  check ((selection_mode in ('specific', 'rebook')) = (requested_staff_id is not null)),
  check ((selection_mode = 'any') = (assignment_rule_used is not null)),

  -- ══ THE CONCURRENCY GUARANTEE (Phase 3 Part 3 §1.2) ══
  -- One staff member can never have two time-blocking items overlapping: holds, pending,
  -- confirmed or completed, online or manual.
  constraint booking_items_no_staff_overlap
    exclude using gist (staff_id with =, occupied with &&)
    where (blocks_time and not allow_overlap)
);
create index on public.booking_items (staff_id, starts_at);
create index on public.booking_items (business_id, starts_at);
-- Busy-time lookups (availability, assignment, hold cleanup) filter `blocks_time` only, so the
-- exclusion constraint's partial index (blocks_time AND NOT allow_overlap) can't serve them. Without
-- this index those queries scan a staff member's entire booking history (found by the M3 perf test).
create index booking_items_busy_gist on public.booking_items using gist (staff_id, occupied) where blocks_time;
create index on public.booking_items (booking_id);
create trigger booking_items_updated_at before update on public.booking_items
  for each row execute function private.set_updated_at();

-- ─── Transition table (Part 3 §1.4) ────────────────────────────────────────
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
  ('completed', 'no_show',   'business'),
  ('no_show',   'completed', 'admin'),
  ('no_show',   'completed', 'business');

create function private.assert_transition(p_from public.booking_status, p_to public.booking_status,
                                          p_actor public.actor_kind)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.booking_transitions t
                 where t.from_status = p_from and t.to_status = p_to and t.actor = p_actor) then
    raise exception using errcode = 'P0001', message = 'TRANSITION_NOT_ALLOWED',
      detail = jsonb_build_object('from', p_from, 'to', p_to, 'actor', p_actor)::text;
  end if;
end $$;

-- Status-derived columns, and a safety net: no status change outside the table, whoever the caller.
create function private.booking_status_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if not exists (select 1 from private.booking_transitions t
                   where t.from_status = old.status and t.to_status = new.status) then
      raise exception using errcode = 'P0001', message = 'TRANSITION_NOT_ALLOWED',
        detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
    end if;
    if old.status = 'held' then
      new.hold_token_hash    := null;
      new.hold_owner_user_id := null;
    end if;
    if new.status = 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now()); end if;
    if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); end if;
    if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
    if new.status = 'no_show'   then new.no_show_at   := coalesce(new.no_show_at, now());   end if;
    if new.status in ('confirmed', 'completed', 'cancelled', 'no_show') then
      new.expires_at := null;
    end if;
  end if;
  return new;
end $$;
create trigger bookings_status_guard before update of status on public.bookings
  for each row execute function private.booking_status_guard();

-- Items block time only while the booking is held/pending/confirmed/completed
create function private.sync_blocks_time() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.booking_items
     set blocks_time = new.status in ('held', 'pending', 'confirmed', 'completed')
   where booking_id = new.id
     and blocks_time is distinct from (new.status in ('held', 'pending', 'confirmed', 'completed'));
  return null;
end $$;
create trigger bookings_sync_blocks_time after update of status on public.bookings
  for each row execute function private.sync_blocks_time();

-- Attribution is history: source never changes (Part 1 P10)
create function private.forbid_source_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.source is distinct from old.source then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_FIELD', detail = '{"field":"source"}';
  end if;
  return new;
end $$;
create trigger bookings_source_immutable before update of source on public.bookings
  for each row execute function private.forbid_source_change();

-- ─── booking_events (append-only) ──────────────────────────────────────────
create table public.booking_events (
  id              bigint generated always as identity primary key,
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  business_id     uuid not null,
  event           public.booking_event_type not null,
  actor_kind      public.actor_kind not null,
  actor_user_id   uuid,
  from_status     public.booking_status,
  to_status       public.booking_status,
  data            jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index on public.booking_events (booking_id, created_at);
create index on public.booking_events (business_id, created_at desc);
create trigger booking_events_immutable before update or delete on public.booking_events
  for each row execute function audit.deny_mutation();
create trigger booking_events_no_truncate before truncate on public.booking_events
  for each statement execute function audit.deny_mutation();

create function private.log_booking_event(p_booking_id uuid, p_event public.booking_event_type,
                                          p_actor public.actor_kind, p_from public.booking_status,
                                          p_to public.booking_status, p_data jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.booking_events (booking_id, business_id, event, actor_kind, actor_user_id, from_status, to_status, data)
  select b.id, b.business_id, p_event, p_actor, private.uid(), p_from, p_to, coalesce(p_data, '{}')
  from public.bookings b where b.id = p_booking_id
$$;

-- ─── Access tokens (WhatsApp manage / review / claim links; used from M4/M7) ─
create table private.access_tokens (
  id                    uuid primary key default gen_random_uuid(),
  token_hash            bytea not null unique,
  purpose               text not null check (purpose in ('manage_booking', 'review', 'claim_visit')),
  booking_id            uuid references public.bookings(id) on delete cascade,
  business_customer_id  uuid,
  phone_e164            text,
  expires_at            timestamptz not null,
  used_at               timestamptz,
  created_at            timestamptz not null default now()
);
create index on private.access_tokens (booking_id);

-- ─── RLS (Part 6 §3.4): read-only for members; ALL writes via RPCs ─────────
alter table public.bookings       enable row level security;
alter table public.booking_items  enable row level security;
alter table public.booking_events enable row level security;

grant select on public.bookings, public.booking_items, public.booking_events to authenticated;
revoke insert, update, delete on public.bookings, public.booking_items, public.booking_events from authenticated, anon;

create policy bookings_desk_read on public.bookings for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}')));
create policy bookings_staff_read on public.bookings for select to authenticated
  using (exists (select 1 from public.booking_items bi
                 where bi.booking_id = bookings.id and bi.staff_id in (select private.my_staff_ids())));
create policy bookings_admin_read on public.bookings for select to authenticated
  using ((select private.is_admin('{support}')));

create policy booking_items_desk_read on public.booking_items for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}')));
create policy booking_items_staff_read on public.booking_items for select to authenticated
  using (staff_id in (select private.my_staff_ids()));
create policy booking_items_admin_read on public.booking_items for select to authenticated
  using ((select private.is_admin('{support}')));

create policy booking_events_desk_read on public.booking_events for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}')));
create policy booking_events_staff_read on public.booking_events for select to authenticated
  using (booking_id in (select bi.booking_id from public.booking_items bi
                        where bi.staff_id in (select private.my_staff_ids())));
create policy booking_events_admin_read on public.booking_events for select to authenticated
  using ((select private.is_admin('{support}')));

select private.assign_app_ownership();
