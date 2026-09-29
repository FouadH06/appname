import type { MetadataRoute } from 'next';
import { getReference } from '@/lib/public/search';

// Discovery pages for crawlers: home, explore, every live area × live category landing page, and
// every live business page (search results themselves are not indexed).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://platform.com';
  const [areas, cats, businesses] = await Promise.all([
    getReference<{ slug: string }[]>('areas?select=slug&is_live=eq.true&level=eq.area', []),
    getReference<{ slug: string }[]>(
      'categories?select=slug&is_live=eq.true&parent_id=not.is.null',
      [],
    ),
    getReference<string[]>('rpc/get_public_business_slugs', []),
  ]);
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/explore`, changeFrequency: 'weekly', priority: 0.8 },
    ...areas.flatMap((a) =>
      cats.map((c) => ({
        url: `${base}/${a.slug}/${c.slug}`,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      })),
    ),
    ...businesses.map((slug) => ({
      url: `${base}/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
