import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { BusinessCard, SiteHeader } from '@/components/public/business-card';
import { UseMyLocation } from '@/components/public/use-my-location';
import { PAGE, SORTS, getHome, searchBusinesses } from '@/lib/public/search';

// C4 Search results: context + count, filter chips (Available today · Date/time · Price · Rating 4.5+ ·
// Distance · For), sort, cards, load more; honest empty states ("Not on APP_NAME yet", remove a filter).
// Everything lives in the URL, so results are shareable and server-rendered.

export const metadata: Metadata = { title: 'Search · APP_NAME', robots: { index: false } };
export const dynamic = 'force-dynamic';

type SP = Record<string, string | undefined>;
type Props = { searchParams: Promise<SP> };

const FILTER_KEYS = [
  'available_today',
  'price',
  'rating',
  'audience',
  'km',
  'date',
  'from',
  'to',
] as const;

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const lat = sp.lat ? Number(sp.lat) : undefined;
  const lng = sp.lng ? Number(sp.lng) : undefined;
  const filters: Record<string, unknown> = {};
  if (sp.available_today) filters.available_today = true;
  if (sp.price) filters.price_levels = sp.price.split(',').map(Number).filter(Boolean);
  if (sp.rating) filters.min_rating = Number(sp.rating);
  if (sp.audience) filters.audience = sp.audience;
  if (sp.km && lat != null) filters.max_km = Number(sp.km);
  if (sp.date) {
    filters.date = sp.date;
    if (sp.from) filters.time_from = sp.from;
    if (sp.to) filters.time_to = sp.to;
  }
  const [res, home] = await Promise.all([
    searchBusinesses({
      q: sp.q,
      service: sp.service,
      category: sp.category,
      cluster: sp.cluster,
      area: sp.area,
      lat,
      lng,
      filters,
      sort: sp.sort,
      page,
    }),
    getHome(null),
  ]);
  const cluster = home.clusters.find((c) => c.id === sp.cluster);
  const href = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, page: undefined, ...patch })) if (v) p.set(k, v);
    return `/search?${p.toString()}`;
  };
  const toggle = (k: string, v: string) => href({ [k]: sp[k] === v ? undefined : v });
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${active ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200 bg-surface-0'}`;
  const active = FILTER_KEYS.filter((k) => sp[k]);
  const title = sp.q || (sp.available_today ? 'Available today' : 'All places');

  return (
    <>
      <SiteHeader cluster={sp.cluster} q={sp.q} />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-semibold" dir="auto">
            {title}
          </h1>
          <span className="text-ink-500">· {cluster?.name ?? 'All areas'}</span>
          <span className="text-sm text-ink-500" data-testid="result-count">
            · {res.total} {res.total === 1 ? 'place' : 'places'}
          </span>
          <nav className="ms-auto flex flex-wrap gap-1 text-sm" aria-label="Area">
            <Link
              href={href({ cluster: undefined, area: undefined })}
              className={chip(!sp.cluster && !sp.area)}
            >
              All
            </Link>
            {home.clusters.map((c) => (
              <Link
                key={c.id}
                href={href({ cluster: c.id, area: undefined })}
                className={chip(sp.cluster === c.id)}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        </div>

        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Filters"
          data-testid="filters"
        >
          <Link href={toggle('available_today', '1')} className={chip(!!sp.available_today)}>
            Available today
          </Link>
          {[1, 2, 3].map((l) => (
            <Link
              key={l}
              href={toggle('price', String(l))}
              className={chip(sp.price === String(l))}
            >
              {'$'.repeat(l)}
            </Link>
          ))}
          <Link href={toggle('rating', '4.5')} className={chip(sp.rating === '4.5')}>
            Rating 4.5+
          </Link>
          <Link href={toggle('audience', 'women')} className={chip(sp.audience === 'women')}>
            For women
          </Link>
          <Link href={toggle('audience', 'men')} className={chip(sp.audience === 'men')}>
            For men
          </Link>
          {lat != null ? (
            <Link href={toggle('km', '3')} className={chip(sp.km === '3')}>
              Within 3 km
            </Link>
          ) : (
            <Suspense>
              <UseMyLocation />
            </Suspense>
          )}
          <form
            action="/search"
            className="flex items-center gap-1 text-sm"
            aria-label="Date and time"
          >
            {Object.entries(sp)
              .filter(([k, v]) => v && !['date', 'from', 'to', 'page'].includes(k))
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <input
              type="date"
              name="date"
              defaultValue={sp.date}
              className="h-8 rounded-control border border-line-200 px-2"
              aria-label="Date"
            />
            <input
              type="time"
              name="from"
              defaultValue={sp.from ?? '09:00'}
              className="h-8 rounded-control border border-line-200 px-2"
              aria-label="From"
            />
            <input
              type="time"
              name="to"
              defaultValue={sp.to ?? '21:00'}
              className="h-8 rounded-control border border-line-200 px-2"
              aria-label="To"
            />
            <button type="submit" className="h-8 rounded-control border border-line-200 px-2">
              Apply
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-500">Sort:</span>
          {SORTS.map(([k, label]) => (
            <Link
              key={k}
              href={href({ sort: k === 'recommended' ? undefined : k })}
              className={
                (sp.sort ?? 'recommended') === k ? 'font-semibold text-ink-900' : 'text-accent-600'
              }
            >
              {label}
            </Link>
          ))}
          {(sp.sort ?? 'recommended') === 'recommended' ? (
            <span
              className="text-xs text-ink-500"
              title="Based on verified reviews, bookings, distance and availability. Businesses can't pay to change it."
            >
              ⓘ
            </span>
          ) : null}
        </div>

        {res.intent.not_offered ? (
          <div
            className="rounded-card border border-line-200 bg-surface-50 p-4 text-sm"
            data-testid="not-offered"
          >
            <p className="font-medium">Not on APP_NAME yet</p>
            <p className="mt-1 text-ink-700">
              We cover {home.categories.map((c) => c.name.toLowerCase()).join(', ')}. Try one of
              those, or check back soon.
            </p>
          </div>
        ) : res.total === 0 ? (
          <div
            className="rounded-card border border-line-200 bg-surface-50 p-4 text-sm"
            data-testid="no-results"
          >
            <p className="font-medium">No places match all your filters.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {active.map((k) => (
                <Link
                  key={k}
                  href={href({
                    [k]: undefined,
                    ...(k === 'date' ? { from: undefined, to: undefined } : {}),
                  })}
                  className={chip(false)}
                >
                  Remove “{k.replace('_', ' ')}”
                </Link>
              ))}
              {sp.cluster ? (
                <Link href={href({ cluster: undefined })} className={chip(false)}>
                  Show all areas
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="results">
          {res.results.map((c) => (
            <BusinessCard key={c.location_id} c={c} />
          ))}
        </div>

        {res.total > page * PAGE ? (
          <Link
            href={href({ page: String(page + 1) })}
            className="self-center rounded-control border border-line-200 px-4 py-2 text-sm"
          >
            More places
          </Link>
        ) : null}

        {res.nearby?.length ? (
          <section className="mt-4 flex flex-col gap-3" data-testid="also-nearby">
            <h2 className="font-semibold">Also nearby</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {res.nearby.map((c) => (
                <BusinessCard key={c.location_id} c={c} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
