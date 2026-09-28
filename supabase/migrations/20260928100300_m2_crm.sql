-- M2 · Business CRM: business_customers (explicit claim model), possible duplicates, notes
-- Spec: Phase 3 Part 2 §2.2–2.3, Part 5 §4, Part 6 §3.4

create table public.business_customers (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id),
  user_id             uuid references auth.users(id) on delete set null,   -- null = shadow customer
  phone_e164          text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),    -- contact snapshot
  display_name        text not null check (char_length(display_name) between 1 and 80),
  acquired_via        public.acquisition_channel not null,                 -- immutable (trigger)
  first_booking_id    uuid,                                                -- FK added with bookings (M3)
  claimed_at          timestamptz,
  merged_into_id      uuid,                                                -- set when a shadow is merged away
  is_blocked_online   boolean not null default false,
  tags                text[] not null default '{}',
  -- cached stats (recomputed by private.recompute_business_customer_stats, M3)
  visit_count         int not null default 0,
  no_show_count       int not null default 0,
  cancel_count        int not null default 0,
  late_cancel_count   int not null default 0,
  lifetime_spend      numeric(12,2) not null default 0,
  first_visit_at      timestamptz,
  last_visit_at       timestamptz,
  preferred_staff_id  uuid,
  favorite_service_id uuid,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, business_id),
  foreign key (merged_into_id, business_id)     references public.business_customers (id, business_id),
  foreign key (preferred_staff_id, business_id)  references public.staff_members (id, business_id),
  foreign key (favorite_service_id, business_id) references public.services (id, business_id),
  check (merged_into_id is null or (archived_at is not null and merged_into_id <> id)),
  check (claimed_at is null or user_id is not null)
);
-- A platform user has at most one record per business
create unique index business_customers_user_uq on public.business_customers (business_id, user_id)
  where user_id is not null;
-- Active shadows are unique by phone per business (archived/merged shadows keep their phone for audit)
create unique index business_customers_shadow_phone_uq on public.business_customers (business_id, phone_e164)
  where user_id is null and phone_e164 is not null and archived_at is null;
create index on public.business_customers (business_id, phone_e164);
create index business_customers_name_trgm on public.business_customers
  using gin ((private.normalize_text(display_name)) extensions.gin_trgm_ops);
create index on public.business_customers (business_id, last_visit_at desc);
create trigger business_customers_updated_at before update on public.business_customers
  for each row execute function private.set_updated_at();

-- acquired_via is attribution history: set once (Part 1 P10)
create function private.forbid_acquired_via_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.acquired_via is distinct from old.acquired_via then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE_FIELD',
      detail = '{"field":"acquired_via"}';
  end if;
  return new;
end $$;
create trigger business_customers_acquired_via_immutable before update of acquired_via on public.business_customers
  for each row execute function private.forbid_acquired_via_change();

-- Pairs flagged for a business-side merge UI [SOON] (online booking next to an unclaimed shadow)
create table private.possible_duplicates (
  business_id  uuid not null references public.businesses(id),
  a_id         uuid not null,
  b_id         uuid not null,
  reason       text not null default 'same_phone',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  primary key (business_id, a_id, b_id),
  check (a_id < b_id),
  foreign key (a_id, business_id) references public.business_customers (id, business_id),
  foreign key (b_id, business_id) references public.business_customers (id, business_id)
);

-- Customer dismissed a "previous visits found" offer for a business (Part 2 §2.3 Flow B)
create table private.claim_dismissals (
  user_id       uuid not null references auth.users(id) on delete cascade,
  business_id   uuid not null references public.businesses(id),
  dismissed_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);

create table public.customer_notes (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null,
  business_customer_id  uuid not null,
  author_user_id        uuid not null references auth.users(id),
  body                  text not null check (char_length(body) between 1 and 1000),
  is_pinned             boolean not null default false,
  visible_to_staff      boolean not null default false,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (business_customer_id, business_id) references public.business_customers (id, business_id)
);
create index on public.customer_notes (business_customer_id, created_at desc) where deleted_at is null;
create index on public.customer_notes (business_id);
create trigger customer_notes_updated_at before update on public.customer_notes
  for each row execute function private.set_updated_at();

-- ─── RLS (Part 6 §3.4) ─────────────────────────────────────────────────────
alter table public.business_customers enable row level security;
alter table public.customer_notes     enable row level security;

-- business_customers: owner/manager read directly; everyone else (reception, staff) through the
-- role-projected CRM RPCs (M5/M6). All writes go through RPCs.
grant select on public.business_customers to authenticated;
create policy business_customers_manage_read on public.business_customers for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')));
create policy business_customers_admin_read on public.business_customers for select to authenticated
  using ((select private.is_admin('{support}')));

-- customer_notes: owner/manager/reception read + write (soft delete via deleted_at); staff via RPC
grant select on public.customer_notes to authenticated;
grant insert (business_id, business_customer_id, author_user_id, body, is_pinned, visible_to_staff)
  on public.customer_notes to authenticated;
grant update (body, is_pinned, visible_to_staff, deleted_at) on public.customer_notes to authenticated;
create policy notes_desk_read on public.customer_notes for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}')));
create policy notes_desk_insert on public.customer_notes for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,manager,reception}'))
              and author_user_id = (select auth.uid()));
create policy notes_desk_update on public.customer_notes for update to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}')))
  with check (business_id in (select private.my_business_ids('{owner,manager,reception}')));
create policy notes_admin_read on public.customer_notes for select to authenticated
  using ((select private.is_admin('{support}')));

-- ─── Audit: note edits and deletions (Part 5 §8) ───────────────────────────
create trigger customer_notes_audit after update or delete on public.customer_notes
  for each row execute function audit.capture();

select private.assign_app_ownership();
