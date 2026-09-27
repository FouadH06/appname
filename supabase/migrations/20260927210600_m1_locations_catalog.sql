-- M1 · Location taxonomy (areas, clusters) + service catalog
-- Spec: Phase 3 Part 2 §3 (locations), §4 (catalog), Part 6 §3.1 (RLS)
-- catalog_suggestions references businesses and is created in M2.

-- ─── Areas ─────────────────────────────────────────────────────────────────
create table public.areas (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.areas(id),
  level       public.area_level not null,
  slug        extensions.citext not null unique,
  name_en     text not null,
  name_ar     text not null,
  name_fr     text,
  centroid    extensions.geography(Point, 4326),
  boundary    extensions.geography(MultiPolygon, 4326),
  is_live     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((level = 'governorate') = (parent_id is null))
);
create index on public.areas (parent_id);
create trigger areas_updated_at before update on public.areas
  for each row execute function private.set_updated_at();

create table public.area_aliases (
  area_id           uuid not null references public.areas(id) on delete cascade,
  alias             text not null,
  alias_normalized  text generated always as (private.search_key(alias)) stored,
  primary key (area_id, alias)
);
create index on public.area_aliases using gin (alias_normalized extensions.gin_trgm_ops);

create table public.clusters (
  id                 uuid primary key default gen_random_uuid(),
  slug               extensions.citext not null unique,
  name_en            text not null,
  name_ar            text not null,
  target_businesses  int not null default 20 check (target_businesses > 0),
  is_live            boolean not null default false,
  sort               int not null default 0
);

create table public.cluster_areas (
  cluster_id  uuid not null references public.clusters(id) on delete cascade,
  area_id     uuid not null references public.areas(id),
  primary key (cluster_id, area_id)
);
create index on public.cluster_areas (area_id);

-- ─── Catalog ───────────────────────────────────────────────────────────────
create table public.categories (
  id                            uuid primary key default gen_random_uuid(),
  parent_id                     uuid references public.categories(id),
  slug                          extensions.citext not null unique,
  name_en                       text not null,
  name_ar                       text not null,
  name_fr                       text,
  icon                          text,
  is_live                       boolean not null default false,
  allows_before_after_default   boolean not null default false,
  requires_consultation_default boolean not null default false,
  sort                          int not null default 0,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index on public.categories (parent_id);
create trigger categories_updated_at before update on public.categories
  for each row execute function private.set_updated_at();

-- Structured rating dimensions live on a root category; subcategories inherit.
create table public.rating_dimensions (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id),
  key          text not null check (key ~ '^[a-z][a-z_]{1,40}$'),
  label_en     text not null,
  label_ar     text not null,
  label_fr     text,
  sort         int not null default 0,
  is_active    boolean not null default true,
  unique (category_id, key)
);

create table public.canonical_services (
  id                    uuid primary key default gen_random_uuid(),
  category_id           uuid not null references public.categories(id),
  slug                  extensions.citext not null unique,
  name_en               text not null,
  name_ar               text not null,
  name_fr               text,
  typical_duration_min  int check (typical_duration_min between 5 and 720),
  allows_before_after   boolean not null default false,
  relevance_hints       text[] not null default '{}',
  is_active             boolean not null default true,
  sort                  int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.canonical_services (category_id) where is_active;
create trigger canonical_services_updated_at before update on public.canonical_services
  for each row execute function private.set_updated_at();

create table public.service_synonyms (
  id                    uuid primary key default gen_random_uuid(),
  canonical_service_id  uuid not null references public.canonical_services(id) on delete cascade,
  term                  text not null check (char_length(term) between 1 and 60),
  lang                  public.synonym_lang not null,
  term_normalized       text generated always as (private.search_key(term)) stored,
  weight                real not null default 1.0 check (weight > 0 and weight <= 1),
  unique (canonical_service_id, term)
);
create index on public.service_synonyms using gin (term_normalized extensions.gin_trgm_ops);

-- ─── RLS (Part 6 §3.1): public reference data; ops write ───────────────────
alter table public.areas              enable row level security;
alter table public.area_aliases       enable row level security;
alter table public.clusters           enable row level security;
alter table public.cluster_areas      enable row level security;
alter table public.categories         enable row level security;
alter table public.rating_dimensions  enable row level security;
alter table public.canonical_services enable row level security;
alter table public.service_synonyms   enable row level security;

grant select on public.areas, public.area_aliases, public.clusters, public.cluster_areas,
                public.categories, public.rating_dimensions, public.canonical_services,
                public.service_synonyms
  to anon, authenticated;
grant insert, update on public.areas, public.area_aliases, public.clusters, public.cluster_areas,
                        public.categories, public.rating_dimensions, public.canonical_services,
                        public.service_synonyms
  to authenticated;
-- Removing aliases / synonyms / cluster membership is a normal ops edit.
grant delete on public.area_aliases, public.service_synonyms, public.cluster_areas to authenticated;

-- Public reads. Areas and clusters are readable even when not live, because profiles,
-- addresses and the admin console reference them; discovery RPCs filter on is_live.
create policy areas_read          on public.areas          for select to anon, authenticated using (true);
create policy area_aliases_read   on public.area_aliases   for select to anon, authenticated using (true);
create policy clusters_read       on public.clusters       for select to anon, authenticated using (true);
create policy cluster_areas_read  on public.cluster_areas  for select to anon, authenticated using (true);
create policy categories_read     on public.categories     for select to anon, authenticated
  using (is_live or (select private.is_admin('{ops}')));
create policy rating_dimensions_read on public.rating_dimensions for select to anon, authenticated
  using (is_active or (select private.is_admin('{ops}')));
create policy canonical_services_read on public.canonical_services for select to anon, authenticated
  using (is_active or (select private.is_admin('{ops}')));
create policy service_synonyms_read on public.service_synonyms for select to anon, authenticated
  using (true);

-- Ops writes (insert/update everywhere; delete where granted above)
do $$
declare t text;
begin
  foreach t in array array['areas', 'area_aliases', 'clusters', 'cluster_areas', 'categories',
                           'rating_dimensions', 'canonical_services', 'service_synonyms'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.is_admin(''{ops}'')))',
      t || '_ops_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.is_admin(''{ops}''))) with check ((select private.is_admin(''{ops}'')))',
      t || '_ops_update', t);
  end loop;
  foreach t in array array['area_aliases', 'service_synonyms', 'cluster_areas'] loop
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.is_admin(''{ops}'')))',
      t || '_ops_delete', t);
  end loop;
end $$;

-- Catalog changes are admin actions → audit (Part 5 §8 covers business tables; catalog
-- edits are recorded here too because they change search and moderation behavior).
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function audit.capture();
create trigger canonical_services_audit after insert or update or delete on public.canonical_services
  for each row execute function audit.capture();
create trigger service_synonyms_audit after insert or update or delete on public.service_synonyms
  for each row execute function audit.capture();
create trigger rating_dimensions_audit after insert or update or delete on public.rating_dimensions
  for each row execute function audit.capture();

select private.assign_app_ownership();
