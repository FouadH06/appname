import pg from 'pg';

// App e2e fixtures. They COMMIT data, so they only run against a local stack. Business fixtures are
// shared with the web e2e suite (apps/web/e2e/support/db.ts).
export {
  businessSlug,
  closePool,
  createCalendarBusiness,
  issueClaimToken,
  latestBooking,
  refreshSearch,
  setCancellationWindow,
} from '../../../web/e2e/support/db';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname)) {
  throw new Error('e2e fixtures refuse to run against a non-local database');
}
let pool: pg.Pool | null = null;
const db = () => (pool ??= new pg.Pool({ connectionString: url, max: 2 }));
export const closeAppPool = async () => {
  await pool?.end();
  pool = null;
};

/** The booking happened a few days ago and was completed (feeds "Book again" and reviews). */
export async function completeInPast(bookingId: string, daysAgo = 3) {
  await db().query(
    `with s as (select make_interval(days => $2) as d)
     update public.booking_items set starts_at = starts_at - s.d, ends_at = ends_at - s.d,
       occupied = tstzrange(lower(occupied) - s.d, upper(occupied) - s.d, '[)')
     from s where booking_id = $1`,
    [bookingId, daysAgo],
  );
  await db().query(
    `update public.bookings set status = 'completed', starts_at = starts_at - make_interval(days => $2),
       ends_at = ends_at - make_interval(days => $2), completed_at = ends_at - make_interval(days => $2)
     where id = $1`,
    [bookingId, daysAgo],
  );
}

export async function bookingStatus(bookingId: string): Promise<string> {
  const r = await db().query<{ status: string }>(`select status::text from public.bookings where id = $1`, [bookingId]);
  return r.rows[0]!.status;
}

export async function favoriteCount(businessId: string): Promise<number> {
  const r = await db().query<{ n: number }>(`select count(*)::int as n from public.favorite_businesses where business_id = $1`, [businessId]);
  return r.rows[0]!.n;
}

export async function bookingAttribution(bookingId: string): Promise<{ source: string; channel: string | null }> {
  const r = await db().query<{ source: string; channel: string | null }>(
    `select source::text, attribution ->> 'channel' as channel from public.bookings where id = $1`,
    [bookingId],
  );
  return r.rows[0]!;
}
