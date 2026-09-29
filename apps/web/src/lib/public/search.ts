// M12 search & discovery: server-side reads (anon key) + shared types and labels.

export interface SearchCard {
  location_id: string;
  business_id: string;
  slug: string;
  name: string;
  area: string | null;
  cluster_id: string | null;
  km: number | null;
  display_rating: number | null;
  review_count: number;
  price_level: number | null;
  cover_path: string | null;
  next_available_at: string | null;
  labels: string[];
  service: {
    service_id: string;
    name: string;
    type: 'fixed' | 'from' | 'range' | 'on_consultation';
    min: number | null;
    max: number | null;
    duration: number;
    next: string | null;
  } | null;
}
export interface SearchResult {
  total: number;
  results: SearchCard[];
  nearby?: SearchCard[];
  intent: {
    service_ids: string[];
    category_ids: string[];
    area_id: string | null;
    not_offered: boolean;
  };
}
export interface Cluster {
  id: string;
  slug: string;
  name: string;
  name_ar?: string;
}
export interface Home {
  clusters: Cluster[];
  categories: { id: string; slug: string; name: string; icon: string | null }[];
  available_today: SearchCard[];
  top_rated: SearchCard[];
  new: SearchCard[];
  popular_services: { id: string; name: string; places: number }[];
}
export interface Landing {
  area: { id: string; slug: string; name: string; name_ar: string; cluster: Cluster | null } | null;
  cluster: Cluster | null;
  category: { id: string; slug: string; name: string; name_ar: string };
  total: number;
  results: SearchCard[];
  services: { id: string; name: string }[];
}

export const LABELS: Record<string, string> = {
  top_rated: 'Top rated',
  available_today: 'Available today',
  top_cleanliness: 'Spotless',
  great_punctuality: 'On time',
  best_value: 'Great value',
  popular_near_you: 'Popular nearby',
  new: 'New on APP_NAME',
};

export const SORTS: [string, string][] = [
  ['recommended', 'Recommended'],
  ['nearest', 'Nearest'],
  ['rating', 'Highest rated'],
  ['price', 'Price low → high'],
  ['soonest', 'Soonest available'],
];

const env = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
});

async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  fallback: T,
  revalidate: number | false,
): Promise<T> {
  const { url, key } = env();
  if (!url || !key) return fallback;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      ...(revalidate === false ? { cache: 'no-store' as const } : { next: { revalidate } }),
    });
    if (!res.ok) return fallback;
    return ((await res.json()) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

const EMPTY_HOME: Home = {
  clusters: [],
  categories: [],
  available_today: [],
  top_rated: [],
  new: [],
  popular_services: [],
};

/** Home rails for a cluster (1-minute cache; same for every visitor). */
export const getHome = (clusterId: string | null) =>
  rpc<Home>('get_home', { p_cluster_id: clusterId }, EMPTY_HOME, 60);

export const getLanding = (area: string, category: string) =>
  rpc<Landing | null>('get_landing', { p_area_slug: area, p_category_slug: category }, null, 300);

export interface SearchParams {
  q?: string;
  service?: string;
  category?: string;
  cluster?: string;
  area?: string;
  lat?: number;
  lng?: number;
  filters?: Record<string, unknown>;
  sort?: string;
  page?: number;
}
export const PAGE = 20;

/** Not cached: results depend on filters and time, and every query feeds the demand / zero-result log. */
export const searchBusinesses = (p: SearchParams) =>
  rpc<SearchResult>(
    'search_businesses',
    {
      p_q: p.q || null,
      p_service_id: p.service || null,
      p_category_id: p.category || null,
      p_cluster_id: p.cluster || null,
      p_area_id: p.area || null,
      p_lat: p.lat ?? null,
      p_lng: p.lng ?? null,
      p_filters: p.filters ?? {},
      p_sort: p.sort || 'recommended',
      p_offset: ((p.page ?? 1) - 1) * PAGE,
      p_limit: PAGE,
    },
    {
      total: 0,
      results: [],
      intent: { service_ids: [], category_ids: [], area_id: null, not_offered: false },
    },
    false,
  );

/** Public reference rows (categories, clusters) straight from PostgREST (public RLS read). */
export async function getReference<T>(path: string, fallback: T): Promise<T> {
  const { url, key } = env();
  if (!url || !key) return fallback;
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 300 },
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}
