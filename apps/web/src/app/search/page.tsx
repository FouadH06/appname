import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { BusinessCard } from '@/components/customer/cards';
import { IconFilter } from '@/components/customer/icons';
import { BRAND, container } from '@/components/customer/layout';
import { CustomerShell } from '@/components/customer/shell';
import { SearchBox } from '@/components/public/search-box';
import { UseMyLocation } from '@/components/public/use-my-location';
import { PAGE, SORTS, getHome, searchBusinesses } from '@/lib/public/search';

// C4 Search results (UX pass). One filter system, everything in the URL (shareable, server-rendered,
// kept when coming back): Today · Distance · Rating · Price as the concise set, more (date & time,
// audience) folded away. Desktop keeps filters in a left column next to a results grid; phones get a
// chip row. Card data and ranking are the same on every screen.

export const metadata: Metadata = { title: 'Search', robots: { index: false } };
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
const FILTER_NAMES: Record<string, string> = {
  available_today: 'Today',
  price: 'Price',
  rating: 'Rating',
  audience: 'For',
  km: 'Distance',
  date: 'Date',
};

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
  const active = FILTER_KEYS.filter((k) => sp[k] && k !== 'from' && k !== 'to');
  const sort = sp.sort ?? 'recommended';
  const title = sp.q || (sp.available_today ? 'Available today' : 'All places');
  const chip = (on: boolean) =>
    `inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium ${on ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200 bg-surface-0 text-ink-900 hover:border-accent-600'}`;
  const option = (on: boolean) =>
    `flex min-h-10 items-center justify-between rounded-control px-3 text-sm ${on ? 'bg-accent-50 font-semibold text-accent-600' : 'text-ink-700 hover:bg-surface-100'}`;

  const dateForm = (
    <form action="/search" className="flex flex-col gap-2 text-sm" aria-label="Date and time">
      {Object.entries(sp)
        .filter(([k, v]) => v && !['date', 'from', 'to', 'page'].includes(k))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <input
        type="date"
        name="date"
        defaultValue={sp.date}
        className="h-10 rounded-control border border-line-200 bg-surface-0 px-3"
        aria-label="Date"
      />
      <div className="flex gap-2">
        <input
          type="time"
          name="from"
          defaultValue={sp.from ?? '09:00'}
          className="h-10 min-w-0 flex-1 rounded-control border border-line-200 bg-surface-0 px-2"
          aria-label="From"
        />
        <input
          type="time"
          name="to"
          defaultValue={sp.to ?? '21:00'}
          className="h-10 min-w-0 flex-1 rounded-control border border-line-200 bg-surface-0 px-2"
          aria-label="To"
        />
      </div>
      <button
        type="submit"
        className="h-10 rounded-control border border-line-200 bg-surface-0 font-medium hover:border-accent-600"
      >
        Apply
      </button>
    </form>
  );
  const areaLinks = (
    <>
      <Link
        href={href({ cluster: undefined, area: undefined })}
        className={option(!sp.cluster && !sp.area)}
      >
        All areas
      </Link>
      {home.clusters.map((c) => (
        <Link
          key={c.id}
          href={href({ cluster: c.id, area: undefined })}
          className={option(sp.cluster === c.id)}
        >
          {c.name}
        </Link>
      ))}
    </>
  );
  const group = (label: string, children: ReactNode) => (
    <div className="flex flex-col gap-1">
      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
        {label}
      </p>
      {children}
    </div>
  );

  return (
    <CustomerShell>
      <main className={`${container} flex flex-col gap-4 pb-10 pt-4 lg:pt-8`}>
        <div className="lg:max-w-3xl">
          <SearchBox cluster={sp.cluster} initial={sp.q} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
            {title}
          </h1>
          <span className="text-sm text-ink-500" data-testid="result-count">
            {res.total} {res.total === 1 ? 'place' : 'places'} · {cluster?.name ?? 'All areas'}
          </span>
        </div>

        {/* phones & tablets: concise chip row (same URL filters as the desktop column) */}
        <div
          className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0 lg:hidden"
          aria-label="Filters"
          data-testid="filters"
        >
          <Link href={toggle('available_today', '1')} className={chip(!!sp.available_today)}>
            Today
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
          <Link href={toggle('rating', '4.5')} className={chip(sp.rating === '4.5')}>
            Rating 4.5+
          </Link>
          {[1, 2, 3].map((l) => (
            <Link
              key={l}
              href={toggle('price', String(l))}
              className={chip(sp.price === String(l))}
              aria-label={`Price level ${l}`}
            >
              {'$'.repeat(l)}
            </Link>
          ))}
        </div>
        <details className="rounded-card border border-line-200 bg-surface-0 lg:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <IconFilter size={18} /> More filters & sort
            {active.length ? (
              <span className="ms-auto rounded-full bg-accent-600 px-2 text-xs text-white">
                {active.length}
              </span>
            ) : null}
          </summary>
          <div className="grid gap-4 border-t border-line-200 p-4 sm:grid-cols-2 md:grid-cols-4">
            {group('Area', areaLinks)}
            {group(
              'Sort',
              SORTS.map(([k, label]) => (
                <Link
                  key={k}
                  href={href({ sort: k === 'recommended' ? undefined : k })}
                  className={option(sort === k)}
                >
                  {label}
                </Link>
              )),
            )}
            {group(
              'For',
              <>
                <Link
                  href={toggle('audience', 'women')}
                  className={option(sp.audience === 'women')}
                >
                  Women
                </Link>
                <Link href={toggle('audience', 'men')} className={option(sp.audience === 'men')}>
                  Men
                </Link>
              </>,
            )}
            {group('Date & time', dateForm)}
          </div>
        </details>

        <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)] xl:gap-8">
          {/* desktop filter column */}
          <aside className="hidden lg:block" aria-label="Filters">
            <div className="sticky top-24 flex flex-col gap-5 rounded-card border border-line-200 bg-surface-0 p-3">
              {group('Area', areaLinks)}
              {group(
                'Availability',
                <Link
                  href={toggle('available_today', '1')}
                  className={option(!!sp.available_today)}
                >
                  Available today
                </Link>,
              )}
              {group(
                'Distance',
                lat != null ? (
                  <Link href={toggle('km', '3')} className={option(sp.km === '3')}>
                    Within 3 km
                  </Link>
                ) : (
                  <Suspense>
                    <UseMyLocation />
                  </Suspense>
                ),
              )}
              {group(
                'Rating',
                <Link href={toggle('rating', '4.5')} className={option(sp.rating === '4.5')}>
                  Rating 4.5+
                </Link>,
              )}
              {group(
                'Price',
                <div className="flex gap-2 px-3">
                  {[1, 2, 3].map((l) => (
                    <Link
                      key={l}
                      href={toggle('price', String(l))}
                      className={chip(sp.price === String(l))}
                      aria-label={`Price level ${l}`}
                    >
                      {'$'.repeat(l)}
                    </Link>
                  ))}
                </div>,
              )}
              {group(
                'For',
                <>
                  <Link
                    href={toggle('audience', 'women')}
                    className={option(sp.audience === 'women')}
                  >
                    Women
                  </Link>
                  <Link href={toggle('audience', 'men')} className={option(sp.audience === 'men')}>
                    Men
                  </Link>
                </>,
              )}
              {group('Date & time', <div className="px-3">{dateForm}</div>)}
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="hidden items-center gap-1 text-sm lg:flex">
              <span className="me-1 text-ink-500">Sort</span>
              {SORTS.map(([k, label]) => (
                <Link
                  key={k}
                  href={href({ sort: k === 'recommended' ? undefined : k })}
                  aria-current={sort === k ? 'true' : undefined}
                  className={`rounded-full px-3 py-1.5 ${sort === k ? 'bg-accent-50 font-semibold text-accent-600' : 'text-ink-700 hover:bg-surface-100'}`}
                >
                  {label}
                </Link>
              ))}
              {sort === 'recommended' ? (
                <span
                  className="ms-1 text-xs text-ink-500"
                  title="Based on verified reviews, bookings, distance and availability. Businesses can't pay to change it."
                >
                  ⓘ
                </span>
              ) : null}
            </div>

            {res.intent.not_offered ? (
              <div
                className="rounded-card border border-line-200 bg-surface-0 p-4 text-sm"
                data-testid="not-offered"
              >
                <p className="font-medium">Not on {BRAND} yet</p>
                <p className="mt-1 text-ink-700">
                  We cover {home.categories.map((c) => c.name.toLowerCase()).join(', ')}. Try one of
                  those, or check back soon.
                </p>
              </div>
            ) : res.total === 0 ? (
              <div
                className="rounded-card border border-line-200 bg-surface-0 p-4 text-sm"
                data-testid="no-results"
              >
                <p className="font-medium">No places match all your filters.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {active.map((k) => (
                    <Link
                      key={k}
                      href={href({
                        [k]: undefined,
                        ...(k === 'date' ? { from: undefined, to: undefined } : {}),
                      })}
                      className={chip(false)}
                    >
                      Remove “{FILTER_NAMES[k] ?? k}”
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

            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3"
              data-testid="results"
            >
              {res.results.map((c, i) => (
                <BusinessCard
                  key={c.location_id}
                  c={c}
                  mode={c.service ? 'service' : 'business'}
                  row
                  priority={i < 2}
                />
              ))}
            </div>

            {res.total > page * PAGE ? (
              <Link
                href={href({ page: String(page + 1) })}
                className="self-center rounded-full border border-line-200 bg-surface-0 px-5 py-2.5 text-sm font-medium hover:border-accent-600"
              >
                More places
              </Link>
            ) : null}

            {res.nearby?.length ? (
              <section className="mt-4 flex flex-col gap-3" data-testid="also-nearby">
                <h2 className="text-lg font-semibold">Also nearby</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                  {res.nearby.map((c) => (
                    <BusinessCard key={c.location_id} c={c} row />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </CustomerShell>
  );
}
