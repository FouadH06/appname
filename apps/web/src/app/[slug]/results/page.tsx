import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ResultsGrid } from '@/components/public/results';
import { getBusinessPage, getBusinessResults } from '@/lib/public/server';
import type { BusinessPage } from '@/lib/public/types';

// C6 Results Grid — platform.com/{slug}/results (1-minute cache like the business page)
export const revalidate = 60;

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<BusinessPage> {
  const r = await getBusinessPage(slug.toLowerCase());
  if ('redirect_to' in r && r.redirect_to) permanentRedirect(`/${r.redirect_to}/results`);
  if (r.state !== 'ok') notFound();
  return r as BusinessPage;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const r = await getBusinessPage(slug.toLowerCase());
  if (r.state !== 'ok') return { title: 'APP_NAME' };
  return {
    title: `${(r as BusinessPage).business.name} · Customer results`,
    alternates: { canonical: `/${slug}/results` },
  };
}

export default async function ResultsPage({ params }: Params) {
  const { slug } = await params;
  const p = await load(slug);
  const results = await getBusinessResults(p.business.id, p.business.slug, 24);
  const services = p.services.map((s) => ({ id: s.id, name: s.name }));
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 px-4 py-6">
      <Link href={`/${p.business.slug}`} className="text-sm text-accent-600">
        ← {p.business.name}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">Customer results</h1>
        <p className="text-sm text-ink-500">
          Real photos from verified visits. {p.business.name} can feature some, but can’t hide any.
        </p>
      </div>
      <ResultsGrid
        businessId={p.business.id}
        businessName={p.business.name}
        initial={results}
        services={services}
      />
    </main>
  );
}
