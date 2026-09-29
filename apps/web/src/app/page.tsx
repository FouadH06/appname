import Link from 'next/link';
import { Rail } from '@/components/public/business-card';
import { SearchBox } from '@/components/public/search-box';
import { getHome } from '@/lib/public/search';

// C2 web home (lean landing): hero search, cluster picker, categories, rails (available today, top
// rated, new — hidden under 3 items), popular services, cluster links, "For businesses".
export const revalidate = 60;

type Props = { searchParams: Promise<{ cluster?: string }> };

export default async function Home({ searchParams }: Props) {
  const { cluster: clusterSlug } = await searchParams;
  const base = await getHome(null);
  const cluster = base.clusters.find((c) => c.slug === clusterSlug) ?? null;
  const home = cluster ? await getHome(cluster.id) : base;
  const q = (extra: Record<string, string>) =>
    `/search?${new URLSearchParams({ ...(cluster ? { cluster: cluster.id } : {}), ...extra }).toString()}`;

  return (
    <main className="flex min-h-screen flex-col">
      <section className="bg-surface-50">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-12">
          <h1 className="text-3xl font-semibold">Book trusted beauty & grooming in Lebanon</h1>
          <p className="text-ink-700">
            Verified reviews from real visits. Real prices. Free times you can book now.
          </p>
          <SearchBox cluster={cluster?.id} big />
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="Area">
            <Link
              href="/"
              className={`rounded-full border px-3 py-1 ${!cluster ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200 bg-surface-0'}`}
            >
              All areas
            </Link>
            {home.clusters.map((c) => (
              <Link
                key={c.id}
                href={`/?cluster=${c.slug}`}
                className={`rounded-full border px-3 py-1 ${cluster?.id === c.id ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200 bg-surface-0'}`}
                data-testid="cluster-chip"
              >
                {c.name}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8">
        <section className="flex flex-wrap gap-2" aria-label="Categories">
          {home.categories.map((c) => (
            <Link
              key={c.id}
              href={q({ category: c.id, q: c.name })}
              className="rounded-full border border-line-200 px-4 py-2 text-sm hover:bg-surface-50"
            >
              {c.name}
            </Link>
          ))}
          <Link href="/explore" className="rounded-full px-4 py-2 text-sm text-accent-600">
            Explore all →
          </Link>
        </section>

        <Rail
          title="Available today"
          cards={home.available_today}
          more={q({ available_today: '1' })}
        />
        <Rail title="Top rated" cards={home.top_rated} more={q({ sort: 'rating' })} />
        <Rail title="New on APP_NAME" cards={home.new} />

        {home.popular_services.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">
              Popular {cluster ? `in ${cluster.name}` : 'services'}
            </h2>
            <div className="flex flex-wrap gap-2">
              {home.popular_services.map((s) => (
                <Link
                  key={s.id}
                  href={q({ service: s.id, q: s.name })}
                  className="rounded-full bg-surface-100 px-3 py-1 text-sm"
                >
                  {s.name} <span className="text-ink-500">· {s.places}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {!home.available_today.length && !home.top_rated.length && !home.new.length ? (
          <p className="text-sm text-ink-700" data-testid="home-empty">
            We&apos;re live in {home.clusters.map((c) => c.name).join(', ')}. Pick an area above or
            search for a service.
          </p>
        ) : null}

        <footer className="mt-8 flex flex-wrap gap-4 border-t border-line-200 pt-6 text-sm text-ink-500">
          {home.clusters.map((c) => (
            <Link key={c.id} href={`/?cluster=${c.slug}`} className="hover:underline">
              {c.name}
            </Link>
          ))}
          <Link href="/explore" className="hover:underline">
            Explore
          </Link>
          <Link href="/biz" className="ms-auto hover:underline">
            For businesses
          </Link>
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
        </footer>
      </div>
    </main>
  );
}
