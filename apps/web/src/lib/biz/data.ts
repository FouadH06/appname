'use client';

import type { Tables, TablesInsert } from '@app/db';
import { supabase } from '@/lib/supabase';
import { rowsToWeek, weekToRows, type WeekHours } from './time';

// Dashboard reads/writes. Setup tables are written directly under RLS (owner/manager, Part 6 §3.3);
// status fields, slugs, media and customers go through RPCs.

export type Service = Tables<'services'> & { staff_ids: string[]; canonical_name: string };
export type Staff = Tables<'staff_members'>;
export type Canonical = Pick<
  Tables<'canonical_services'>,
  'id' | 'slug' | 'name_en' | 'typical_duration_min' | 'sort' | 'category_id'
>;

export function priceLabel(s: Pick<Tables<'services'>, 'price_type' | 'price_min' | 'price_max'>) {
  if (s.price_type === 'on_consultation') return 'On consultation';
  if (s.price_type === 'from') return `From $${s.price_min}`;
  if (s.price_type === 'range') return `$${s.price_min}–${s.price_max}`;
  return `$${s.price_min}`;
}

/** The whole active catalog (a salon may offer services outside its primary category). */
export async function loadCatalog(): Promise<Canonical[]> {
  const r = await supabase()
    .from('canonical_services')
    .select('id, slug, name_en, typical_duration_min, sort, category_id')
    .eq('is_active', true)
    .order('sort');
  if (r.error) throw r.error;
  return r.data ?? [];
}

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

function one<T>(r: { data: T; error: unknown }): NonNullable<T> {
  if (r.error) throw r.error;
  if (r.data === null || r.data === undefined) throw new Error('NOT_FOUND');
  return r.data as NonNullable<T>;
}

/** Beirut calendar date (YYYY-MM-DD) for effective dates. */
export const beirutToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date());

// ─── Location hours ────────────────────────────────────────────────────────
export async function loadLocationHours(locationId: string): Promise<WeekHours> {
  const rows = check(
    await supabase()
      .from('location_hours')
      .select('iso_weekday, start_minute, end_minute')
      .eq('location_id', locationId),
  );
  return rowsToWeek(rows ?? []);
}

export async function saveLocationHours(businessId: string, locationId: string, week: WeekHours) {
  const c = supabase();
  check(await c.from('location_hours').delete().eq('location_id', locationId));
  const rows = weekToRows(week).map((r) => ({
    ...r,
    location_id: locationId,
    business_id: businessId,
  }));
  if (rows.length) check(await c.from('location_hours').insert(rows));
}

// ─── Catalog & services ────────────────────────────────────────────────────
export async function loadCanonical(categoryId: string): Promise<Canonical[]> {
  return (
    check(
      await supabase()
        .from('canonical_services')
        .select('id, slug, name_en, typical_duration_min, sort, category_id')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('sort'),
    ) ?? []
  );
}

export async function loadServices(businessId: string): Promise<Service[]> {
  const c = supabase();
  const [services, links, canon] = await Promise.all([
    c.from('services').select('*').eq('business_id', businessId).order('sort').order('created_at'),
    c.from('staff_services').select('staff_id, service_id').eq('business_id', businessId),
    c.from('canonical_services').select('id, name_en'),
  ]);
  const names = new Map((check(canon) ?? []).map((x) => [x.id, x.name_en]));
  const byService = new Map<string, string[]>();
  for (const l of check(links) ?? [])
    byService.set(l.service_id, [...(byService.get(l.service_id) ?? []), l.staff_id]);
  return (check(services) ?? []).map((s) => ({
    ...s,
    staff_ids: byService.get(s.id) ?? [],
    canonical_name: names.get(s.canonical_service_id) ?? '',
  }));
}

export type ServiceInput = Pick<
  TablesInsert<'services'>,
  | 'canonical_service_id'
  | 'name'
  | 'description'
  | 'price_type'
  | 'price_min'
  | 'price_max'
  | 'duration_min'
  | 'buffer_before_min'
  | 'buffer_after_min'
  | 'audience'
  | 'is_online_bookable'
>;

export async function saveService(
  businessId: string,
  input: ServiceInput,
  staffIds: string[],
  id?: string,
) {
  const c = supabase();
  let serviceId = id;
  if (id) {
    check(await c.from('services').update(input).eq('id', id));
  } else {
    const row = one(
      await c
        .from('services')
        .insert({ ...input, business_id: businessId })
        .select('id')
        .single(),
    );
    serviceId = row.id;
  }
  if (!serviceId) return;
  const current = (
    check(await c.from('staff_services').select('staff_id').eq('service_id', serviceId)) ?? []
  ).map((r) => r.staff_id);
  const remove = current.filter((s) => !staffIds.includes(s));
  const add = staffIds.filter((s) => !current.includes(s));
  if (remove.length)
    check(
      await c.from('staff_services').delete().eq('service_id', serviceId).in('staff_id', remove),
    );
  if (add.length)
    check(
      await c
        .from('staff_services')
        .insert(
          add.map((staff_id) => ({ staff_id, service_id: serviceId!, business_id: businessId })),
        ),
    );
  return serviceId;
}

/** Services from catalog templates, performed by every active team member (edit later). */
export async function addTemplateServices(
  businessId: string,
  picks: { canonical: Canonical; price: number; duration: number }[],
  staffIds: string[],
) {
  for (const p of picks) {
    await saveService(
      businessId,
      {
        canonical_service_id: p.canonical.id,
        name: p.canonical.name_en,
        price_type: 'fixed',
        price_min: p.price,
        duration_min: p.duration,
      },
      staffIds,
    );
  }
}

/** "Other" mapping: ops reviews the proposed name (Phase 2 B8 errors). */
export async function suggestCatalogEntry(
  businessId: string,
  serviceId: string,
  proposedName: string,
) {
  check(
    await supabase()
      .from('catalog_suggestions')
      .insert({
        business_id: businessId,
        service_id: serviceId,
        proposed_name: proposedName.slice(0, 80),
      }),
  );
}

export async function setServiceStatus(id: string, status: 'active' | 'archived') {
  check(await supabase().from('services').update({ status }).eq('id', id));
}

// ─── Staff ─────────────────────────────────────────────────────────────────
export async function loadStaff(businessId: string): Promise<Staff[]> {
  return (
    check(
      await supabase()
        .from('staff_members')
        .select('*')
        .eq('business_id', businessId)
        .order('status')
        .order('display_order')
        .order('created_at'),
    ) ?? []
  );
}

/** A new team member works at the location, performs the given services, with the given hours. */
export async function createStaff(
  businessId: string,
  locationId: string,
  input: {
    display_name: string;
    role_title?: string | null;
    publicly_bookable: boolean;
    accepts_any_assignment: boolean;
  },
  serviceIds: string[],
  week: WeekHours,
): Promise<string> {
  const c = supabase();
  const slugBase =
    input.display_name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'staff';
  let slug = slugBase;
  for (let i = 2; i < 50; i++) {
    const { count } = await c
      .from('staff_members')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('slug', slug);
    if (!count) break;
    slug = `${slugBase}-${i}`;
  }
  const staff = one(
    await c
      .from('staff_members')
      .insert({ ...input, business_id: businessId, slug })
      .select('id')
      .single(),
  );
  await linkStaff(businessId, locationId, staff.id, serviceIds, week);
  return staff.id;
}

export async function linkStaff(
  businessId: string,
  locationId: string,
  staffId: string,
  serviceIds: string[],
  week: WeekHours,
) {
  const c = supabase();
  const existing = check(
    await c
      .from('staff_locations')
      .select('staff_id')
      .eq('staff_id', staffId)
      .eq('location_id', locationId),
  );
  if (!existing?.length)
    check(
      await c
        .from('staff_locations')
        .insert({ staff_id: staffId, location_id: locationId, business_id: businessId }),
    );
  if (serviceIds.length)
    check(
      await c.from('staff_services').upsert(
        serviceIds.map((service_id) => ({
          staff_id: staffId,
          service_id,
          business_id: businessId,
        })),
        {
          onConflict: 'staff_id,service_id',
          ignoreDuplicates: true,
        },
      ),
    );
  await saveStaffWeek(businessId, locationId, staffId, week);
}

export async function loadStaffWeek(staffId: string, locationId: string): Promise<WeekHours> {
  const today = beirutToday();
  const rows = check(
    await supabase()
      .from('staff_weekly_hours')
      .select('iso_weekday, start_minute, end_minute, effective_from, effective_to')
      .eq('staff_id', staffId)
      .eq('location_id', locationId)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gt.${today}`),
  );
  return rowsToWeek(rows ?? []);
}

/** Replaces the staff member's current weekly hours from today on (history before today is kept). */
export async function saveStaffWeek(
  businessId: string,
  locationId: string,
  staffId: string,
  week: WeekHours,
) {
  const c = supabase();
  const today = beirutToday();
  // rows that started before today end today; rows starting today or later are replaced
  check(
    await c
      .from('staff_weekly_hours')
      .update({ effective_to: today })
      .eq('staff_id', staffId)
      .eq('location_id', locationId)
      .lt('effective_from', today)
      .is('effective_to', null),
  );
  check(
    await c
      .from('staff_weekly_hours')
      .delete()
      .eq('staff_id', staffId)
      .eq('location_id', locationId)
      .gte('effective_from', today),
  );
  const rows = weekToRows(week).map((r) => ({
    ...r,
    staff_id: staffId,
    location_id: locationId,
    business_id: businessId,
    effective_from: today,
  }));
  if (rows.length) check(await c.from('staff_weekly_hours').insert(rows));
}

// ─── Media ─────────────────────────────────────────────────────────────────
export type Media = Tables<'business_media'> & { path: string };

export async function loadMedia(businessId: string): Promise<Media[]> {
  const c = supabase();
  const rows =
    check(
      await c
        .from('business_media')
        .select('*, media_assets(public_path)')
        .eq('business_id', businessId)
        .eq('state', 'approved')
        .order('sort'),
    ) ?? [];
  return rows.map((r) => {
    const { media_assets: asset, ...rest } = r as typeof r & {
      media_assets: { public_path: string | null } | null;
    };
    return { ...rest, path: asset?.public_path ?? '' };
  });
}

export function publicMediaUrl(path: string): string {
  return supabase().storage.from('business-media').getPublicUrl(path).data.publicUrl;
}

/** Downscales large photos in the browser (max 1600 px, WebP) before upload. */
async function prepareImage(
  file: File,
): Promise<{ blob: Blob; mime: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { blob: file, mime: file.type, width: 0, height: 0 };
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
  return blob
    ? { blob, mime: 'image/webp', width, height }
    : { blob: file, mime: file.type, width: bitmap.width, height: bitmap.height };
}

export async function uploadMedia(
  businessId: string,
  file: File,
  kind: 'cover' | 'portfolio' | 'staff_photo',
  staffId?: string,
) {
  const c = supabase();
  const img = await prepareImage(file);
  const ext = img.mime === 'image/webp' ? 'webp' : img.mime === 'image/png' ? 'png' : 'jpg';
  const path = `${businessId}/${kind}-${crypto.randomUUID()}.${ext}`;
  check(
    await c.storage
      .from('business-media')
      .upload(path, img.blob, { contentType: img.mime, upsert: false }),
  );
  const { error } = await c.rpc('register_business_media', {
    p_business_id: businessId,
    p_path: path,
    p_kind: kind,
    p_mime: img.mime,
    p_bytes: img.blob.size,
    p_width: img.width || undefined,
    p_height: img.height || undefined,
    p_staff_id: staffId,
  });
  if (error) {
    await c.storage.from('business-media').remove([path]); // don't leave an orphan file
    throw error;
  }
}

export async function removeMedia(mediaId: string) {
  const c = supabase();
  const { data, error } = await c.rpc('remove_business_media', { p_media_id: mediaId });
  if (error) throw error;
  if (data) await c.storage.from('business-media').remove([data]);
}
