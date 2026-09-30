import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BusinessCard } from '@/components/customer/cards';
import { CustomerShell } from '@/components/customer/shell';
import { getLanding } from '@/lib/public/search';

// SEO landing — platform.com/{area}/{category} (area or cluster slug; both are reserved words, so they
// never collide with business links). Server-rendered, cached 5 minutes, indexable.
export const revalidate = 300;

type Params = { params: Promise<{ slug: string; category: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, category } = await params;
  const l = await getLanding(slug.toLowerCase(), category.toLowerCase());
  if (!l) return { title: 'APP_NAME' };
  const where = l.area?.name ?? l.cluster?.name ?? '';
  return {
    title: `${l.category.name} in ${where} · Book online · APP_NAME`,
    description: `${l.total} ${l.category.name.toLowerCase()} places in ${where} with verified reviews, real prices and free times. Book in under a minute.`,
    alternates: { canonical: `/${slug.toLowerCase()}/${category.toLowerCase()}` },
  };
}

export default async function Landing({ params }: Params) {
  const { slug, category } = await params;
  const l = await getLanding(slug.toLowerCase(), category.toLowerCase());
  if (!l) notFound();
  const where = l.area?.name ?? l.cluster?.name ?? '';
  const clusterId = l.cluster?.id ?? l.area?.cluster?.id ?? null;
  return (
    <CustomerShell>
      <main className="mx-auto flex w-full max-w-[1320px] flex-col sm:px-6 lg:px-8 lg:py-10 gap-4 px-4 py-6">
        <nav className="text-sm text-ink-500" aria-label="Breadcrumb">
          <Link href="/" className="hover:underline">
            Home
          </Link>{' '}
          ›{' '}
          <Link href="/explore" className="hover:underline">
            Explore
          </Link>{' '}
          › {l.category.name} in {where}
        </nav>
        <h1 className="text-2xl font-semibold" data-testid="landing-title">
          {l.category.name} in {where}
        </h1>
        <p className="text-ink-700">
          {l.total} {l.total === 1 ? 'place' : 'places'} with verified reviews from real visits.
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          {l.services.map((s) => (
            <Link
              key={s.id}
              href={`/search?${new URLSearchParams({ service: s.id, q: s.name, ...(clusterId ? { cluster: clusterId } : {}) }).toString()}`}
              className="rounded-full bg-surface-100 px-3 py-1"
            >
              {s.name}
            </Link>
          ))}
        </div>
        {l.total === 0 ? (
          <p className="text-sm text-ink-700" data-testid="landing-empty">
            No {l.category.name.toLowerCase()} places in {where} yet.{' '}
            <Link href="/explore" className="text-accent-600">
              Explore nearby areas
            </Link>
            .
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {l.results.map((c) => (
            <BusinessCard key={c.location_id} c={c} />
          ))}
        </div>
      </main>
    </CustomerShell>
  );
}
