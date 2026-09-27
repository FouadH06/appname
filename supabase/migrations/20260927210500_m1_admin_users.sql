-- M1 · Admin users + is_admin (MFA-gated)
-- Spec: Phase 3 Part 2 §1.2, Part 1 §6.2/§6.4/§7

create table public.admin_users (
  user_id     uuid primary key references auth.users(id),
  role        public.admin_role not null,
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger admin_users_updated_at before update on public.admin_users
  for each row execute function private.set_updated_at();
create trigger admin_users_audit after insert or update or delete on public.admin_users
  for each row execute function audit.capture('user_id');

-- True only for an active admin whose session passed MFA (aal2).
-- superadmin satisfies every role check.
create function private.is_admin(p_roles public.admin_role[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1 from public.admin_users a
       where a.user_id = auth.uid()
         and a.is_active
         and (p_roles is null or a.role = any (p_roles) or a.role = 'superadmin')
     )
$$;
grant execute on function private.is_admin(public.admin_role[]) to anon, authenticated;

-- ─── RLS (Part 6 §3.2): admins read; superadmin manages ────────────────────
alter table public.admin_users enable row level security;
grant select, insert, update on public.admin_users to authenticated;

create policy admin_users_read on public.admin_users for select to authenticated
  using ((select private.is_admin()));
create policy admin_users_superadmin_insert on public.admin_users for insert to authenticated
  with check ((select private.is_admin('{superadmin}')));
create policy admin_users_superadmin_update on public.admin_users for update to authenticated
  using ((select private.is_admin('{superadmin}')))
  with check ((select private.is_admin('{superadmin}')));

select private.assign_app_ownership();
