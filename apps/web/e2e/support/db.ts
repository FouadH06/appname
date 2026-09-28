import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

// Fixtures for the auth e2e tests. They COMMIT data, so they only run against a local stack.
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
  throw new Error('e2e fixtures refuse to run against a non-local database');
}

// One pool per worker, recreated if a spec file closed it (spec files share workers)
let current: pg.Pool | null = null;
const db = (): pg.Pool => (current ??= new pg.Pool({ connectionString: url, max: 4 }));

async function one<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T> {
  const r = await db().query<T>(text, params);
  if (!r.rows[0]) throw new Error(`no row: ${text.slice(0, 60)}`);
  return r.rows[0];
}

export interface TestBusiness {
  businessId: string;
  locationId: string;
  serviceId: string;
  staffId: string;
  ownerId: string;
  name: string;
}

/** A live barber open around the clock, one staff member working all day, no minimum notice. */
export async function createBusiness(label: string): Promise<TestBusiness> {
  const tag = randomUUID().slice(0, 8);
  const name = `${label} ${tag}`;
  const owner = await one<{ id: string }>(
    `insert into auth.users (id, aud, role, created_at, updated_at)
     values (gen_random_uuid(), 'authenticated', 'authenticated', now(), now()) returning id`,
  );
  const biz = await one<{ id: string }>(
    `insert into public.businesses (slug, name, primary_category_id, status)
     select $1, $2, id, 'live' from public.categories where slug = 'barber' returning id`,
    [`e2e-${tag}`, name],
  );
  await db().query(
    `insert into public.business_members (business_id, user_id, role) values ($1, $2, 'owner')`,
    [biz.id, owner.id],
  );
  await db().query(
    `update public.business_settings set min_notice_minutes = 0 where business_id = $1`,
    [biz.id],
  );
  const loc = await one<{ id: string }>(
    `insert into public.business_locations (business_id, area_id, address_line, geo, status)
     select $1, id, 'Main street', centroid, 'live' from public.areas where slug = 'hazmieh' returning id`,
    [biz.id],
  );
  await db().query(
    `insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
     select $1, $2, d, 0, 1440 from generate_series(1, 7) d`,
    [loc.id, biz.id],
  );
  const svc = await one<{ id: string }>(
    `insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
     select $1, id, 'Haircut', 'fixed', 15, 30 from public.canonical_services where slug = 'mens-haircut' returning id`,
    [biz.id],
  );
  const staff = await one<{ id: string }>(
    `insert into public.staff_members (business_id, display_name, slug) values ($1, 'Karim Test', 'karim') returning id`,
    [biz.id],
  );
  await db().query(
    `insert into public.staff_locations (staff_id, location_id, business_id) values ($1, $2, $3)`,
    [staff.id, loc.id, biz.id],
  );
  await db().query(
    `insert into public.staff_services (staff_id, service_id, business_id) values ($1, $2, $3)`,
    [staff.id, svc.id, biz.id],
  );
  await db().query(
    `insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
     select $1, $2, $3, d, 0, 1440, current_date - 1 from generate_series(1, 7) d`,
    [staff.id, loc.id, biz.id],
  );
  return {
    businessId: biz.id,
    locationId: loc.id,
    serviceId: svc.id,
    staffId: staff.id,
    ownerId: owner.id,
    name,
  };
}

/** A pending team invitation; returns the raw token (the one that goes in the WhatsApp link). */
export async function createInvite(
  b: TestBusiness,
  phoneE164: string,
  role: 'manager' | 'reception' | 'staff',
) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await db().query(
    `insert into private.business_invitations (business_id, phone_e164, role, token_hash, expires_at, created_by)
     values ($1, $2, $3, $4, now() + interval '7 days', $5)`,
    [b.businessId, phoneE164, role, hash, b.ownerId],
  );
  return token;
}

/** A completed visit on the business's shadow record for a phone; returns the booking id. */
export async function createShadowVisit(
  b: TestBusiness,
  phoneE164: string,
  daysAgo: number,
): Promise<string> {
  const rec = await one<{ id: string }>(
    `insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
     values ($1, $2, 'Walk-in customer', 'manual')
     on conflict (business_id, phone_e164) where user_id is null and phone_e164 is not null and archived_at is null
     do update set display_name = excluded.display_name
     returning id`,
    [b.businessId, phoneE164],
  );
  const bk = await one<{ id: string }>(
    `with s as (select now() - make_interval(days => $3) as t)
     insert into public.bookings (business_id, location_id, business_customer_id, status, source, starts_at, ends_at,
                                  created_by_kind, confirmed_at, completed_at)
     select $1, $2, $4, 'completed', 'manual', s.t, s.t + interval '30 minutes', 'business', now(), s.t + interval '30 minutes'
     from s returning id`,
    [b.businessId, b.locationId, daysAgo, rec.id],
  );
  await db().query(
    `insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id,
                                       selection_mode, starts_at, ends_at, occupied, duration_min, price_type, price_min)
     select b.id, b.business_id, b.location_id, s.id, s.canonical_service_id, $3, 'business', b.starts_at, b.ends_at,
            tstzrange(b.starts_at, b.ends_at, '[)'), 30, 'fixed', 15
     from public.bookings b, public.services s where b.id = $1 and s.id = $2`,
    [bk.id, b.serviceId, b.staffId],
  );
  return bk.id;
}

export async function issueClaimToken(bookingId: string): Promise<string> {
  const r = await one<{ t: string }>(`select private.issue_access_token('claim_visit', $1) as t`, [
    bookingId,
  ]);
  return r.t;
}

/**
 * M5: a draft business as ops creates it (draft business + draft location, no hours/services yet)
 * with a pending owner invitation. Returns the business ids and the raw invite token.
 */
export async function createDraftBusiness(label: string, ownerPhone: string) {
  const tag = randomUUID().slice(0, 8);
  const name = `${label} ${tag}`;
  const slug = `e2e-draft-${tag}`;
  const ops = await one<{ id: string }>(
    `insert into auth.users (id, aud, role, created_at, updated_at)
     values (gen_random_uuid(), 'authenticated', 'authenticated', now(), now()) returning id`,
  );
  const biz = await one<{ id: string }>(
    `insert into public.businesses (slug, name, primary_category_id, status, created_by)
     select $1, $2, id, 'draft', $3 from public.categories where slug = 'barber' returning id`,
    [slug, name, ops.id],
  );
  const loc = await one<{ id: string }>(
    `insert into public.business_locations (business_id, area_id, address_line, geo, status)
     select $1, id, 'Main street', centroid, 'draft' from public.areas where slug = 'hazmieh' returning id`,
    [biz.id],
  );
  const token = randomBytes(32).toString('base64url');
  await db().query(
    `insert into private.business_invitations (business_id, phone_e164, role, token_hash, expires_at, created_by)
     values ($1, $2, 'owner', $3, now() + interval '7 days', $4)`,
    [biz.id, ownerPhone, createHash('sha256').update(token).digest('hex'), ops.id],
  );
  return { businessId: biz.id, locationId: loc.id, name, slug, token };
}

export async function addMemberByPhone(
  businessId: string,
  phoneDigits: string,
  role: 'manager' | 'reception' | 'staff',
) {
  await db().query(
    `insert into public.business_members (business_id, user_id, role)
     select $1, id, $3 from auth.users where phone = $2
     on conflict (business_id, user_id) do update set role = excluded.role, status = 'active'`,
    [businessId, phoneDigits, role],
  );
}

/** Blank a user's profile name (reruns start like a brand-new owner). */
export async function clearProfileName(phoneDigits: string) {
  await db().query(
    `update public.profiles set first_name = null, last_name = null
     where id = (select id from auth.users where phone = $1)`,
    [phoneDigits],
  );
}

/** Public availability (as a logged-out visitor) for a Beirut date, as local "HH:MM" strings. */
export async function publicSlots(
  locationId: string,
  serviceId: string,
  beirutDate: string,
): Promise<string[]> {
  const client = await db().connect();
  try {
    await client.query('begin');
    await client.query(`set local role anon`);
    const r = await client.query<{ t: string }>(
      `select to_char(slot_start at time zone 'Asia/Beirut', 'HH24:MI') as t
       from public.get_available_slots($1, $2, null, $3::date, $3::date) order by slot_start`,
      [locationId, serviceId, beirutDate],
    );
    await client.query('commit');
    return r.rows.map((x) => x.t);
  } finally {
    client.release();
  }
}

export async function firstService(businessId: string): Promise<string> {
  return (
    await one<{ id: string }>(
      `select id from public.services where business_id = $1 order by created_at limit 1`,
      [businessId],
    )
  ).id;
}

export async function businessStatus(
  businessId: string,
): Promise<{ status: string; location: string }> {
  return one(
    `select b.status::text as status, l.status::text as location
     from public.businesses b join public.business_locations l on l.business_id = b.id where b.id = $1`,
    [businessId],
  );
}

/** Beirut date n days from now (YYYY-MM-DD). */
export async function beirutDate(offset: number): Promise<string> {
  return (
    await one<{ d: string }>(
      `select ((now() at time zone 'Asia/Beirut')::date + $1::int)::text as d`,
      [offset],
    )
  ).d;
}

export async function closePool(): Promise<void> {
  const p = current;
  current = null;
  await p?.end();
}

// ─── M6 calendar fixtures ─────────────────────────────────────────────────
export interface CalendarBusiness extends TestBusiness {
  mayaId: string;
  beardId: string;
  linaId: string;
}

/** Beirut instant for a day offset and wall time ("10:00"). */
export async function beirutAt(offset: number, hhmm: string): Promise<string> {
  return (
    await one<{ t: string }>(
      `select ((((now() at time zone 'Asia/Beirut')::date + $1::int)::timestamp + $2::time) at time zone 'Asia/Beirut')::text as t`,
      [offset, hhmm],
    )
  ).t;
}

/**
 * Two staff working 09:00–19:00 (Karim, Maya), Haircut + Beard trim, and a regular customer
 * (Lina Khoury, +96171555111) with one completed Haircut with Karim.
 */
export async function createCalendarBusiness(label: string): Promise<CalendarBusiness> {
  const b = await createBusiness(label);
  await db().query(
    `update public.staff_weekly_hours set start_minute = 540, end_minute = 1140 where staff_id = $1`,
    [b.staffId],
  );
  const maya = await one<{ id: string }>(
    `insert into public.staff_members (business_id, display_name, slug) values ($1, 'Maya Test', 'maya') returning id`,
    [b.businessId],
  );
  await db().query(
    `insert into public.staff_locations (staff_id, location_id, business_id) values ($1, $2, $3)`,
    [maya.id, b.locationId, b.businessId],
  );
  await db().query(
    `insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
     select $1, $2, $3, d, 540, 1140, current_date - 1 from generate_series(1, 7) d`,
    [maya.id, b.locationId, b.businessId],
  );
  const beard = await one<{ id: string }>(
    `insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
     select $1, id, 'Beard trim', 'fixed', 10, 20 from public.canonical_services where slug = 'mens-haircut' returning id`,
    [b.businessId],
  );
  await db().query(
    `insert into public.staff_services (staff_id, service_id, business_id)
     values ($1, $3, $4), ($2, $3, $4), ($2, $5, $4), ($1, $5, $4)
     on conflict do nothing`,
    [maya.id, b.staffId, b.serviceId, b.businessId, beard.id],
  );
  const lina = await one<{ id: string }>(
    `insert into public.business_customers (business_id, phone_e164, display_name, acquired_via)
     values ($1, '+96171555111', 'Lina Khoury', 'manual') returning id`,
    [b.businessId],
  );
  await addBooking(b, b.staffId, b.serviceId, lina.id, await beirutAt(-10, '10:00'), 'completed');
  await db().query(`select private.recompute_business_customer_stats($1)`, [lina.id]);
  return { ...b, mayaId: maya.id, beardId: beard.id, linaId: lina.id };
}

/** A booking written directly (confirmed by default); returns its id. */
export async function addBooking(
  b: TestBusiness,
  staffId: string,
  serviceId: string,
  customerId: string | null,
  startIso: string,
  status: 'confirmed' | 'completed' = 'confirmed',
): Promise<string> {
  const bk = await one<{ id: string }>(
    `insert into public.bookings (business_id, location_id, business_customer_id, status, source, starts_at, ends_at,
                                  created_by_kind, confirmed_at, completed_at, total_price_min, total_price_max)
     select $1, $2, $3, $4::public.booking_status, case when $3::uuid is null then 'walk_in' else 'manual' end::public.booking_source,
            $5::timestamptz, $5::timestamptz + make_interval(mins => s.duration_min), 'business', now(),
            case when $4 = 'completed' then $5::timestamptz + make_interval(mins => s.duration_min) end, s.price_min, s.price_min
     from public.services s where s.id = $6 returning id`,
    [b.businessId, b.locationId, customerId, status, startIso, serviceId],
  );
  await db().query(
    `insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id,
                                       selection_mode, starts_at, ends_at, occupied, duration_min, price_type, price_min)
     select bk.id, bk.business_id, bk.location_id, s.id, s.canonical_service_id, $3, 'business', bk.starts_at, bk.ends_at,
            tstzrange(bk.starts_at, bk.ends_at, '[)'), s.duration_min, s.price_type, s.price_min
     from public.bookings bk, public.services s where bk.id = $1 and s.id = $2`,
    [bk.id, serviceId, staffId],
  );
  return bk.id;
}

/** Links a signed-in phone user to a staff profile with the staff role. */
export async function linkStaffUser(businessId: string, staffId: string, phoneDigits: string) {
  await db().query(
    `insert into public.business_members (business_id, user_id, role)
     select $1, id, 'staff' from auth.users where phone = $2
     on conflict (business_id, user_id) do update set role = 'staff', status = 'active'`,
    [businessId, phoneDigits],
  );
  await db().query(
    `update public.staff_members set user_id = (select id from auth.users where phone = $2) where id = $1`,
    [staffId, phoneDigits],
  );
}

export async function bookingRow(
  bookingId: string,
): Promise<{ status: string; staff_id: string; starts_at: string }> {
  return one(
    `select b.status::text as status, bi.staff_id, b.starts_at::text as starts_at
     from public.bookings b join public.booking_items bi on bi.booking_id = b.id where b.id = $1`,
    [bookingId],
  );
}

/** Gate B timing rows recorded for a business (operational fields only). */
export async function creationTimings(
  businessId: string,
): Promise<{ customer_kind: string; flow: string; actor_role: string; duration_ms: number }[]> {
  const r = await db().query(
    `select customer_kind, flow, actor_role::text as actor_role, duration_ms
     from private.booking_creation_timings where business_id = $1 order by saved_at`,
    [businessId],
  );
  return r.rows;
}

// ─── M7 notification fixtures ─────────────────────────────────────────────
export async function latestBooking(businessId: string): Promise<string> {
  return (
    await one<{ id: string }>(
      `select id from public.bookings where business_id = $1 order by created_at desc limit 1`,
      [businessId],
    )
  ).id;
}

export async function notificationsFor(
  bookingId: string,
): Promise<{ type: string; status: string; phone: string; provider: string | null }[]> {
  const r = await db().query(
    `select n.type::text as type, n.status::text as status, n.recipient_phone as phone,
            (select d.provider from public.notification_deliveries d where d.notification_id = n.id
             order by d.created_at desc limit 1) as provider
     from public.notifications n where n.booking_id = $1 order by n.created_at, n.type`,
    [bookingId],
  );
  return r.rows;
}

export async function confirmedAt(bookingId: string): Promise<string | null> {
  return (
    await one<{ t: string | null }>(
      `select customer_confirmed_at::text as t from public.bookings where id = $1`,
      [bookingId],
    )
  ).t;
}

export async function failCustomerMessages(bookingId: string) {
  await db().query(
    `update public.notifications set status = 'failed', last_error = 'e2e' where booking_id = $1 and recipient_business_id is null`,
    [bookingId],
  );
}

// ─── M8 public booking fixtures ───────────────────────────────────────────
export async function businessSlug(businessId: string): Promise<string> {
  return (
    await one<{ slug: string }>(`select slug::text as slug from public.businesses where id = $1`, [
      businessId,
    ])
  ).slug;
}

export async function setStaffPublic(staffId: string, isPublic: boolean) {
  await db().query(
    `update public.staff_members set publicly_bookable = $2, accepts_any_assignment = $2 where id = $1`,
    [staffId, isPublic],
  );
}

export async function setBookingMode(businessId: string, mode: 'instant' | 'request') {
  await db().query(`update public.business_settings set booking_mode = $2 where business_id = $1`, [
    businessId,
    mode,
  ]);
}

export async function renameSlug(businessId: string, slug: string) {
  await db().query(`update public.businesses set slug = $2 where id = $1`, [businessId, slug]);
}
