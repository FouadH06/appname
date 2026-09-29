import type { BusinessPageResult, PublicReview } from './types';

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
