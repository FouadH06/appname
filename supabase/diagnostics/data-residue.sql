-- Read-only: confirms test runs left no data behind (users, profiles, admins, audit rows by humans).
--   supabase test db --linked supabase/diagnostics/data-residue.sql
set role postgres;
do $$
begin
  raise notice 'RES auth.users=% profiles=% admin_users=% rate_limits=% audit_non_system=% admin_actions=%',
    (select count(*) from auth.users),
    (select count(*) from public.profiles),
    (select count(*) from public.admin_users),
    (select count(*) from private.rate_limits),
    (select count(*) from audit.entity_changes where actor_kind <> 'system'),
    (select count(*) from audit.admin_actions);
end $$;
