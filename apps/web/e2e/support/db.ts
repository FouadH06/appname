import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

// Fixtures for the auth e2e tests. They COMMIT data, so they only run against a local stack.
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
  throw new Error('e2e fixtures refuse to run against a non-local database');
}

const pool = new pg.Pool({ connectionString: url, max: 4 });

async function one<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T> {
  const r = await pool.query<T>(text, params);
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
  await pool.query(
    `insert into public.business_members (business_id, user_id, role) values ($1, $2, 'owner')`,
    [biz.id, owner.id],
  );
  await pool.query(
    `update public.business_settings set min_notice_minutes = 0 where business_id = $1`,
    [biz.id],
  );
  const loc = await one<{ id: string }>(
    `insert into public.business_locations (business_id, area_id, address_line, geo, status)
     select $1, id, 'Main street', centroid, 'live' from public.areas where slug = 'hazmieh' returning id`,
    [biz.id],
  );
  await pool.query(
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
  await pool.query(
    `insert into public.staff_locations (staff_id, location_id, business_id) values ($1, $2, $3)`,
    [staff.id, loc.id, biz.id],
  );
  await pool.query(
    `insert into public.staff_services (staff_id, service_id, business_id) values ($1, $2, $3)`,
    [staff.id, svc.id, biz.id],
  );
  await pool.query(
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
  await pool.query(
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
  await pool.query(
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

export async function closePool(): Promise<void> {
  await pool.end();
}
