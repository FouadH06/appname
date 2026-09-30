import Link from 'next/link';
import { BusinessCard, Section, ServiceTile } from '@/components/customer/cards';
import { CategoryIcon } from '@/components/customer/category-icon';
import { IconCalendar, IconChevron, IconPin, IconStar } from '@/components/customer/icons';
import { ReturningModules } from '@/components/customer/returning';
import { container } from '@/components/customer/layout';
import { CustomerShell } from '@/components/customer/shell';
import { SearchBox } from '@/components/public/search-box';
import { getHome, type Cluster } from '@/lib/public/search';

// C2 Home (UX pass, locked reference): search first, quick intents, categories with supply,
// returning-customer modules, then Available today · Top rated · Popular services. Phones scroll
// the sections horizontally; tablets and desktops lay them out as grids.
export const revalidate = 60;

type Props = { searchParams: Promise<{ cluster?: string }> };

function AreaPicker({ clusters, current }: { clusters: Cluster[]; current: Cluster | null }) {
  return (
    <details className="group relative" data-testid="area-picker">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-2 text-sm font-medium text-ink-900 hover:bg-surface-100 [&::-webkit-details-marker]:hidden">
        <IconPin size={18} className="text-accent-600" />
        <span className="max-w-[9rem] truncate">{current?.name ?? 'All areas'}</span>
        <IconChevron size={14} className="rotate-90" />
      </summary>
      <ul className="absolute end-0 top-full z-40 mt-1 w-56 rounded-card border border-line-200 bg-surface-0 py-1 shadow-lg">
        <li>
          <Link href="/" className="flex min-h-11 items-center px-4 text-sm hover:bg-surface-50">
            All areas
          </Link>
        </li>
        {clusters.map((c) => (
          <li key={c.id}>
            <Link
              href={`/?cluster=${c.slug}`}
              className={`flex min-h-11 items-center px-4 text-sm hover:bg-surface-50 ${current?.id === c.id ? 'font-semibold text-accent-600' : ''}`}
              data-testid="cluster-chip"
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function Home({ searchParams }: Props) {
  const { cluster: clusterSlug } = await searchParams;
  const base = await getHome(null);
  const cluster = base.clusters.find((c) => c.slug === clusterSlug) ?? null;
  const home = cluster ? await getHome(cluster.id) : base;
  const q = (extra: Record<string, string>) =>
    `/search?${new URLSearchParams({ ...(cluster ? { cluster: cluster.id } : {}), ...extra }).toString()}`;
  const intent =
    'flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors';
  const empty = !home.available_today.length && !home.top_rated.length && !home.new.length;

  return (
    <CustomerShell headerExtra={<AreaPicker clusters={home.clusters} current={cluster} />}>
      <main className={`${container} flex flex-col gap-8 pb-10 pt-4 lg:gap-12 lg:pt-10`}>
        <section className="flex flex-col gap-4 lg:gap-5">
          <h1 className="hidden text-4xl font-semibold tracking-tight lg:block">
            Find and book trusted local services
          </h1>
          <p className="hidden max-w-2xl text-ink-700 lg:block">
            Verified reviews from real visits, real prices and times you can book now.
          </p>
          <div className="lg:max-w-3xl">
            <SearchBox cluster={cluster?.id} big />
          </div>
          <nav
            aria-label="Quick filters"
            className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
          >
            <Link
              href={q({ available_today: '1' })}
              className={`${intent} border-accent-600 bg-accent-600 text-white hover:bg-accent-700`}
            >
              <IconCalendar size={18} /> Available today
            </Link>
            <Link
              href={q({ sort: 'rating' })}
              className={`${intent} border-line-200 bg-surface-0 hover:border-accent-600`}
            >
              <IconStar size={16} className="text-accent-600" /> Top rated
            </Link>
            <Link
              href={q({ sort: 'soonest' })}
              className={`${intent} border-line-200 bg-surface-0 hover:border-accent-600`}
            >
              Soonest available
            </Link>
          </nav>
        </section>

        {home.categories.length ? (
          <nav
            aria-label="Categories"
            className="rail -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0 lg:gap-4"
          >
            {home.categories.map((c) => (
              <Link
                key={c.id}
                href={q({ category: c.id, q: c.name })}
                className="flex w-[76px] shrink-0 flex-col items-center gap-2 text-center text-xs font-medium text-ink-900 sm:w-[88px] lg:text-sm"
              >
                <span className="grid size-16 place-items-center rounded-full bg-surface-100 text-accent-600 transition-colors hover:bg-accent-50 lg:size-[72px]">
                  <CategoryIcon icon={c.icon} />
                </span>
                <span className="line-clamp-2">{c.name}</span>
              </Link>
            ))}
          </nav>
        ) : null}

        <ReturningModules />

        {home.available_today.length >= 3 ? (
          <Section title="Available today" more={q({ available_today: '1' })} testId="rail">
            {home.available_today.slice(0, 8).map((c, i) => (
              <BusinessCard key={c.location_id} c={c} mode="availability" priority={i < 2} />
            ))}
          </Section>
        ) : null}
        {home.top_rated.length >= 3 ? (
          <Section
            title={cluster ? `Top rated in ${cluster.name}` : 'Top rated'}
            more={q({ sort: 'rating' })}
            testId="rail"
          >
            {home.top_rated.slice(0, 8).map((c) => (
              <BusinessCard key={c.location_id} c={c} />
            ))}
          </Section>
        ) : null}
        {home.popular_services.length ? (
          <Section title="Popular services" grid="sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {home.popular_services.map((s) => (
              <ServiceTile
                key={s.id}
                href={q({ service: s.id, q: s.name })}
                name={s.name}
                places={s.places}
              />
            ))}
          </Section>
        ) : null}
        {home.new.length >= 3 ? (
          <Section title="New here" testId="rail">
            {home.new.slice(0, 8).map((c) => (
              <BusinessCard key={c.location_id} c={c} />
            ))}
          </Section>
        ) : null}

        {empty ? (
          <p
            className="rounded-card border border-line-200 bg-surface-0 p-4 text-sm text-ink-700"
            data-testid="home-empty"
          >
            We&apos;re live in {home.clusters.map((c) => c.name).join(', ')}. Pick an area or search
            for a service.
          </p>
        ) : null}

        <footer className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line-200 pt-6 text-sm text-ink-500">
          {home.clusters.map((c) => (
            <Link key={c.id} href={`/?cluster=${c.slug}`} className="hover:underline">
              {c.name}
            </Link>
          ))}
          <Link href="/explore" className="hover:underline">
            Explore
          </Link>
          <Link href="/biz" className="hover:underline sm:ms-auto">
            For businesses
          </Link>
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          <Link href="/review-guidelines" className="hover:underline">
            Review guidelines
          </Link>
        </footer>
      </main>
    </CustomerShell>
  );
}
