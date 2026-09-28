-- M2 · Make slug format checks independent of search_path
-- Found by the staging schema fingerprint: `slug ~ '...'` on a citext column resolved to citext's
-- case-INsensitive regex operator where `extensions` was on the search_path (local), and to the
-- case-sensitive text operator where it wasn't (hosted push). Intended rule: lowercase only.
-- Casting both sides to text pins the operator everywhere.

alter table public.businesses drop constraint businesses_slug_check;
alter table public.businesses add constraint businesses_slug_check
  check (slug::text ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'::text);

alter table public.staff_members drop constraint staff_members_slug_check;
alter table public.staff_members add constraint staff_members_slug_check
  check (slug::text ~ '^[a-z0-9-]{1,40}$'::text);
