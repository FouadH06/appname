-- Read-only: confirms test runs left no data behind (users, tenant data, bookings, append-only logs).
--   supabase test db --linked supabase/diagnostics/data-residue.sql
-- On staging every count must be 0 except audit_non_system (catalog seed changes are 'system').
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
  raise notice 'RES businesses=% staff=% services=% business_customers=% audit_business_rows=%',
    (select count(*) from public.businesses),
    (select count(*) from public.staff_members),
    (select count(*) from public.services),
    (select count(*) from public.business_customers),
    (select count(*) from audit.entity_changes where business_id is not null);
  raise notice 'RES bookings=% booking_items=% booking_events=% access_tokens=% reliability_events=% customer_reliability=%',
    (select count(*) from public.bookings),
    (select count(*) from public.booking_items),
    (select count(*) from public.booking_events),
    (select count(*) from private.access_tokens),
    (select count(*) from private.reliability_events),
    (select count(*) from private.customer_reliability);
end $$;
