import Link from 'next/link';
import { coverUrl, durationText, money, whenText } from '@/lib/public/format';
import { LABELS, type SearchCard } from '@/lib/public/search';
import { FavoriteButton } from './favorite';
import { IconChevron, IconStar } from './icons';

// One business card family (UX pass) with three modes sharing typography, image ratio, rating,
// price and availability styles:
//   business      — discovery rails and results
//   availability  — "Available today": the next time leads
//   service       — a searched service: its price, duration and next time lead
// Data and ranking are identical on every screen size; only the grid around the card changes.

export function Rating({ value, count }: { value: number | null; count: number }) {
  if (!value)
    return <span className="text-ink-500">{count ? `${count} verified so far` : 'New'}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <IconStar size={15} className="text-star-500" />
      <span className="font-semibold text-ink-900">{value.toFixed(1)}</span>
      <span className="text-ink-500">({count} verified)</span>
    </span>
  );
}

function servicePrice(s: NonNullable<SearchCard['service']>) {
  if (s.type === 'on_consultation') return 'Price on consultation';
  if (s.type === 'from') return `From ${money(s.min)}`;
  if (s.type === 'range') return `${money(s.min)}–${money(s.max)}`;
  return money(s.min);
}

export function BusinessCard({
  c,
  mode = 'business',
  priority = false,
  row = false,
}: {
  c: SearchCard;
  mode?: 'business' | 'availability' | 'service';
  priority?: boolean;
  /** results list: a compact row on phones, the regular card from 640 px */
  row?: boolean;
}) {
  const img = coverUrl(c.cover_path, 640);
  const next = c.service?.next ?? c.next_available_at;
  const href = c.service ? `/${c.slug}?service=${c.service.service_id}` : `/${c.slug}`;
  const labels = c.labels.filter((l) => l !== 'available_today').slice(0, 2);
  return (
    <article
      className={`group relative flex h-full overflow-hidden rounded-card border border-line-200 bg-surface-0 transition-shadow hover:shadow-md ${row ? 'flex-row sm:flex-col' : 'flex-col'}`}
      data-testid="business-card"
    >
      <div
        className={`relative shrink-0 overflow-hidden bg-surface-100 ${row ? 'w-28 self-stretch sm:aspect-[16/10] sm:w-full sm:self-auto' : 'aspect-[16/10] w-full'}`}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- public storage (fixed ratio box, lazy)
          <img
            src={img}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : null}
        {mode === 'availability' && next ? (
          <span className="absolute bottom-2 start-2 rounded-full bg-accent-600 px-2.5 py-1 text-xs font-semibold text-white">
            Available today
          </span>
        ) : null}
        <FavoriteButton
          businessId={c.business_id}
          name={c.name}
          className="absolute end-2 top-2 z-10"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-1 text-base font-semibold" dir="auto">
          <Link href={href} className="after:absolute after:inset-0">
            {c.name}
          </Link>
        </h3>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
          <Rating value={c.display_rating} count={c.review_count} />
          {c.area ? <span className="text-ink-500">· {c.area}</span> : null}
          {c.km != null ? <span className="text-ink-500">· {c.km} km</span> : null}
        </p>
        {c.service ? (
          <p className="text-sm text-ink-700" data-testid="card-service">
            {c.service.name} · {durationText(c.service.duration)}
          </p>
        ) : labels.length ? (
          <p className="line-clamp-1 text-sm text-ink-700">
            {labels.map((l) => LABELS[l] ?? l).join(' · ')}
          </p>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <span className="text-sm font-semibold text-ink-900">
            {c.service ? servicePrice(c.service) : c.price_level ? '$'.repeat(c.price_level) : ''}
          </span>
        </div>
        {next ? (
          <Link
            href={
              c.service
                ? `/${c.slug}/book?service=${c.service.service_id}&start=${encodeURIComponent(next)}`
                : href
            }
            className="relative z-10 flex min-h-10 items-center justify-between gap-2 rounded-control bg-accent-50 px-2.5 py-1.5 text-sm hover:bg-accent-100"
            data-testid="card-next"
          >
            <span className="text-ink-700">
              Next <span className="font-semibold text-accent-600">{whenText(next)}</span>
            </span>
            <IconChevron size={16} className="text-accent-600 rtl:rotate-180" />
          </Link>
        ) : (
          <p className="text-sm text-ink-500">See times on the page</p>
        )}
      </div>
    </article>
  );
}

/** Popular service tile (service-first discovery). */
export function ServiceTile({
  href,
  name,
  places,
}: {
  href: string;
  name: string;
  places: number;
}) {
  return (
    <Link
      href={href}
      className="flex h-full flex-col justify-between gap-2 rounded-card border border-line-200 bg-surface-0 p-4 hover:border-accent-600"
    >
      <span className="font-semibold" dir="auto">
        {name}
      </span>
      <span className="flex items-center justify-between text-sm text-ink-500">
        {places} {places === 1 ? 'place' : 'places'}
        <IconChevron size={16} className="text-accent-600 rtl:rotate-180" />
      </span>
    </Link>
  );
}

/**
 * A titled section whose cards scroll horizontally on phones and become a grid from tablets up
 * (3 columns, 4 on wide screens) — no giant stretched cards, no endless desktop scrolling.
 */
export function Section({
  title,
  more,
  children,
  testId,
  grid = 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 lg:[&>*:nth-child(n+7)]:hidden xl:[&>*:nth-child(n+7)]:block xl:[&>*:nth-child(n+9)]:hidden',
}: {
  title: string;
  more?: string;
  children: React.ReactNode;
  testId?: string;
  grid?: string;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {more ? (
          <Link
            href={more}
            className="flex items-center gap-0.5 text-sm font-medium text-ink-700 hover:text-accent-600"
          >
            See all <IconChevron size={16} className="rtl:rotate-180" />
          </Link>
        ) : null}
      </div>
      <div
        className={`rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 ${grid} [&>*]:w-[68%] [&>*]:max-w-[280px] [&>*]:shrink-0 sm:[&>*]:w-auto sm:[&>*]:max-w-none`}
      >
        {children}
      </div>
    </section>
  );
}
