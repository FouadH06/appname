import Link from 'next/link';
import type { ReactNode } from 'react';
import { SearchBox } from '@/components/public/search-box';
import { dateTimeText, durationText, mediaUrl, money } from '@/lib/public/format';
import { LABELS, type SearchCard } from '@/lib/public/search';

// C4 BusinessCard: proof (verified rating or "New") + labels + price level; for a service query, that
// service's price, duration and next slot, with a direct "Book" link.

export function priceLevel(level: number | null) {
  return level ? '$'.repeat(level) : null;
}

function servicePrice(s: NonNullable<SearchCard['service']>) {
  if (s.type === 'on_consultation') return 'Price on consultation';
  if (s.type === 'from') return `from ${money(s.min)}`;
  if (s.type === 'range') return `${money(s.min)}–${money(s.max)}`;
  return money(s.min);
}

export function BusinessCard({ c, compact = false }: { c: SearchCard; compact?: boolean }) {
  const cover = mediaUrl(c.cover_path);
  const next = c.service?.next ?? c.next_available_at;
  return (
    <article
      className="flex flex-col overflow-hidden rounded-card border border-line-200 bg-surface-0"
      data-testid="business-card"
    >
      <Link href={`/${c.slug}`} className="flex flex-col">
        <div className={`${compact ? 'h-28' : 'h-36'} bg-surface-100`}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- public derivative, sized by CSS
            <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : null}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <h3 className="font-semibold" dir="auto">
            {c.name}
          </h3>
          <p className="text-sm text-ink-700">
            {c.display_rating ? (
              <span>
                ★ {c.display_rating}{' '}
                <span className="text-ink-500">({c.review_count} verified)</span>
              </span>
            ) : (
              <span className="text-ink-500">
                New · {c.review_count ? `${c.review_count} verified so far` : 'no reviews yet'}
              </span>
            )}
            <span className="text-ink-500">
              {' · '}
              {c.area}
              {c.km != null ? ` · ${c.km} km` : ''}
              {priceLevel(c.price_level) ? ` · ${priceLevel(c.price_level)}` : ''}
            </span>
          </p>
          {c.labels.length ? (
            <p className="flex flex-wrap gap-1">
              {c.labels.map((l) => (
                <span
                  key={l}
                  className="rounded-full bg-surface-100 px-2 py-0.5 text-xs text-ink-700"
                >
                  {LABELS[l] ?? l}
                </span>
              ))}
            </p>
          ) : null}
          {c.service ? (
            <p className="text-sm" data-testid="card-service">
              {c.service.name} · {servicePrice(c.service)} · {durationText(c.service.duration)}
            </p>
          ) : null}
          <p className="text-sm text-accent-600">
            {next ? `Next: ${dateTimeText(next)}` : 'See times'}
          </p>
        </div>
      </Link>
      {c.service && !compact ? (
        <Link
          href={`/${c.slug}/book?service=${c.service.service_id}`}
          className="mx-3 mb-3 flex h-10 items-center justify-center rounded-control bg-accent-600 text-sm font-semibold text-white"
        >
          Book {c.service.name}
        </Link>
      ) : null}
    </article>
  );
}

export function Rail({
  title,
  cards,
  more,
}: {
  title: string;
  cards: SearchCard[];
  more?: string;
}) {
  if (cards.length < 3) return null; // C2: sections with fewer than 3 items are hidden
  return (
    <section className="flex flex-col gap-2" data-testid="rail">
      <div className="flex items-center">
        <h2 className="text-lg font-semibold">{title}</h2>
        {more ? (
          <Link href={more} className="ms-auto text-sm text-accent-600">
            See all
          </Link>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.slice(0, 4).map((c) => (
          <BusinessCard key={c.location_id} c={c} compact />
        ))}
      </div>
    </section>
  );
}

export function SiteHeader({
  cluster,
  q,
  children,
}: {
  cluster?: string | null;
  q?: string;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line-200 bg-surface-0">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <Link href="/" className="shrink-0 font-semibold">
          APP_NAME
        </Link>
        <div className="flex-1">
          <SearchBox cluster={cluster} initial={q} />
        </div>
        {children}
      </div>
    </header>
  );
}
