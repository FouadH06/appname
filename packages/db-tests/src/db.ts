import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// These tests commit data. Never point them at staging or production.
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error(`db-tests refuse to run against non-local host "${host}"`);
}

export const pool = new pg.Pool({ connectionString: url, max: 40 });

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export interface RpcOk<T> {
  ok: true;
  value: T;
}
export interface RpcErr {
  ok: false;
  code: string; // P0001 stable code (message) or SQLSTATE for anything unexpected
  sqlstate: string;
  message: string;
}
export type RpcResult<T> = RpcOk<T> | RpcErr;

/** Run one statement as a signed-in user (JWT claims + authenticated role), in its own transaction. */
export async function asUser<T extends pg.QueryResultRow>(
  userId: string,
  text: string,
  params: unknown[] = [],
): Promise<RpcResult<T[]>> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated', aal: 'aal1', is_anonymous: false }),
    ]);
    await client.query('set local role authenticated');
    const res = await client.query<T>(text, params);
    await client.query('commit');
    return { ok: true, value: res.rows };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    const e = error as { code?: string; message?: string };
    const sqlstate = e.code ?? 'XXXXX';
    return {
      ok: false,
      sqlstate,
      code: sqlstate === 'P0001' ? (e.message ?? '') : sqlstate,
      message: e.message ?? String(error),
    };
  } finally {
    client.release();
  }
}

/** Deterministic PRNG (mulberry32) so fuzz runs are reproducible from a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pairs of time-blocking items for the same staff member that overlap. Must always be 0. */
export async function overlapCount(businessId: string): Promise<number> {
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n
       from public.booking_items a
       join public.booking_items b on a.staff_id = b.staff_id and a.id < b.id
      where a.business_id = $1 and a.blocks_time and b.blocks_time
        and not a.allow_overlap and not b.allow_overlap and a.occupied && b.occupied`,
    [businessId],
  );
  return rows[0]?.n ?? -1;
}

/** The harness tests races, not the rate limiter (covered by pgTAP): clear windows between runs. */
export async function resetRateLimits(): Promise<void> {
  await sql('delete from private.rate_limits');
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? NaN;
}
