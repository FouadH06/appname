import { randomInt, randomUUID } from 'node:crypto';
import { sql } from './db';

export interface Fixture {
  businessId: string;
  locationId: string;
  serviceId: string;
  ownerId: string;
  staff: string[];
  customers: string[];
}

// Lebanese-style mobile (961 7x xxx xxx), GoTrue format (no '+'). Phones are unique, so retry on clash.
function randomPhone(): string {
  return `9617${randomInt(0, 10_000_000).toString().padStart(7, '0')}`;
}

async function newUser(withPhone: boolean): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomUUID();
    const phone = withPhone ? randomPhone() : null;
    try {
      await sql(
        `insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
         values ($1, 'authenticated', 'authenticated', $2, case when $2::text is not null then now() end, now(), now())`,
        [id, phone],
      );
      return id;
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
    }
  }
  throw new Error('could not create a user with a unique phone');
}

/**
 * A live business open around the clock: N staff who all perform one 30-minute service,
 * no minimum notice, 60-day horizon, 15-minute grid. Committed data (disposable DB only).
 */
export async function createFixture(opts: {
  staff: number;
  customers: number;
  serviceMinutes?: number;
}): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8);
  const ownerId = await newUser(false);

  const [biz] = await sql<{ id: string }>(
    `insert into public.businesses (slug, name, primary_category_id, status)
     select $1, 'Concurrency ' || $2, id, 'live' from public.categories where slug = 'barber' returning id`,
    [`ct-${tag}`, tag],
  );
  const businessId = biz!.id;
  await sql(
    `insert into public.business_members (business_id, user_id, role) values ($1, $2, 'owner')`,
    [businessId, ownerId],
  );
  await sql(
    `update public.business_settings set min_notice_minutes = 0, max_advance_days = 60, slot_interval_minutes = 15,
            max_active_bookings_per_customer = 20
     where business_id = $1`,
    [businessId],
  );
  const [loc] = await sql<{ id: string }>(
    `insert into public.business_locations (business_id, area_id, geo, status)
     select $1, id, centroid, 'live' from public.areas where slug = 'hazmieh' returning id`,
    [businessId],
  );
  const locationId = loc!.id;
  await sql(
    `insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
     select $1, $2, d, 0, 1440 from generate_series(1, 7) d`,
    [locationId, businessId],
  );
  const [svc] = await sql<{ id: string }>(
    `insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
     select $1, id, 'Haircut', 'fixed', 15, $2 from public.canonical_services where slug = 'mens-haircut' returning id`,
    [businessId, opts.serviceMinutes ?? 30],
  );
  const serviceId = svc!.id;

  const staff: string[] = [];
  for (let i = 0; i < opts.staff; i++) {
    const [s] = await sql<{ id: string }>(
      `insert into public.staff_members (business_id, display_name, slug) values ($1, $2, $3) returning id`,
      [businessId, `Staff ${i}`, `staff-${i}`],
    );
    const staffId = s!.id;
    staff.push(staffId);
    await sql(
      `insert into public.staff_locations (staff_id, location_id, business_id) values ($1, $2, $3)`,
      [staffId, locationId, businessId],
    );
    await sql(
      `insert into public.staff_services (staff_id, service_id, business_id) values ($1, $2, $3)`,
      [staffId, serviceId, businessId],
    );
    await sql(
      `insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
       select $1, $2, $3, d, 0, 1440, current_date - 1 from generate_series(1, 7) d`,
      [staffId, locationId, businessId],
    );
  }

  const customers: string[] = [];
  for (let i = 0; i < opts.customers; i++) customers.push(await newUser(true));

  return { businessId, locationId, serviceId, ownerId, staff, customers };
}

/** A grid-aligned slot `dayOffset` days ahead at hh:mm Beirut time. */
export async function slotAt(dayOffset: number, hhmm: string): Promise<string> {
  const [r] = await sql<{ t: string }>(
    `select (((now() at time zone 'Asia/Beirut')::date + $1::int)::timestamp + $2::time) at time zone 'Asia/Beirut' as t`,
    [dayOffset, hhmm],
  );
  return new Date(r!.t).toISOString();
}
