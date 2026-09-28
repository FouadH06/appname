// Phase 4 Spike S4 / Gate A — availability and hold latency on a realistic business:
// 8 staff, ~1,900 existing bookings over 60 days. Targets (Gate A, staging): p95 get_available_slots
// (14 days, Any) < 150 ms · p95 create_hold < 100 ms, measured as database time (see below).
// The assertions use ceilings with headroom for slower CI runners that still catch real regressions
// (the inlined-CTE bug found in M3 took get_available_slots to 7.3 s).
import { afterAll, describe, expect, it } from 'vitest';
import { asUser, percentile, pool, resetRateLimits, sql } from './db';
import { createFixture, slotAt } from './fixture';

const SAMPLES = Number(process.env.PERF_SAMPLES ?? 50);

afterAll(async () => {
  await pool.end();
});

describe('performance (Spike S4)', () => {
  it(`p95 over ${SAMPLES} samples`, async () => {
    const f = await createFixture({ staff: 8, customers: SAMPLES });
    // Realistic load: every staff member has four 30-min bookings a day for the next 60 days,
    // leaving plenty of gaps (business open 24 h in the fixture; bookings at 09/11/14/16 local).
    await sql(
      `with slots as (
         select s.staff_id, d, h
         from unnest($1::uuid[]) as s(staff_id)
         cross join generate_series(1, 60) d
         cross join unnest(array[9, 11, 14, 16]) h
       ), cust as (
         insert into public.business_customers (business_id, display_name, acquired_via)
         values ($2, 'Perf customer', 'manual') returning id
       ), b as (
         insert into public.bookings (business_id, location_id, business_customer_id, status, source, starts_at, ends_at,
                                      created_by_kind, confirmed_at)
         select $2, $3, (select id from cust), 'confirmed', 'manual',
                (((now() at time zone 'Asia/Beirut')::date + d)::timestamp + make_interval(hours => h)) at time zone 'Asia/Beirut',
                (((now() at time zone 'Asia/Beirut')::date + d)::timestamp + make_interval(hours => h, mins => 30)) at time zone 'Asia/Beirut',
                'business', now()
         from slots
         returning id, starts_at, ends_at
       )
       select count(*) from b`,
      [f.staff, f.businessId, f.locationId],
    );
    // attach one item per booking, spread across staff (bookings were created staff-major)
    await sql(
      `insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id,
                                         selection_mode, starts_at, ends_at, occupied, duration_min, price_type, price_min)
       select b.id, b.business_id, b.location_id, $2, (select canonical_service_id from public.services where id = $2),
              ($3::uuid[])[1 + ((row_number() over (partition by b.starts_at order by b.id))::int - 1) % array_length($3::uuid[], 1)],
              'business', b.starts_at, b.ends_at, tstzrange(b.starts_at, b.ends_at, '[)'), 30, 'fixed', 15
       from public.bookings b where b.business_id = $1`,
      [f.businessId, f.serviceId, f.staff],
    );
    const [{ n }] = (await sql<{ n: number }>(
      `select count(*)::int as n from public.booking_items where business_id = $1`,
      [f.businessId],
    )) as [{ n: number }];

    // Each sample records the database time (EXPLAIN ANALYZE: planning + execution, what Gate A
    // measures) and the client round trip (begin → claims → call → commit). On Docker Desktop the
    // round trip carries port-proxy noise that is not the engine, so Gate A ceilings apply to db time.
    const timed = async (userId: string, call: string, params: unknown[]) => {
      const t0 = performance.now();
      const r = await asUser<{
        'QUERY PLAN': [{ 'Planning Time': number; 'Execution Time': number }];
      }>(userId, `explain (analyze, timing off, format json) ${call}`, params);
      const roundTrip = performance.now() - t0;
      expect(r.ok, r.ok ? '' : r.message).toBe(true);
      const plan = r.ok
        ? r.value[0]!['QUERY PLAN'][0]
        : { 'Planning Time': 0, 'Execution Time': 0 };
      return { db: plan['Planning Time'] + plan['Execution Time'], roundTrip };
    };

    const slotDb: number[] = [];
    const slotTrip: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t = await timed(
        f.customers[i]!,
        `select count(*) from public.get_available_slots($1, $2, null, current_date + 1, current_date + 14)`,
        [f.locationId, f.serviceId],
      );
      slotDb.push(t.db);
      slotTrip.push(t.roundTrip);
    }

    await resetRateLimits();
    const holdDb: number[] = [];
    const holdTrip: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const start = await slotAt(1 + (i % 50), '12:00');
      const t = await timed(f.customers[i]!, `select * from public.create_hold($1, $2, $3)`, [
        f.locationId,
        f.serviceId,
        start,
      ]);
      holdDb.push(t.db);
      holdTrip.push(t.roundTrip);
    }
    const [{ held }] = (await sql<{ held: number }>(
      `select count(*)::int as held from public.bookings where business_id = $1 and status = 'held'`,
      [f.businessId],
    )) as [{ held: number }];

    const stats = (xs: number[]) => ({
      p50: percentile(xs, 50).toFixed(1),
      p95: percentile(xs, 95).toFixed(1),
      max: Math.max(...xs).toFixed(1),
    });
    const report = {
      existing_booking_items: n,
      total_booking_items: (
        await sql<{ n: number }>(`select count(*)::int as n from public.booking_items`)
      )[0]?.n,
      get_available_slots_14d_any_ms: { db: stats(slotDb), round_trip: stats(slotTrip) },
      create_hold_any_ms: { db: stats(holdDb), round_trip: stats(holdTrip) },
    };
    console.info('PERF', JSON.stringify(report));
    expect(n).toBeGreaterThan(1800);
    expect(held).toBe(SAMPLES); // every sampled hold really was created
    // Gate A targets (150 / 100 ms) with headroom for slower CI runners; round trip only catches disasters.
    expect(percentile(slotDb, 95)).toBeLessThan(300);
    expect(percentile(holdDb, 95)).toBeLessThan(150);
    expect(percentile(slotTrip, 95)).toBeLessThan(1500);
    expect(percentile(holdTrip, 95)).toBeLessThan(1500);
  });
});
