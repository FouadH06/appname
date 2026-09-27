-- M1 · Profiles, auth sync, customer check, device/IP signals
-- Spec: Phase 3 Part 2 §1.1, §1.3, Part 1 §7, Part 6 §3.2
-- Approved Phase 3 change: phone verification syncs the phone ONLY and never claims history.

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
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status <> 'deleted' or deleted_at is not null),
  check (phone_verified_at is null or phone_e164 is not null)
);
create unique index profiles_phone_uq on public.profiles (phone_e164)
  where phone_e164 is not null and status <> 'deleted';
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- ─── auth.users → profiles sync ────────────────────────────────────────────
-- Keeps phone/email in step with Supabase Auth. Does NOTHING else (no claims, no linking).
-- GoTrue stores phones without '+', so normalize to E.164.
create function private.sync_profile_from_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := case when nullif(new.phone, '') is not null
                       then private.normalize_phone('+' || ltrim(new.phone, '+')) end;
begin
  insert into public.profiles as p (id, phone_e164, phone_verified_at, email)
  values (new.id,
          v_phone,
          case when v_phone is not null then new.phone_confirmed_at end,
          nullif(new.email, ''))
  on conflict (id) do update set
    phone_e164        = excluded.phone_e164,
    phone_verified_at = excluded.phone_verified_at,
    email             = excluded.email
  where p.phone_e164 is distinct from excluded.phone_e164
     or p.phone_verified_at is distinct from excluded.phone_verified_at
     or p.email is distinct from excluded.email;
  return new;
end $$;

create trigger on_auth_user_synced
  after insert or update of phone, phone_confirmed_at, email on auth.users
  for each row execute function private.sync_profile_from_auth();

-- Backfill for users that existed before this migration (none on a fresh DB).
insert into public.profiles (id, phone_e164, phone_verified_at, email)
select u.id,
       private.normalize_phone('+' || ltrim(u.phone, '+')),
       case when nullif(u.phone, '') is not null then u.phone_confirmed_at end,
       nullif(u.email, '')
from auth.users u
on conflict (id) do nothing;

-- ─── Customer check (Part 1 §7) ────────────────────────────────────────────
-- Active, non-anonymous, not suspended, with a verified phone.
create function private.is_active_customer() returns boolean
language sql stable security definer set search_path = '' as $$
  select not private.is_anonymous()
     and exists (
       select 1 from public.profiles p
       where p.id = private.uid()
         and p.status in ('active', 'warned')
         and p.phone_verified_at is not null
     )
$$;
grant execute on function private.is_active_customer() to anon, authenticated;

-- ─── RLS (Part 6 §3.2) ─────────────────────────────────────────────────────
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
-- Only personal preferences are client-editable. Phone comes from Auth; status from admin RPCs.
grant update (first_name, last_name, locale, default_area_id) on public.profiles to authenticated;

create policy profiles_own_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) and not (select private.is_anonymous()))
  with check (id = (select auth.uid()));
create policy profiles_admin_read on public.profiles for select to authenticated
  using ((select private.is_admin('{support,ops}')));

-- ─── Device & IP signals (private; fraud detection, Part 2 §1.3) ───────────
create table private.user_devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_hash   text not null,          -- salted hash of install id / web fingerprint
  platform      text not null check (platform in ('ios', 'android', 'web')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (user_id, device_hash)
);
create index on private.user_devices (device_hash);

create table private.user_ip_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  ip_hash     text not null,            -- HMAC(ip, secret); raw IPs are never stored
  action      text not null check (action in ('signup', 'otp', 'booking', 'review')),
  created_at  timestamptz not null default now()
);
create index on private.user_ip_events (ip_hash, created_at);

select private.assign_app_ownership();
