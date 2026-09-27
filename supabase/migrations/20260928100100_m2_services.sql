-- M2 · Service groups, services, combos, catalog suggestions
-- Spec: Phase 3 Part 2 §4 (catalog_suggestions), §6 (services), Part 6 §3.1/§3.3, Part 5 §8

create table public.service_groups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id),
  name         text not null check (char_length(name) between 1 and 60),
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, business_id)
);
create index on public.service_groups (business_id);
create trigger service_groups_updated_at before update on public.service_groups
  for each row execute function private.set_updated_at();

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
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, business_id),
  foreign key (group_id, business_id) references public.service_groups (id, business_id),
  -- Spec correction (M2): every comparison is guarded with IS NOT NULL. In the spec's version,
  -- `price_max > price_min` with a NULL max evaluated to NULL, and a NULL CHECK passes.
  check (
    (price_type = 'fixed'           and price_min is not null and price_max is null) or
    (price_type = 'from'            and price_min is not null and price_max is null) or
    (price_type = 'range'           and price_min is not null and price_max is not null and price_max > price_min) or
    (price_type = 'on_consultation' and price_min is null and price_max is null and not is_online_bookable)
  )
);
create index on public.services (business_id) where status = 'active';
create index on public.services (canonical_service_id) where status = 'active';
create trigger services_updated_at before update on public.services
  for each row execute function private.set_updated_at();

-- Combos map to several canonical services for search ("Hair + Beard" → haircut, beard-trim)
create table public.service_combo_items (
  service_id            uuid not null references public.services(id) on delete cascade,
  canonical_service_id  uuid not null references public.canonical_services(id),
  primary key (service_id, canonical_service_id)
);

-- Business "Other" mappings awaiting ops review (deferred from M1: references businesses/services)
create table public.catalog_suggestions (
  id                             uuid primary key default gen_random_uuid(),
  business_id                    uuid not null references public.businesses(id),
  service_id                     uuid,
  proposed_name                  text not null check (char_length(proposed_name) between 1 and 80),
  status                         text not null default 'open'
                                 check (status in ('open', 'mapped', 'created', 'rejected')),
  resolved_canonical_service_id  uuid references public.canonical_services(id),
  resolved_by                    uuid references auth.users(id),
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  foreign key (service_id, business_id) references public.services (id, business_id)
);
create index on public.catalog_suggestions (status, created_at);
create trigger catalog_suggestions_updated_at before update on public.catalog_suggestions
  for each row execute function private.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────────────────
alter table public.service_groups      enable row level security;
alter table public.services            enable row level security;
alter table public.service_combo_items enable row level security;
alter table public.catalog_suggestions enable row level security;

-- service_groups / services: members read; owner/manager create + edit; no DELETE (archive via status)
grant select on public.service_groups, public.services to authenticated;
grant insert (business_id, name, sort) on public.service_groups to authenticated;
grant update (name, sort) on public.service_groups to authenticated;
grant insert (business_id, group_id, canonical_service_id, name, description, price_type, price_min, price_max,
              currency, duration_min, buffer_before_min, buffer_after_min, location_type, audience,
              is_online_bookable, is_combo, status, sort)
  on public.services to authenticated;
grant update (group_id, canonical_service_id, name, description, price_type, price_min, price_max,
              duration_min, buffer_before_min, buffer_after_min, location_type, audience,
              is_online_bookable, is_combo, status, sort)
  on public.services to authenticated;

do $$
declare t text;
begin
  foreach t in array array['service_groups', 'services'] loop
    execute format('create policy %I on public.%I for select to authenticated using (business_id in (select private.my_business_ids()) or (select private.is_admin()))', t || '_member_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (business_id in (select private.my_business_ids(''{owner,manager}''))) with check (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_update', t);
  end loop;
end $$;

-- combo items: follow the parent service's business
grant select, insert, delete on public.service_combo_items to authenticated;
create policy combo_items_member_read on public.service_combo_items for select to authenticated
  using (service_id in (select s.id from public.services s
                        where s.business_id in (select private.my_business_ids())) or (select private.is_admin()));
create policy combo_items_manage_insert on public.service_combo_items for insert to authenticated
  with check (service_id in (select s.id from public.services s
                             where s.business_id in (select private.my_business_ids('{owner,manager}'))));
create policy combo_items_manage_delete on public.service_combo_items for delete to authenticated
  using (service_id in (select s.id from public.services s
                        where s.business_id in (select private.my_business_ids('{owner,manager}'))));

-- catalog_suggestions: owner/manager create + read their own; ops read + resolve
grant select on public.catalog_suggestions to authenticated;
grant insert (business_id, service_id, proposed_name) on public.catalog_suggestions to authenticated;
grant update (status, resolved_canonical_service_id, resolved_by) on public.catalog_suggestions to authenticated;
create policy suggestions_business_read on public.catalog_suggestions for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')) or (select private.is_admin('{ops}')));
create policy suggestions_business_insert on public.catalog_suggestions for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,manager}')));
create policy suggestions_ops_update on public.catalog_suggestions for update to authenticated
  using ((select private.is_admin('{ops}'))) with check ((select private.is_admin('{ops}')));

-- ─── Audit ─────────────────────────────────────────────────────────────────
create trigger services_audit after insert or update or delete on public.services
  for each row execute function audit.capture();

select private.assign_app_ownership();
