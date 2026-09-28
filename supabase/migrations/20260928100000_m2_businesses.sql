-- M2 · Businesses, slugs, categories, locations, hours, closures, members, invitations,
--      settings, verification placeholder, and business-membership helpers
-- Spec: Phase 3 Part 2 §5, Part 1 §7 (helpers), Part 6 §3.3 (RLS), Part 5 §8 (audit)

-- ─── Businesses ────────────────────────────────────────────────────────────
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
  website_url          text check (website_url ~* '^https?://'),
  amenities            text[] not null default '{}',
  price_level          smallint check (price_level between 1 and 3),
  is_test              boolean not null default false,
  published_at         timestamptz,
  claimed_at           timestamptz,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on public.businesses (status) where not is_test;
create trigger businesses_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();

-- ─── Slugs: reserved words + history (301 redirects) ───────────────────────
create table public.reserved_slugs (slug extensions.citext primary key);

create table public.business_slug_history (
  old_slug     extensions.citext primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  changed_at   timestamptz not null default now()
);
create index on public.business_slug_history (business_id);

-- A slug can't be reserved or be another business's old slug. On change, the old slug goes
-- to history; a business may take back one of its own old slugs.
create function private.enforce_business_slug() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug)
     or exists (select 1 from public.business_slug_history h
                where h.old_slug = new.slug and h.business_id <> new.id) then
    raise exception using errcode = 'P0001', message = 'SLUG_UNAVAILABLE',
      detail = jsonb_build_object('slug', new.slug::text)::text;
  end if;
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    delete from public.business_slug_history where old_slug = new.slug and business_id = new.id;
    insert into public.business_slug_history (old_slug, business_id) values (old.slug, new.id);
  end if;
  return new;
end $$;
create trigger businesses_slug before insert or update of slug on public.businesses
  for each row execute function private.enforce_business_slug();

-- Route words, plus every area and category slug (they appear in SEO paths /{area}/{category}).
insert into public.reserved_slugs (slug)
select s from unnest(array[
  'about', 'account', 'admin', 'api', 'app', 'auth', 'biz', 'blog', 'book', 'booking', 'bookings',
  'business', 'businesses', 'careers', 'categories', 'contact', 'dashboard', 'explore', 'favorites',
  'help', 'home', 'legal', 'login', 'logout', 'm', 'me', 'notifications', 'partners', 'pricing',
  'privacy', 'profile', 'r', 'register', 'results', 'review', 'reviews', 'search', 'services',
  'settings', 'signin', 'signup', 'staff', 'static', 'support', 'terms', 'www',
  -- Platform brand: placeholder until the brand is chosen; the rename migration adds the real name.
  'app-name'
]) as s
union select slug from public.areas
union select slug from public.categories
union select slug from public.clusters
on conflict do nothing;

-- ─── Categories per business ───────────────────────────────────────────────
create table public.business_categories (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  category_id  uuid not null references public.categories(id),
  is_primary   boolean not null default false,
  primary key (business_id, category_id)
);
create unique index business_categories_one_primary on public.business_categories (business_id) where is_primary;
create index on public.business_categories (category_id);

-- ─── Locations ─────────────────────────────────────────────────────────────
create table public.business_locations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id),
  name            text check (char_length(name) <= 80),
  area_id         uuid not null references public.areas(id),
  address_line    text check (char_length(address_line) <= 200),
  building        text check (char_length(building) <= 80),
  floor           text check (char_length(floor) <= 20),
  landmark        text check (char_length(landmark) <= 160),
  geo             extensions.geography(Point, 4326) not null,
  timezone        text not null default 'Asia/Beirut' check (timezone in ('Asia/Beirut')),
  phone_e164      text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_e164   text check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status          public.location_status not null default 'draft',
  is_primary      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, business_id)
);
create unique index business_locations_one_primary on public.business_locations (business_id) where is_primary;
create index on public.business_locations using gist (geo);
create index on public.business_locations (area_id) where status = 'live';
create index on public.business_locations (business_id);
create trigger business_locations_updated_at before update on public.business_locations
  for each row execute function private.set_updated_at();

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
create index on public.location_hours (business_id);

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
create index on public.location_closures (business_id);

-- ─── Members & invitations ─────────────────────────────────────────────────
create table public.business_members (
  business_id  uuid not null references public.businesses(id),
  user_id      uuid not null references auth.users(id),
  role         public.business_role not null,
  status       public.member_status not null default 'active',
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index on public.business_members (user_id) where status = 'active';
create unique index business_one_owner on public.business_members (business_id)
  where role = 'owner' and status = 'active';
create trigger business_members_updated_at before update on public.business_members
  for each row execute function private.set_updated_at();

create table private.business_invitations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id),
  phone_e164   text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  role         public.business_role not null,
  staff_id     uuid,                                -- FK added with staff_members (M2 staff migration)
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now()
);
create index on private.business_invitations (business_id);

-- ─── Settings (one row per business, created automatically) ────────────────
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
  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now(),
  check ((max_advance_days * 1440) > min_notice_minutes)
);
create trigger business_settings_updated_at before update on public.business_settings
  for each row execute function private.set_updated_at();

-- ─── Verification placeholder [SOON] ───────────────────────────────────────
create table public.business_verifications (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id),
  status        public.verification_status not null default 'pending',
  documents     jsonb not null default '[]',
  checks        jsonb not null default '{}',
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.business_verifications (business_id);
create trigger business_verifications_updated_at before update on public.business_verifications
  for each row execute function private.set_updated_at();

-- ─── New business bootstrap: settings + primary category row ───────────────
-- (subscription row is added by the billing migration's trigger)
create function private.bootstrap_business() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.business_settings (business_id) values (new.id);
  end if;
  if tg_op = 'INSERT' or new.primary_category_id is distinct from old.primary_category_id then
    update public.business_categories set is_primary = false
      where business_id = new.id and is_primary and category_id <> new.primary_category_id;
    insert into public.business_categories (business_id, category_id, is_primary)
    values (new.id, new.primary_category_id, true)
    on conflict (business_id, category_id) do update set is_primary = true;
  end if;
  return null;
end $$;
create trigger businesses_bootstrap after insert or update of primary_category_id on public.businesses
  for each row execute function private.bootstrap_business();

-- ─── Business-membership helpers (Part 1 §7, deferred from M1) ─────────────
create function private.has_business_role(p_business_id uuid, p_roles public.business_role[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = private.uid()
      and m.status = 'active'
      and (p_roles is null or m.role = any (p_roles))
  )
$$;

create function private.my_business_ids(p_roles public.business_role[] default null)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.business_id from public.business_members m
  where m.user_id = private.uid() and m.status = 'active'
    and (p_roles is null or m.role = any (p_roles))
$$;

-- Live business + live location + not a test business (Part 2 §5.1)
create function private.is_publicly_visible_location(p_location_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_locations l
    join public.businesses b on b.id = l.business_id
    where l.id = p_location_id and l.status = 'live' and b.status = 'live' and not b.is_test
  )
$$;

grant execute on function private.has_business_role(uuid, public.business_role[]) to authenticated;
grant execute on function private.my_business_ids(public.business_role[])          to authenticated;
grant execute on function private.is_publicly_visible_location(uuid)               to anon, authenticated;

-- ─── RLS (Part 6 §3.3) ─────────────────────────────────────────────────────
alter table public.businesses             enable row level security;
alter table public.reserved_slugs         enable row level security;
alter table public.business_slug_history  enable row level security;
alter table public.business_categories    enable row level security;
alter table public.business_locations     enable row level security;
alter table public.location_hours         enable row level security;
alter table public.location_closures      enable row level security;
alter table public.business_members       enable row level security;
alter table public.business_settings      enable row level security;
alter table public.business_verifications enable row level security;

-- businesses: members read; owner/manager edit profile columns; creation & status via RPC
grant select on public.businesses to authenticated;
grant update (name, description, audience, amenities, instagram_handle, website_url)
  on public.businesses to authenticated;
create policy businesses_member_read on public.businesses for select to authenticated
  using (id in (select private.my_business_ids()));
create policy businesses_manage_update on public.businesses for update to authenticated
  using (id in (select private.my_business_ids('{owner,manager}')))
  with check (id in (select private.my_business_ids('{owner,manager}')));

-- slugs: admin (ops) only
grant select on public.reserved_slugs, public.business_slug_history to authenticated;
create policy reserved_slugs_ops_read on public.reserved_slugs for select to authenticated
  using ((select private.is_admin('{ops}')));
create policy slug_history_ops_read on public.business_slug_history for select to authenticated
  using ((select private.is_admin('{ops}')));

-- business_categories: members read; owner/manager add/remove secondary categories
grant select, insert, delete on public.business_categories to authenticated;
create policy business_categories_member_read on public.business_categories for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy business_categories_manage_insert on public.business_categories for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,manager}')) and not is_primary);
create policy business_categories_manage_delete on public.business_categories for delete to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')) and not is_primary);

-- business_locations: members read; owner/manager edit address/contact; creation & status via RPC
grant select on public.business_locations to authenticated;
grant update (name, area_id, address_line, building, floor, landmark, geo, phone_e164, whatsapp_e164)
  on public.business_locations to authenticated;
create policy locations_member_read on public.business_locations for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy locations_manage_update on public.business_locations for update to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')))
  with check (business_id in (select private.my_business_ids('{owner,manager}')));

-- location_hours / closures: members read; owner/manager manage
grant select, insert, delete on public.location_hours, public.location_closures to authenticated;
grant update (iso_weekday, start_minute, end_minute) on public.location_hours to authenticated;
grant update (period, label) on public.location_closures to authenticated;
do $$
declare t text;
begin
  foreach t in array array['location_hours', 'location_closures'] loop
    execute format('create policy %I on public.%I for select to authenticated using (business_id in (select private.my_business_ids()))', t || '_member_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (business_id in (select private.my_business_ids(''{owner,manager}''))) with check (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_delete', t);
  end loop;
end $$;

-- business_members: owner/manager see the whole team; everyone sees their own row; writes via RPC
grant select on public.business_members to authenticated;
create policy members_team_read on public.business_members for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')));
create policy members_self_read on public.business_members for select to authenticated
  using (user_id = (select auth.uid()));

-- business_settings: members read; owner/manager update everything except the key
grant select on public.business_settings to authenticated;
grant update (allow_online_booking, booking_mode, request_expiry_minutes, min_notice_minutes, max_advance_days,
              slot_interval_minutes, cancellation_window_minutes, staff_choice_mode, assignment_rule,
              show_staff_price_differences, show_staff_appointment_counts, notify_customer_on_any_reassign,
              max_active_bookings_per_customer, auto_complete_after_minutes, reception_sees_revenue,
              staff_see_customer_phone)
  on public.business_settings to authenticated;
create policy settings_member_read on public.business_settings for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy settings_manage_update on public.business_settings for update to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')))
  with check (business_id in (select private.my_business_ids('{owner,manager}')));

-- business_verifications: owner reads/submits; ops reviews via RPC [SOON]
grant select on public.business_verifications to authenticated;
grant insert (business_id, documents, checks) on public.business_verifications to authenticated;
create policy verifications_owner_read on public.business_verifications for select to authenticated
  using (business_id in (select private.my_business_ids('{owner}')));
create policy verifications_owner_insert on public.business_verifications for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner}')));

-- Admin read on every business table (writes go through audited admin RPCs)
do $$
declare t text;
begin
  foreach t in array array['businesses', 'business_categories', 'business_locations', 'location_hours',
                           'location_closures', 'business_members', 'business_settings',
                           'business_verifications'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_admin()))',
                   t || '_admin_read', t);
  end loop;
end $$;

-- ─── Audit (Part 5 §8) ─────────────────────────────────────────────────────
create trigger businesses_audit after insert or update or delete on public.businesses
  for each row execute function audit.capture();
create trigger business_settings_audit after insert or update or delete on public.business_settings
  for each row execute function audit.capture('business_id');
create trigger business_members_audit after insert or update or delete on public.business_members
  for each row execute function audit.capture('user_id');
create trigger business_locations_audit after insert or update or delete on public.business_locations
  for each row execute function audit.capture();
create trigger location_hours_audit after insert or update or delete on public.location_hours
  for each row execute function audit.capture();
create trigger location_closures_audit after insert or update or delete on public.location_closures
  for each row execute function audit.capture();

select private.assign_app_ownership();
