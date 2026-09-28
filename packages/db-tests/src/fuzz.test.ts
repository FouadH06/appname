// Phase 3 Part 7 §4 #25 — randomized operations through the real RPCs, 4 workers in parallel.
// Invariant after every batch: no two time-blocking items of one staff member overlap, and no RPC ever
// leaks a raw constraint error (every conflict must surface as a stable P0001 code).
// FUZZ_OPS (default 10000) × FUZZ_SEEDS (default 5). M3 DoD: 0 overlaps across 10k ops × 5 seeds.
import { afterAll, describe, expect, it } from 'vitest';
import { asUser, overlapCount, pool, resetRateLimits, rng, sql } from './db';
import { createFixture, type Fixture } from './fixture';

const OPS = Number(process.env.FUZZ_OPS ?? 10_000);
const SEEDS = (process.env.FUZZ_SEEDS ?? '1,2,3,4,5').split(',').map(Number);
const WORKERS = 4;
const CHECK_EVERY = 250;

// Business-rule outcomes that are expected under random load
const EXPECTED = new Set([
  'SLOT_TAKEN',
  'STAFF_NOT_FREE',
  'INVALID_SLOT',
  'HOLD_NOT_FOUND',
  'HOLD_EXPIRED',
  'TRANSITION_NOT_ALLOWED',
  'OUTSIDE_WINDOW',
  'OUTSIDE_HOURS',
  'NOT_BOOKABLE',
  'TOO_MANY_ACTIVE_BOOKINGS',
  'OVERLAP_SAME_BUSINESS',
  'REASON_REQUIRED',
  'FORBIDDEN',
  'RATE_LIMITED',
]);

afterAll(async () => {
  await pool.end();
});

interface Hold {
  customer: string;
  bookingId: string;
  token: string;
}

async function worker(
  f: Fixture,
  rand: () => number,
  ops: number,
  holds: Hold[],
  bookings: string[],
  stats: Record<string, number>,
  unexpected: string[],
): Promise<void> {
  const pick = <T>(xs: T[]): T | undefined =>
    xs.length ? xs[Math.floor(rand() * xs.length)] : undefined;
  const randomSlot = async () => {
    const day = 1 + Math.floor(rand() * 14);
    const minute = Math.floor(rand() * 96) * 15; // anywhere on the 15-min grid
    const [r] = await sql<{ t: string }>(
      `select (((now() at time zone 'Asia/Beirut')::date + $1::int)::timestamp + make_interval(mins => $2)) at time zone 'Asia/Beirut' as t`,
      [day, minute],
    );
    return new Date(r!.t).toISOString();
  };

  for (let i = 0; i < ops; i++) {
    const roll = rand();
    let op: string;
    let res;
    if (roll < 0.3) {
      op = 'hold';
      const c = pick(f.customers)!;
      const staff = rand() < 0.5 ? null : pick(f.staff)!;
      res = await asUser<{ booking_id: string; hold_token: string }>(
        c,
        `select * from public.create_hold($1, $2, $3, $4)`,
        [f.locationId, f.serviceId, await randomSlot(), staff],
      );
      if (res.ok)
        holds.push({
          customer: c,
          bookingId: res.value[0]!.booking_id,
          token: res.value[0]!.hold_token,
        });
    } else if (roll < 0.5) {
      op = 'confirm';
      const h = holds.splice(Math.floor(rand() * holds.length), 1)[0];
      if (!h) continue;
      res = await asUser<{ id: string }>(
        h.customer,
        `select (public.confirm_booking($1, $2, 'Fuzz')).id`,
        [h.bookingId, h.token],
      );
      if (res.ok) bookings.push(res.value[0]!.id);
    } else if (roll < 0.62) {
      op = 'manual';
      const staff = rand() < 0.5 ? null : pick(f.staff)!;
      res = await asUser<{ id: string }>(
        f.ownerId,
        `select (public.create_manual_booking($1, '{"phone":"+96170999999","name":"Fuzz walk-in"}', $2, $3, $4, null, null, null, false, $5)).id`,
        [f.locationId, f.serviceId, staff, await randomSlot(), rand() < 0.2],
      );
      if (res.ok) bookings.push(res.value[0]!.id);
    } else if (roll < 0.74) {
      op = 'reschedule';
      const b = pick(bookings);
      if (!b) continue;
      res = await asUser(f.ownerId, `select * from public.biz_reschedule_booking($1, $2, $3)`, [
        b,
        await randomSlot(),
        rand() < 0.5 ? null : pick(f.staff)!,
      ]);
    } else if (roll < 0.82) {
      op = 'reassign';
      const b = pick(bookings);
      if (!b) continue;
      res = await asUser(
        f.ownerId,
        `select * from public.reassign_booking_item((select id from public.booking_items where booking_id = $1), $2)`,
        [b, pick(f.staff)!],
      );
    } else if (roll < 0.9) {
      op = 'cancel';
      const b = pick(bookings);
      if (!b) continue;
      res = await asUser(f.ownerId, `select * from public.biz_cancel_booking($1, 'fuzz')`, [b]);
    } else if (roll < 0.96) {
      op = 'release';
      const h = holds.splice(Math.floor(rand() * holds.length), 1)[0];
      if (!h) continue;
      res = await asUser(h.customer, `select public.release_hold($1, $2)`, [h.bookingId, h.token]);
    } else {
      // expire a hold and run the cleanup job, as pg_cron would
      await sql(
        `update public.bookings set expires_at = now() - interval '5 minutes' where status = 'held' and business_id = $1
                 and id = (select id from public.bookings where status = 'held' and business_id = $1 limit 1)`,
        [f.businessId],
      );
      await sql('select private.job_expire_holds()');
      continue;
    }
    const key = `${op}:${res.ok ? 'ok' : res.code}`;
    stats[key] = (stats[key] ?? 0) + 1;
    if (!res.ok && !EXPECTED.has(res.code))
      unexpected.push(`${op} → ${res.sqlstate} ${res.message}`);
  }
}

describe(`fuzz: ${OPS} ops × seeds [${SEEDS.join(',')}], ${WORKERS} parallel workers`, () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: zero overlaps, zero unexpected errors`, async () => {
      const f = await createFixture({ staff: 4, customers: 30 });
      const holds: Hold[] = [];
      const bookings: string[] = [];
      const stats: Record<string, number> = {};
      const unexpected: string[] = [];
      let done = 0;
      while (done < OPS) {
        const batch = Math.min(CHECK_EVERY, OPS - done);
        await resetRateLimits();
        await Promise.all(
          Array.from({ length: WORKERS }, (_, w) =>
            worker(
              f,
              rng(seed * 1000 + done + w),
              Math.ceil(batch / WORKERS),
              holds,
              bookings,
              stats,
              unexpected,
            ),
          ),
        );
        done += batch;
        expect(await overlapCount(f.businessId), `overlap after ${done} ops`).toBe(0);
      }
      const [counts] = await sql<{ items: number; nulls: number; blocking: number }>(
        `select count(*)::int as items, count(*) filter (where staff_id is null)::int as nulls,
                count(*) filter (where blocks_time)::int as blocking
           from public.booking_items where business_id = $1`,
        [f.businessId],
      );
      console.log(`seed ${seed}:`, JSON.stringify({ ...counts, stats }));
      expect(unexpected.slice(0, 10)).toEqual([]);
      expect(counts!.nulls).toBe(0);
      expect(counts!.blocking).toBeGreaterThan(0);
    });
  }
});
