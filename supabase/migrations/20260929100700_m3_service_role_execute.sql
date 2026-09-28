-- M3 · Explicit service_role EXECUTE on public RPCs (align local with hosted)
-- Found by the M3 staging fingerprint: hosted Supabase's default privileges for `postgres` in
-- `public` grant EXECUTE on new functions to service_role; local does not. Same rule as M1
-- (20260927211000, decision log 2026-09-28): make it explicit so both environments are identical.
-- service_role is server-only (Part 1 §6.1). Booking RPCs still require a user (private.uid()),
-- so a service_role call without JWT claims gets AUTH_REQUIRED. private/audit stay closed.

grant execute on all functions in schema public to service_role;

alter default privileges for role postgres, app_owner in schema public
  grant execute on functions to service_role;
