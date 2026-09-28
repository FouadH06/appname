-- M2 · Staff, locations, services (overrides), schedules, time off, stats
-- Spec: Phase 3 Part 2 §7–8, Part 1 §7 (helpers), Part 6 §3.3, Part 5 §8

create table public.staff_members (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id),
  user_id                 uuid references auth.users(id),
  display_name            text not null check (char_length(display_name) between 1 and 60),
  slug                    extensions.citext not null check (slug ~ '^[a-z0-9-]{1,40}$'),
  role_title              text check (char_length(role_title) <= 60),
  bio                     text check (char_length(bio) <= 500),
  photo_media_id          uuid,                              -- FK to business_media added in M10
  gender                  text check (gender in ('female', 'male')),
  -- true : customers can see and specifically choose this person online
  -- false: internal-only; fully usable in the dashboard but NEVER in any public response
  publicly_bookable       boolean not null default true,
  -- eligible for automatic assignment when a customer picks "Any available"
  accepts_any_assignment  boolean not null default true,
  assignment_priority     int not null default 100,
  display_order           int not null default 100,
  last_auto_assigned_at   timestamptz,
  status                  public.lifecycle_status not null default 'active',
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (id, business_id),
  unique (business_id, slug),
  check ((status = 'archived') = (archived_at is not null)),
  check (publicly_bookable or not accepts_any_assignment)
);
create unique index staff_user_per_business on public.staff_members (business_id, user_id) where user_id is not null;
create index on public.staff_members (business_id) where status = 'active';
create index on public.staff_members (user_id) where user_id is not null;
create trigger staff_members_updated_at before update on public.staff_members
  for each row execute function private.set_updated_at();

alter table private.business_invitations
  add foreign key (staff_id) references public.staff_members(id);

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
create index on public.staff_locations (business_id);

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
  -- same shape rules as services.price_type (NULL-safe: a max only exists on a range override)
  check (price_type_override is distinct from 'range' or price_max_override is not null),
  check (price_max_override is null or price_type_override is not distinct from 'range')
);
create index on public.staff_services (service_id);
create index on public.staff_services (business_id);

-- At most 3 specialties per staff member (Part 2 §7)
create function private.enforce_specialty_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_specialty and (select count(*) from public.staff_services
                           where staff_id = new.staff_id and is_specialty) > 3 then
    raise exception using errcode = 'P0001', message = 'SPECIALTY_LIMIT',
      detail = jsonb_build_object('staff_id', new.staff_id, 'max', 3)::text;
  end if;
  return null;
end $$;
create constraint trigger staff_services_specialty_cap
  after insert or update of is_specialty on public.staff_services
  deferrable initially immediate
  for each row execute function private.enforce_specialty_cap();

-- ─── Schedules ─────────────────────────────────────────────────────────────
-- Weekly hours per (staff, location). Multiple intervals per day; gaps = breaks; no rows = day off.
create table public.staff_weekly_hours (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null,
  location_id     uuid not null,
  business_id     uuid not null,
  iso_weekday     smallint not null check (iso_weekday between 1 and 7),
  start_minute    smallint not null check (start_minute between 0 and 1439),
  end_minute      smallint not null check (end_minute between 1 and 1440),
  effective_from  date not null default current_date,
  effective_to    date,
  check (end_minute > start_minute),
  check (effective_to is null or effective_to > effective_from),
  foreign key (staff_id, location_id) references public.staff_locations (staff_id, location_id) on delete cascade,
  foreign key (staff_id, business_id) references public.staff_members (id, business_id),
  exclude using gist (
    staff_id with =, iso_weekday with =,
    int4range(start_minute, end_minute) with &&,
    daterange(effective_from, effective_to) with &&
  )
);
create index on public.staff_weekly_hours (staff_id, location_id, iso_weekday);
create index on public.staff_weekly_hours (business_id);

-- Date-specific replacement. Any row for (staff, date) replaces that day's weekly hours.
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
  foreign key (staff_id, business_id) references public.staff_members (id, business_id),
  -- Spec correction (M2): end_minute IS NOT NULL added (NULL comparison made the CHECK pass)
  check ((is_working and start_minute is not null and end_minute is not null and end_minute > start_minute)
      or (not is_working and start_minute is null and end_minute is null)),
  exclude using gist (
    staff_id with =, on_date with =,
    int4range(coalesce(start_minute, 0), coalesce(end_minute, 1440)) with &&
  )
);
create index on public.staff_schedule_overrides (staff_id, on_date);
create index on public.staff_schedule_overrides (business_id);
-- (An "off" row spans the whole day in the exclusion range, so it can never coexist with a
--  working row for the same staff and date. The spec's constraint trigger isn't needed.)

create table public.staff_time_off (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null,
  business_id  uuid not null,
  period       tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)
                                         and not lower_inf(period) and not upper_inf(period)),
  kind         public.time_off_kind not null default 'personal',
  reason       text check (char_length(reason) <= 200),
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  foreign key (staff_id, business_id) references public.staff_members (id, business_id)
);
create index on public.staff_time_off using gist (staff_id, period);
create index on public.staff_time_off (business_id);

-- ─── Stats cache (maintained from M3/M9) ───────────────────────────────────
create table public.staff_stats (
  staff_id                         uuid primary key references public.staff_members(id) on delete cascade,
  business_id                      uuid not null references public.businesses(id),
  verified_review_count            int not null default 0,
  rating_sum                       int not null default 0,
  rating_display                   numeric(2,1),
  completed_verified_appointments  int not null default 0,
  specifically_requested_count     int not null default 0,
  completed_count                  int not null default 0,
  favorites_count                  int not null default 0,
  next_available_at                timestamptz,
  updated_at                       timestamptz not null default now()
);
create index on public.staff_stats (business_id);

create function private.bootstrap_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff_stats (staff_id, business_id) values (new.id, new.business_id);
  return null;
end $$;
create trigger staff_members_bootstrap after insert on public.staff_members
  for each row execute function private.bootstrap_staff();

-- ─── Staff helpers (Part 1 §7, Part 6 §2) ──────────────────────────────────
create function private.my_staff_id(p_business_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.staff_members s
  where s.business_id = p_business_id and s.user_id = private.uid() and s.status = 'active'
$$;

-- Staff rows of the caller, only where the caller is an active member of that business
create function private.my_staff_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.staff_members s
  join public.business_members m
    on m.business_id = s.business_id and m.user_id = s.user_id and m.status = 'active'
  where s.user_id = private.uid() and s.status = 'active'
$$;

grant execute on function private.my_staff_id(uuid) to authenticated;
grant execute on function private.my_staff_ids()    to authenticated;

-- ─── RLS (Part 6 §3.3) ─────────────────────────────────────────────────────
alter table public.staff_members            enable row level security;
alter table public.staff_locations          enable row level security;
alter table public.staff_services           enable row level security;
alter table public.staff_weekly_hours       enable row level security;
alter table public.staff_schedule_overrides enable row level security;
alter table public.staff_time_off           enable row level security;
alter table public.staff_stats              enable row level security;

-- staff_members: members read; owner/manager create + edit profile/visibility.
-- user_id, status, archived_at, last_auto_assigned_at change only via RPCs (invite, archive, assignment).
grant select on public.staff_members to authenticated;
grant insert (business_id, display_name, slug, role_title, bio, photo_media_id, gender, publicly_bookable,
              accepts_any_assignment, assignment_priority, display_order)
  on public.staff_members to authenticated;
grant update (display_name, slug, role_title, bio, photo_media_id, gender, publicly_bookable,
              accepts_any_assignment, assignment_priority, display_order)
  on public.staff_members to authenticated;
create policy staff_member_read on public.staff_members for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy staff_manage_insert on public.staff_members for insert to authenticated
  with check (business_id in (select private.my_business_ids('{owner,manager}')));
create policy staff_manage_update on public.staff_members for update to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')))
  with check (business_id in (select private.my_business_ids('{owner,manager}')));

-- staff_locations, staff_services, weekly hours, overrides:
--   owner/manager: full · reception: read · staff role: read own rows
grant select, insert, delete on public.staff_locations, public.staff_services,
                                public.staff_weekly_hours, public.staff_schedule_overrides to authenticated;
grant update (is_primary) on public.staff_locations to authenticated;
grant update (duration_min_override, price_type_override, price_min_override, price_max_override, is_specialty)
  on public.staff_services to authenticated;
grant update (iso_weekday, start_minute, end_minute, effective_from, effective_to)
  on public.staff_weekly_hours to authenticated;
grant update (is_working, start_minute, end_minute, note) on public.staff_schedule_overrides to authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff_locations', 'staff_services', 'staff_weekly_hours', 'staff_schedule_overrides'] loop
    execute format('create policy %I on public.%I for select to authenticated using (business_id in (select private.my_business_ids(''{owner,manager,reception}'')) or staff_id in (select private.my_staff_ids()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (business_id in (select private.my_business_ids(''{owner,manager}''))) with check (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (business_id in (select private.my_business_ids(''{owner,manager}'')))', t || '_manage_delete', t);
  end loop;
end $$;

-- staff_time_off: owner/manager full; the staff member reads their own. Reception has NO direct
-- access (the reason is private); the calendar RPC (M6) shows periods without reasons.
grant select, insert, delete on public.staff_time_off to authenticated;
grant update (period, kind, reason) on public.staff_time_off to authenticated;
create policy time_off_manage_all on public.staff_time_off for all to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')))
  with check (business_id in (select private.my_business_ids('{owner,manager}')));
create policy time_off_self_read on public.staff_time_off for select to authenticated
  using (staff_id in (select private.my_staff_ids()));

-- staff_stats: owner/manager/reception read; staff read own; written by jobs only
grant select on public.staff_stats to authenticated;
create policy staff_stats_read on public.staff_stats for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager,reception}'))
         or staff_id in (select private.my_staff_ids()));

do $$
declare t text;
begin
  foreach t in array array['staff_members', 'staff_locations', 'staff_services', 'staff_weekly_hours',
                           'staff_schedule_overrides', 'staff_time_off', 'staff_stats'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_admin()))',
                   t || '_admin_read', t);
  end loop;
end $$;

-- ─── Audit ─────────────────────────────────────────────────────────────────
create trigger staff_members_audit after insert or update or delete on public.staff_members
  for each row execute function audit.capture();
create trigger staff_services_audit after insert or update or delete on public.staff_services
  for each row execute function audit.capture('staff_id');
create trigger staff_weekly_hours_audit after insert or update or delete on public.staff_weekly_hours
  for each row execute function audit.capture();
create trigger staff_schedule_overrides_audit after insert or update or delete on public.staff_schedule_overrides
  for each row execute function audit.capture();
create trigger staff_time_off_audit after insert or update or delete on public.staff_time_off
  for each row execute function audit.capture();

select private.assign_app_ownership();
