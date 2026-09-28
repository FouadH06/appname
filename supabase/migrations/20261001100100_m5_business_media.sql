-- M5 · Business media (cover, portfolio, staff photos) + public `business-media` bucket
-- Spec: Phase 3 Part 4 §2.1–2.2 (media_assets, business_media), Part 6 storage table.
-- [M5 deviation] The plan put media in M10; the go-live checklist needs a cover photo now, so the
-- two tables arrive here as specified. The async safety check (moderation job) stays in M10;
-- until then business media is published immediately (as the spec allows for business media).

create table public.media_assets (
  id                uuid primary key default gen_random_uuid(),
  uploader_user_id  uuid references auth.users(id) on delete set null,
  business_id       uuid references public.businesses(id),
  purpose           text not null check (purpose in ('review_media', 'business_media', 'dispute_evidence', 'verification')),
  private_bucket    text not null check (private_bucket in ('ugc-private', 'business-media', 'dispute-evidence', 'verification-docs')),
  private_path      text not null unique,
  public_path       text,
  mime              text check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  bytes             int check (bytes <= 12 * 1024 * 1024),
  width             int,
  height            int,
  sha256            bytea,
  phash             bigint,
  blurhash          text,
  status            public.media_status not null default 'uploaded',
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.media_assets (phash) where phash is not null;
create index on public.media_assets (business_id, purpose);
create trigger media_assets_updated_at before update on public.media_assets
  for each row execute function private.set_updated_at();

create table public.business_media (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id),
  location_id     uuid,
  media_asset_id  uuid not null unique references public.media_assets(id),
  kind            public.business_media_kind not null,
  staff_id        uuid,
  service_id      uuid,
  caption         text check (char_length(caption) <= 200),
  sort            int not null default 0,
  state           public.content_state not null default 'approved',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((kind = 'staff_photo') = (staff_id is not null)),
  foreign key (staff_id, business_id) references public.staff_members (id, business_id),
  foreign key (service_id, business_id) references public.services (id, business_id)
);
create unique index business_media_one_cover on public.business_media (business_id) where kind = 'cover' and state = 'approved';
create index on public.business_media (business_id, kind, sort) where state = 'approved';
create trigger business_media_updated_at before update on public.business_media
  for each row execute function private.set_updated_at();
create trigger business_media_audit after insert or update or delete on public.business_media
  for each row execute function audit.capture();

alter table public.staff_members
  add constraint staff_members_photo_fk foreign key (photo_media_id) references public.business_media(id);

-- RLS: members read their business's media; writes only through the RPCs below
alter table public.media_assets   enable row level security;
alter table public.business_media enable row level security;
grant select on public.media_assets, public.business_media to authenticated;
create policy media_assets_member_read on public.media_assets for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy business_media_member_read on public.business_media for select to authenticated
  using (business_id in (select private.my_business_ids()));
create policy business_media_admin_read on public.business_media for select to authenticated
  using ((select private.is_admin('{ops,support,moderator}')));

-- ─── Register an uploaded file (client uploads to business-media/{business_id}/…) ──
create function public.register_business_media(
  p_business_id uuid, p_path text, p_kind public.business_media_kind, p_mime text,
  p_bytes int default null, p_width int default null, p_height int default null,
  p_staff_id uuid default null, p_caption text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_asset uuid; v_media uuid; v_count int;
begin
  if not private.has_business_role(p_business_id, '{owner,manager,reception}') then perform private.raise_code('FORBIDDEN'); end if;
  if p_path is null or p_path !~ ('^' || p_business_id::text || '/[A-Za-z0-9._-]{1,120}$') then
    perform private.raise_code('INVALID_PATH');
  end if;
  if p_kind = 'portfolio' then
    select count(*) into v_count from public.business_media
     where business_id = p_business_id and kind = 'portfolio' and state = 'approved';
    if v_count >= 10 then perform private.raise_code('PORTFOLIO_FULL'); end if;    -- Phase 2 B1: up to 10
  end if;
  if p_kind = 'staff_photo' and not exists (select 1 from public.staff_members where id = p_staff_id and business_id = p_business_id) then
    perform private.raise_code('NOT_FOUND', '{"field":"staff"}');
  end if;

  insert into public.media_assets (uploader_user_id, business_id, purpose, private_bucket, private_path, public_path,
                                   mime, bytes, width, height, status)
  values (private.uid(), p_business_id, 'business_media', 'business-media', p_path, p_path,
          p_mime, p_bytes, p_width, p_height, 'approved')
  returning id into v_asset;

  if p_kind in ('cover', 'logo') then   -- one current cover/logo: the new one replaces it
    update public.business_media set state = 'removed'
     where business_id = p_business_id and kind = p_kind and state = 'approved';
  end if;
  if p_kind = 'staff_photo' then
    update public.business_media set state = 'removed'
     where business_id = p_business_id and kind = 'staff_photo' and staff_id = p_staff_id and state = 'approved';
  end if;

  insert into public.business_media (business_id, media_asset_id, kind, staff_id, caption, sort)
  values (p_business_id, v_asset, p_kind, case when p_kind = 'staff_photo' then p_staff_id end, left(p_caption, 200),
          coalesce((select max(sort) + 1 from public.business_media where business_id = p_business_id and kind = p_kind), 0))
  returning id into v_media;

  if p_kind = 'staff_photo' then
    update public.staff_members set photo_media_id = v_media where id = p_staff_id;
  end if;
  return jsonb_build_object('media_id', v_media, 'path', p_path);
exception when unique_violation then
  perform private.raise_code('INVALID_PATH', '{"reason":"already_registered"}');
  return null;   -- not reached
end $$;

create function public.remove_business_media(p_media_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare m public.business_media; v_path text;
begin
  select * into m from public.business_media where id = p_media_id for update;
  if m.id is null or not private.has_business_role(m.business_id, '{owner,manager,reception}') then
    perform private.raise_code('FORBIDDEN');
  end if;
  update public.business_media set state = 'removed' where id = m.id;
  update public.media_assets set status = 'removed' where id = m.media_asset_id returning private_path into v_path;
  update public.staff_members set photo_media_id = null where photo_media_id = m.id;
  return v_path;   -- the client deletes the storage object (member delete policy)
end $$;

create function public.reorder_business_media(p_business_id uuid, p_media_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.has_business_role(p_business_id, '{owner,manager,reception}') then perform private.raise_code('FORBIDDEN'); end if;
  update public.business_media m set sort = x.ord - 1
  from unnest(p_media_ids) with ordinality as x(id, ord)
  where m.id = x.id and m.business_id = p_business_id;
end $$;

grant execute on function public.register_business_media(uuid, text, public.business_media_kind, text, int, int, int, uuid, text) to authenticated;
grant execute on function public.remove_business_media(uuid)            to authenticated;
grant execute on function public.reorder_business_media(uuid, uuid[])   to authenticated;

-- ─── Storage bucket + policies (Part 6 storage table) ──────────────────────
-- Skipped where the storage schema isn't present (e.g. CI's Postgres-only job).
do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; business-media bucket not created';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('business-media', 'business-media', true, 12582912,
          array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists business_media_write on storage.objects;
  drop policy if exists business_media_member_select on storage.objects;
  drop policy if exists business_media_member_delete on storage.objects;
  create policy business_media_write on storage.objects for insert to authenticated
    with check (bucket_id = 'business-media'
                and (storage.foldername(name))[1] in (select id::text from private.my_business_ids('{owner,manager,reception}') as t(id)));
  create policy business_media_member_select on storage.objects for select to authenticated
    using (bucket_id = 'business-media'
           and (storage.foldername(name))[1] in (select id::text from private.my_business_ids() as t(id)));
  create policy business_media_member_delete on storage.objects for delete to authenticated
    using (bucket_id = 'business-media'
           and (storage.foldername(name))[1] in (select id::text from private.my_business_ids('{owner,manager,reception}') as t(id)));
end
$do$;

select private.assign_app_ownership();
