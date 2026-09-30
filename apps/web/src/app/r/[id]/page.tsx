import type { Metadata } from 'next';
import Link from 'next/link';
import { CustomerShell } from '@/components/customer/shell';
import { ReportResult } from '@/components/public/result-report';
import { ReviewCard, Stars } from '@/components/public/reviews';
import { TIER_LABEL, priceText, ugcUrl } from '@/lib/public/format';
import { getResult } from '@/lib/public/server';

// C6 Result Detail — platform.com/r/{id}
export const revalidate = 60;

type Params = { params: Promise<{ id: string }> };

const visited = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Beirut',
  }).format(new Date(iso));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const r = await getResult(id);
  if (r.state !== 'ok') return { title: 'APP_NAME', robots: { index: false } };
  return {
    title: `${r.service ?? 'Result'} at ${r.business.name}`,
    openGraph: { images: [{ url: ugcUrl(r.images.card.path) ?? '' }] },
  };
}

export default async function ResultDetailPage({ params }: Params) {
  const { id } = await params;
  const r = await getResult(id);
  if (r.state !== 'ok') {
    return (
      <CustomerShell>
        <main className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-4 text-center">
          <p className="text-ink-700" data-testid="result-removed">
            This result was removed.
          </p>
        </main>
      </CustomerShell>
    );
  }
  const b = r.business;
  const bookHref = `/${b.slug}/book?service=${r.service_id}${r.staff_id ? `&staff=${r.staff_id}` : ''}`;
  return (
    <CustomerShell>
      <main
        className="mx-auto grid min-h-[60dvh] max-w-5xl gap-4 pb-24 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:px-4 lg:py-6"
        data-testid="result-detail"
      >
        <div className="flex flex-col gap-2 bg-ink-900 lg:rounded-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized public derivative */}
          <img
            src={ugcUrl(r.images.full.path) ?? ''}
            width={r.images.full.width}
            height={r.images.full.height}
            alt={`${r.service ?? 'Result'} at ${b.name}`}
            className="max-h-[80dvh] w-full object-contain"
            fetchPriority="high"
          />
          {r.more.length ? (
            <div className="flex gap-2 overflow-x-auto p-2">
              {r.more.map((m) => (
                <Link
                  key={m.id}
                  href={`/r/${m.id}`}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-control"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails */}
                  <img
                    src={ugcUrl(m.images.thumb.path) ?? ''}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 px-4 lg:px-0">
          <p className="text-sm font-medium text-success-600" data-testid="trust-mark">
            ✓ {TIER_LABEL[r.trust_tier]}
          </p>
          <h1 className="text-xl font-semibold">
            {r.service} at{' '}
            <Link href={`/${b.slug}`} className="text-accent-600">
              {b.name}
            </Link>
          </h1>
          <p className="text-sm text-ink-700">
            {r.staff ? `by ${r.staff} · ` : ''}Visited {visited(r.visit_at)}
            {b.area ? ` · ${b.area}` : ''}
          </p>
          <p className="text-sm text-ink-700">
            Price at the time:{' '}
            {priceText({
              price_type: r.price_type,
              price_min: r.price_min,
              price_max: r.price_max,
              currency: r.currency,
            })}
          </p>
          {b.rating.display_rating !== null ? (
            <p className="flex items-center gap-1 text-sm">
              <Stars value={b.rating.display_rating} /> {b.rating.display_rating.toFixed(1)} ·{' '}
              {b.rating.review_count} verified reviews
            </p>
          ) : null}
          <ul className="rounded-card border border-line-200 px-3">
            <ReviewCard r={r.review} businessName={b.name} />
          </ul>
          <div className="flex justify-between text-sm">
            {r.prev_id ? (
              <Link href={`/r/${r.prev_id}`} className="text-accent-600">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            {r.next_id ? (
              <Link href={`/r/${r.next_id}`} className="text-accent-600">
                Older →
              </Link>
            ) : (
              <span />
            )}
          </div>
          <ReportResult resultId={r.id} />
          <div className="fixed inset-x-0 bottom-0 border-t border-line-200 bg-surface-0 p-3 lg:static lg:border-0 lg:p-0">
            <Link
              href={bookHref}
              className="flex h-12 items-center justify-center rounded-control bg-accent-600 font-semibold text-white"
              data-testid="book-similar"
            >
              Book similar{r.staff_id && r.staff ? ` with ${r.staff}` : ''}
            </Link>
          </div>
        </div>
      </main>
    </CustomerShell>
  );
}
