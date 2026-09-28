// Phase 3 Part 7 §4 #21–24, #26 — real races over parallel connections.
// CONCURRENCY_RUNS (default 100) repeats each scenario; M3 DoD requires 100/100.
import { afterAll, describe, expect, it } from 'vitest';
import { asUser, overlapCount, pool, resetRateLimits } from './db';
import { createFixture, slotAt } from './fixture';

const RUNS = Number(process.env.CONCURRENCY_RUNS ?? 100);

afterAll(async () => {
  await pool.end();
});

describe(`concurrency (${RUNS} runs per scenario)`, () => {
  it('#21 same slot, one staff member: exactly one of 20 parallel holds wins', async () => {
    const f = await createFixture({ staff: 1, customers: 20 });
    for (let run = 0; run < RUNS; run++) {
      await resetRateLimits();
      const start = await slotAt(
        1 + (run % 50),
        `${String(8 + Math.floor(run / 50)).padStart(2, '0')}:00`,
      );
      const results = await Promise.all(
        f.customers.map((c) =>
          asUser(c, `select * from public.create_hold($1, $2, $3, $4)`, [
            f.locationId,
            f.serviceId,
            start,
            f.staff[0],
          ]),
        ),
      );
      const wins = results.filter((r) => r.ok);
      const losses = results.filter((r) => !r.ok);
      expect(wins).toHaveLength(1);
      for (const l of losses) expect(l.ok ? '' : l.code).toMatch(/^(STAFF_NOT_FREE|SLOT_TAKEN)$/);
    }
    expect(await overlapCount(f.businessId)).toBe(0);
  });

  it('#22 "Any" with N free staff: exactly N of N+5 parallel holds win, each with a different staff member', async () => {
    const N = 3;
    const f = await createFixture({ staff: N, customers: N + 5 });
    for (let run = 0; run < RUNS; run++) {
      await resetRateLimits();
      const start = await slotAt(
        1 + (run % 50),
        `${String(8 + Math.floor(run / 50)).padStart(2, '0')}:15`,
      );
      const results = await Promise.all(
        f.customers.map((c) =>
          asUser<{ staff_id: string }>(c, `select * from public.create_hold($1, $2, $3)`, [
            f.locationId,
            f.serviceId,
            start,
          ]),
        ),
      );
      const wins = results.flatMap((r) => (r.ok ? r.value : []));
      expect(wins).toHaveLength(N);
      expect(new Set(wins.map((w) => w.staff_id)).size).toBe(N);
      for (const r of results) if (!r.ok) expect(r.code).toBe('SLOT_TAKEN');
    }
    expect(await overlapCount(f.businessId)).toBe(0);
  });

  it('#23 manual booking racing an online hold for the same staff/time: at most one blocks the time', async () => {
    const f = await createFixture({ staff: 1, customers: 1 });
    for (let run = 0; run < RUNS; run++) {
      await resetRateLimits();
      const start = await slotAt(
        1 + (run % 50),
        `${String(8 + Math.floor(run / 50)).padStart(2, '0')}:30`,
      );
      const [online, manual] = await Promise.all([
        asUser(f.customers[0]!, `select * from public.create_hold($1, $2, $3, $4)`, [
          f.locationId,
          f.serviceId,
          start,
          f.staff[0],
        ]),
        asUser(
          f.ownerId,
          `select * from public.create_manual_booking($1, '{"phone":"+96170000001","name":"Walk-in"}', $2, $3, $4)`,
          [f.locationId, f.serviceId, f.staff[0], start],
        ),
      ]);
      expect([online.ok, manual.ok].filter(Boolean)).toHaveLength(1);
    }
    expect(await overlapCount(f.businessId)).toBe(0);
  });

  it('#24 two bookings rescheduled into the same free slot at once: one wins', async () => {
    const f = await createFixture({ staff: 1, customers: 1 });
    for (let run = 0; run < RUNS; run++) {
      await resetRateLimits();
      const day = 1 + (run % 50);
      const hour = 8 + Math.floor(run / 50) * 4;
      const mk = async (hhmm: string) => {
        const r = await asUser<{ id: string }>(
          f.ownerId,
          `select (public.create_manual_booking($1, '{"phone":"+96170000002","name":"Resched"}', $2, $3, $4)).id`,
          [f.locationId, f.serviceId, f.staff[0], await slotAt(day, hhmm)],
        );
        if (!r.ok) throw new Error(r.message);
        return r.value[0]!.id;
      };
      const a = await mk(`${String(hour).padStart(2, '0')}:00`);
      const b = await mk(`${String(hour + 1).padStart(2, '0')}:00`);
      const target = await slotAt(day, `${String(hour + 2).padStart(2, '0')}:00`);
      const results = await Promise.all(
        [a, b].map((id) =>
          asUser(f.ownerId, `select * from public.biz_reschedule_booking($1, $2)`, [id, target]),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      for (const r of results) if (!r.ok) expect(r.code).toBe('STAFF_NOT_FREE');
    }
    expect(await overlapCount(f.businessId)).toBe(0);
  });

  it('#26 confirm retried in parallel with the same idempotency key: one booking, same id', async () => {
    // one customer per run: a single customer would (correctly) hit max_active_bookings_per_customer
    const f = await createFixture({ staff: 1, customers: 25 });
    for (let run = 0; run < Math.min(RUNS, 25); run++) {
      await resetRateLimits();
      const c = f.customers[run]!;
      const start = await slotAt(1 + run, '18:00');
      const hold = await asUser<{ booking_id: string; hold_token: string }>(
        c,
        `select * from public.create_hold($1, $2, $3)`,
        [f.locationId, f.serviceId, start],
      );
      if (!hold.ok) throw new Error(hold.message);
      const { booking_id, hold_token } = hold.value[0]!;
      const key = `idem-${run}`;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          asUser<{ id: string }>(
            c,
            `select (public.confirm_booking($1, $2, 'Test', null, null, $3)).id`,
            [booking_id, hold_token, key],
          ),
        ),
      );
      const ids = new Set(results.flatMap((r) => (r.ok ? r.value.map((v) => v.id) : [])));
      expect(ids.size).toBe(1);
      expect([...ids][0]).toBe(booking_id);
    }
  });
});
