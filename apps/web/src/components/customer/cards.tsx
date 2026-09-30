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
  /** results list: a compact horizontal row at every width (faster comparison, image doesn't dominate) */
  row?: boolean;
}) {
  const img = coverUrl(c.cover_path, 640);
  const next = c.service?.next ?? c.next_available_at;
  const href = c.service ? `/${c.slug}?service=${c.service.service_id}` : `/${c.slug}`;
  const labels = c.labels.filter((l) => l !== 'available_today').slice(0, 2);
  return (
    <article
      className={`group relative flex h-full overflow-hidden rounded-card border border-line-200 bg-surface-0 transition-shadow hover:shadow-md ${row ? 'flex-row' : 'flex-col'}`}
      data-testid="business-card"
    >
      <div
        className={`relative shrink-0 overflow-hidden bg-surface-100 ${row ? 'min-h-28 w-28 self-stretch sm:w-32 xl:w-28' : 'aspect-[16/9] w-full xl:aspect-[2/1]'}`}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- public storage (fixed ratio box, lazy)
          <img
            src={img}
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : null}
        {mode === 'availability' && next ? (
          <span className="absolute bottom-2 start-2 rounded-full bg-accent-600 px-2 py-0.5 text-xs font-semibold text-white">
            Available today
          </span>
        ) : null}
        <FavoriteButton
          businessId={c.business_id}
          name={c.name}
          className="absolute end-2 top-2 z-10"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
        <h3 className="line-clamp-1 text-[15px] font-semibold leading-snug" dir="auto">
          <Link href={href} className="after:absolute after:inset-0">
            {c.name}
          </Link>
        </h3>
        <p className="flex min-w-0 items-center gap-x-1.5 whitespace-nowrap text-sm">
          <Rating value={c.display_rating} count={c.review_count} />
          {c.area ? <span className="min-w-0 truncate text-ink-500">· {c.area}</span> : null}
          {c.km != null ? <span className="shrink-0 text-ink-500">· {c.km} km</span> : null}
        </p>
        {/* service (or labels) and price share one line */}
        <p className="flex items-baseline justify-between gap-2 text-sm">
          {c.service ? (
            <span className="min-w-0 truncate text-ink-700" data-testid="card-service">
              {c.service.name} · {durationText(c.service.duration)}
            </span>
          ) : (
            <span className="min-w-0 truncate text-ink-700">
              {labels.map((l) => LABELS[l] ?? l).join(' · ')}
            </span>
          )}
          <span className="shrink-0 font-semibold text-ink-900">
            {c.service ? servicePrice(c.service) : c.price_level ? '$'.repeat(c.price_level) : ''}
          </span>
        </p>
        {next ? (
          <Link
            href={
              c.service
                ? `/${c.slug}/book?service=${c.service.service_id}&start=${encodeURIComponent(next)}`
                : href
            }
            className="relative z-10 mt-auto flex min-h-10 items-center justify-between gap-2 rounded-control bg-accent-50 px-2.5 text-[13px] hover:bg-accent-100 sm:min-h-8"
            data-testid="card-next"
          >
            <span className="text-ink-700">
              Next <span className="font-semibold text-accent-600">{whenText(next)}</span>
            </span>
            <IconChevron size={14} className="text-accent-600 rtl:rotate-180" />
          </Link>
        ) : (
          <p className="mt-auto text-[13px] text-ink-500">See times on the page</p>
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
      className="flex h-full flex-col justify-between gap-1.5 rounded-card border border-line-200 bg-surface-0 px-3 py-2.5 hover:border-accent-600"
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
 * (3 columns on tablets, 4 from 1024 px; two rows at most) — no giant stretched cards, no endless desktop scrolling.
 */
export function Section({
  title,
  more,
  children,
  testId,
  grid = 'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 sm:max-md:[&>*:nth-child(n+5)]:hidden md:max-lg:[&>*:nth-child(n+7)]:hidden lg:[&>*:nth-child(n+9)]:hidden',
}: {
  title: string;
  more?: string;
  children: React.ReactNode;
  testId?: string;
  grid?: string;
}) {
  return (
    <section className="flex flex-col gap-2.5" data-testid={testId}>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight lg:text-xl">{title}</h2>
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
