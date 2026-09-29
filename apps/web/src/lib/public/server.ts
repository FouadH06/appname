import type { BusinessPageResult, BusinessResults, PublicReview, ResultDetail } from './types';

// Server-side reads for the public pages (SSR / ISR). Plain PostgREST calls with the public anon
// key: the payloads are the same for every visitor, so they can be cached for a minute.

const env = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
});

export async function getBusinessPage(slug: string): Promise<BusinessPageResult> {
  const { url, key } = env();
  if (!url || !key) return { state: 'unavailable' };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_business_page`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
      next: { revalidate: 60, tags: [`business:${slug.toLowerCase()}`] },
    });
    if (!res.ok) return { state: 'unavailable' };
    return (await res.json()) as BusinessPageResult;
  } catch {
    return { state: 'unavailable' };
  }
}

/** First page of verified reviews (same 1-minute cache as the page). */
export async function getBusinessReviews(
  businessId: string,
  slug: string,
): Promise<PublicReview[]> {
  const { url, key } = env();
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_business_reviews`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_business_id: businessId, p_limit: 10 }),
      next: { revalidate: 60, tags: [`business:${slug.toLowerCase()}`] },
    });
    if (!res.ok) return [];
    return (await res.json()) as PublicReview[];
  } catch {
    return [];
  }
}

async function publicRpc<T>(
  name: string,
  args: Record<string, unknown>,
  tags: string[],
  fallback: T,
): Promise<T> {
  const { url, key } = env();
  if (!url || !key) return fallback;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      next: { revalidate: 60, tags },
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/** Customer results (M10): featured row + organic feed (same 1-minute cache as the page). */
export function getBusinessResults(
  businessId: string,
  slug: string,
  limit = 24,
  serviceId?: string,
): Promise<BusinessResults> {
  return publicRpc<BusinessResults>(
    'get_business_results',
    { p_business_id: businessId, p_limit: limit, p_service_id: serviceId ?? null },
    [`business:${slug.toLowerCase()}`],
    { featured: [], items: [], total: 0 },
  );
}

export function getResult(id: string): Promise<ResultDetail> {
  return publicRpc<ResultDetail>('get_result', { p_review_media_id: id }, [`result:${id}`], {
    state: 'removed',
  });
}
