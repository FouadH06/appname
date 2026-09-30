import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Rating } from '@/components/customer/cards';
import { FavoriteButton } from '@/components/customer/favorite';
import {
  IconBolt,
  IconCalendarX,
  IconCash,
  IconChevron,
  IconClock,
  IconNavigate,
  IconPhone,
  IconPin,
  IconUsers,
} from '@/components/customer/icons';
import { container } from '@/components/customer/layout';
import {
  BackButton,
  Gallery,
  NextAvailableRow,
  ServiceNext,
  ShareIconButton,
  StickyBookBar,
} from '@/components/customer/profile';
import { CustomerShell } from '@/components/customer/shell';
import { Attribution } from '@/components/public/attribution';
import { BookedBanner, OpenNow, TeamStrip } from '@/components/public/islands';
import { ResultsStrip } from '@/components/public/results';
import { RatingBreakdown, ReviewList } from '@/components/public/reviews';
import {
  AUDIENCE,
  WEEKDAY,
  clockText,
  durationText,
  mapsLink,
  mediaUrl,
  money,
  priceText,
  waLink,
} from '@/lib/public/format';
import { getBusinessPage, getBusinessResults, getBusinessReviews } from '@/lib/public/server';
import type { BusinessPage, PublicService } from '@/lib/public/types';

// C1/C5 business profile (UX pass, locked reference). Above the fold: gallery, name, verified rating,
// area, open status, next availability and Book. Then Services · Professionals · Results · Reviews ·
// Important info. Desktop and tablet landscape add a sticky booking panel; phones keep a sticky Book bar.
export const revalidate = 60;

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<BusinessPage | { state: 'unavailable' }> {
  if (slug !== slug.toLowerCase()) permanentRedirect(`/${slug.toLowerCase()}`);
  const r = await getBusinessPage(slug);
  if ('redirect_to' in r && r.redirect_to) permanentRedirect(`/${r.redirect_to}`);
  if (r.state === 'not_found') notFound();
  if (r.state !== 'ok') return { state: 'unavailable' };
  return r as BusinessPage;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const r = await getBusinessPage(slug.toLowerCase());
  if (r.state !== 'ok') return {};
  const p = r as BusinessPage;
  const where = p.location.area?.en ? ` in ${p.location.area.en}` : '';
  return {
    title: `${p.business.name} · Book online`,
    description: `${p.business.category?.en ?? 'Book'}${where}. See prices and free times, and book in under a minute.`,
    alternates: { canonical: `/${p.business.slug}` },
  };
}

const sectionTitle = 'text-xl font-semibold tracking-tight';
const panel = 'rounded-card border border-line-200 bg-surface-0';

function groupServices(services: PublicService[]) {
  const groups = new Map<string, PublicService[]>();
  for (const s of services) {
    const g = s.group ?? 'Services';
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  return [...groups.entries()];
}

export default async function BusinessPageRoute({ params }: Params) {
  const { slug } = await params;
  const p = await load(slug);
  if (p.state !== 'ok') {
    return (
      <CustomerShell>
        <main className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-4 text-center">
          <p className="text-ink-700" data-testid="page-unavailable">
            This page isn’t available.
          </p>
        </main>
      </CustomerShell>
    );
  }

  const { business: b, location: l, rules } = p;
  const [reviews, results] = await Promise.all([
    getBusinessReviews(b.id, b.slug),
    getBusinessResults(b.id, b.slug, 8),
  ]);
  const images = [b.cover_path, ...b.portfolio]
    .map((x) => mediaUrl(x))
    .filter((x): x is string => !!x);
  const photoUrls = Object.fromEntries(p.staff.map((s) => [s.id, mediaUrl(s.photo_path)]));
  const bookable = p.services.filter((s) => s.online);
  const ordered = [...p.services].sort(
    (a, c) =>
      (a.popular_rank ?? 99) - (c.popular_rank ?? 99) || Number(c.online) - Number(a.online),
  );
  const topService = ordered.find((s) => s.online);
  const wa = waLink(l.whatsapp, `Hi ${b.name}!`);
  const bookHref = `/${b.slug}/book`;
  const canBook = p.accepting && bookable.length > 0;
  const instant = rules.booking_mode !== 'request';
  const cancelHours = Math.round(rules.cancellation_window_minutes / 60);
  const cancelText =
    rules.cancellation_window_minutes <= 0
      ? 'Free cancellation until the appointment starts'
      : `Free cancellation up to ${cancelHours >= 1 ? `${cancelHours} hour${cancelHours === 1 ? '' : 's'}` : `${rules.cancellation_window_minutes} minutes`} before`;
  const todayName = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: 'Asia/Beirut',
  }).format(new Date());
  const today = WEEKDAY.indexOf(todayName);

  const bookPanel = (
    <div className="flex flex-col gap-3">
      {canBook && topService ? (
        <NextAvailableRow slug={b.slug} locationId={l.id} serviceId={topService.id} />
      ) : null}
      {canBook ? (
        <Link
          href={bookHref}
          className="flex h-12 items-center justify-center rounded-control bg-accent-600 px-6 text-base font-semibold text-white hover:bg-accent-700"
        >
          Book
        </Link>
      ) : (
        <p className="text-sm text-ink-700">
          Not taking online bookings right now — contact them directly.
        </p>
      )}
      {canBook ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-500">
          {instant ? (
            <>
              <IconBolt size={14} className="text-accent-600" /> Instant confirmation
            </>
          ) : (
            <>
              <IconClock size={14} /> {b.name} confirms each request
            </>
          )}
        </p>
      ) : null}
    </div>
  );

  return (
    <CustomerShell mobileHeader={false} mobileNav={false}>
      <Attribution />
      <BookedBanner businessId={b.id} />
      {!p.accepting ? (
        <div
          className="bg-warning-600 px-4 py-2 text-center text-sm text-white"
          data-testid="not-accepting"
        >
          Not taking online bookings right now — contact them on WhatsApp or by phone.
        </div>
      ) : null}

      <div
        className={`${container} grid gap-6 pb-28 !px-0 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-7 lg:!px-8 lg:pb-12 lg:pt-5`}
      >
        <main className="flex min-w-0 flex-col">
          {/* gallery with overlay actions (phones) */}
          <div className="relative">
            <Gallery images={images} name={b.name} />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3 pt-[max(12px,env(safe-area-inset-top))] lg:hidden">
              <BackButton />
              <div className="flex gap-2">
                <FavoriteButton businessId={b.id} name={b.name} />
                <ShareIconButton name={b.name} />
              </div>
            </div>
          </div>

          <div className="relative -mt-5 flex flex-col gap-7 rounded-t-[20px] bg-surface-50 px-4 pt-5 sm:px-6 md:mt-0 md:rounded-none md:pt-4 lg:px-0">
            {/* identity */}
            <section className="flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-3">
                <h1
                  className="text-[26px] font-semibold leading-tight tracking-tight lg:text-3xl"
                  dir="auto"
                  data-testid="business-name"
                >
                  {b.name}
                </h1>
                <div className="hidden gap-2 lg:flex">
                  <FavoriteButton
                    businessId={b.id}
                    name={b.name}
                    className="border border-line-200 shadow-none"
                  />
                  <ShareIconButton name={b.name} />
                </div>
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
                <span data-testid="rating-headline">
                  <Rating value={p.rating.display_rating} count={p.rating.review_count} />
                </span>
                {l.area?.en ? (
                  <span className="flex items-center gap-1 text-ink-700">
                    <IconPin size={16} /> {l.area.en}
                  </span>
                ) : null}
                <span className="flex items-center gap-1">
                  <IconClock size={16} className="text-ink-700" /> <OpenNow hours={p.hours} />
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  b.category?.en,
                  b.audience !== 'everyone' ? AUDIENCE[b.audience] : null,
                  b.price_level ? '$'.repeat(b.price_level) : null,
                ]
                  .filter(Boolean)
                  .map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-100 px-3 py-1 text-sm text-ink-700"
                    >
                      {t}
                    </span>
                  ))}
              </div>
              {canBook && topService ? (
                <div className="flex gap-2 lg:hidden" id="hero-book">
                  <NextAvailableRow slug={b.slug} locationId={l.id} serviceId={topService.id} />
                  <Link
                    href={bookHref}
                    className="flex h-12 shrink-0 items-center justify-center rounded-control bg-accent-600 px-8 text-base font-semibold text-white"
                  >
                    Book
                  </Link>
                </div>
              ) : null}
            </section>

            {/* services: tappable cards, no Book button per card */}
            <section className="flex flex-col gap-3" id="services">
              <div className="flex items-end justify-between">
                <h2 className={sectionTitle}>Services</h2>
                {ordered.length > 4 ? (
                  <a
                    href="#all-services"
                    className="flex items-center gap-0.5 text-sm font-medium text-ink-700 lg:hidden"
                  >
                    See all <IconChevron size={16} className="rtl:rotate-180" />
                  </a>
                ) : null}
              </div>
              <ul className="rail -mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 [&>li]:w-[72%] [&>li]:max-w-[300px] [&>li]:shrink-0 sm:[&>li]:w-auto sm:[&>li]:max-w-none">
                {ordered.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <ServiceCard
                      s={s}
                      slug={b.slug}
                      locationId={l.id}
                      canBook={p.accepting}
                      whatsapp={l.whatsapp}
                    />
                  </li>
                ))}
              </ul>
              {ordered.length > 6 || groupServices(p.services).length > 1 ? (
                <details className={`${panel} group`} id="all-services">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    All {p.services.length} services
                    <IconChevron
                      size={16}
                      className="rotate-90 transition-transform group-open:-rotate-90"
                    />
                  </summary>
                  <div className="flex flex-col gap-4 border-t border-line-200 p-4">
                    {groupServices(p.services).map(([g, list]) => (
                      <div key={g}>
                        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                          {g}
                        </h3>
                        <ul className="divide-y divide-line-200">
                          {list.map((s) => (
                            <li key={`${g}-${s.id}`}>
                              <ServiceRow
                                s={s}
                                slug={b.slug}
                                canBook={p.accepting}
                                whatsapp={l.whatsapp}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              {!bookable.length && p.accepting ? (
                <p className="text-sm text-ink-700">This business takes bookings by WhatsApp.</p>
              ) : null}
            </section>

            {/* professionals */}
            {p.staff.length ? (
              <section className="flex flex-col gap-3">
                <h2 className={sectionTitle}>Professionals</h2>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                  {canBook && rules.staff_choice_mode !== 'choose_only' ? (
                    <Link
                      href={bookHref}
                      className="flex items-center gap-3 rounded-card border border-accent-600 bg-accent-50 px-3 py-2.5 sm:w-56 sm:shrink-0"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-600">
                        <IconUsers size={20} />
                      </span>
                      <span className="flex flex-col">
                        <span className="font-semibold">Any available</span>
                        <span className="text-sm text-ink-700">
                          Book with the next available professional
                        </span>
                      </span>
                    </Link>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <TeamStrip
                      slug={b.slug}
                      staff={p.staff}
                      photoUrls={photoUrls}
                      services={p.services}
                      canBook={p.accepting}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {/* results (shoppable: result → service → professional → time) */}
            {results.total > 0 || b.portfolio.length ? (
              <section className="flex flex-col gap-3" id="results">
                <h2 className={sectionTitle}>Portfolio &amp; results</h2>
                {results.total > 0 ? (
                  <ResultsStrip slug={b.slug} businessName={b.name} data={results} />
                ) : null}
                {b.portfolio.length ? (
                  <div
                    className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0 lg:grid-cols-5"
                    id="photos"
                  >
                    {b.portfolio.map((path) => (
                      // eslint-disable-next-line @next/next/no-img-element -- public storage images, lazy
                      <img
                        key={path}
                        src={mediaUrl(path) ?? ''}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-28 shrink-0 rounded-control object-cover sm:w-full"
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* verified reviews */}
            <section className="flex flex-col gap-3" id="reviews" data-testid="reviews">
              <h2 className={sectionTitle}>Reviews</h2>
              <div className={`${panel} flex flex-col gap-4 p-4`}>
                <RatingBreakdown rating={p.rating} />
                {reviews.length ? (
                  <ReviewList businessId={b.id} businessName={b.name} initial={reviews} />
                ) : (
                  <p className="text-sm text-ink-700">
                    No reviews yet. Only customers with a completed visit can review.
                  </p>
                )}
                <p className="text-xs text-ink-500">
                  Every review comes from a real booking or visit. Businesses can reply but can’t
                  remove reviews.
                </p>
              </div>
            </section>

            {/* important info */}
            <section className="flex flex-col gap-3" id="info">
              <h2 className={sectionTitle}>Important info</h2>
              <div
                className={`${panel} grid divide-y divide-line-200 sm:grid-cols-2 sm:divide-y-0`}
              >
                <Info
                  icon={<IconCash size={20} />}
                  title="Payment"
                  text="Pay at the business (cash)"
                />
                <Info icon={<IconCalendarX size={20} />} title="Cancellation" text={cancelText} />
                <Info
                  icon={<IconPin size={20} />}
                  title="Address"
                  text={
                    [l.address_line, l.floor ? `Floor ${l.floor}` : null, l.area?.en]
                      .filter(Boolean)
                      .join(', ') || '—'
                  }
                  extra={
                    <a
                      className="inline-flex items-center gap-1 font-medium text-accent-600"
                      href={mapsLink(l.lat, l.lng)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <IconNavigate size={14} /> Directions
                    </a>
                  }
                />
                <Info
                  icon={<IconPhone size={20} />}
                  title="Contact"
                  text={l.phone ?? l.whatsapp ?? 'Through the booking page'}
                  extra={
                    <span className="flex gap-3">
                      {l.phone ? (
                        <a className="font-medium text-accent-600" href={`tel:${l.phone}`}>
                          Call
                        </a>
                      ) : null}
                      {wa ? (
                        <a className="font-medium text-accent-600" href={wa}>
                          WhatsApp
                        </a>
                      ) : null}
                    </span>
                  }
                />
              </div>
              <details className={`${panel} group`}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Opening hours
                  <IconChevron
                    size={16}
                    className="rotate-90 transition-transform group-open:-rotate-90"
                  />
                </summary>
                <table className="mx-4 mb-4 text-sm" data-testid="hours">
                  <tbody>
                    {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                      const rows = p.hours.filter((h) => h.weekday === wd);
                      return (
                        <tr key={wd} className={wd === today ? 'font-semibold' : ''}>
                          <td className="py-0.5 pe-6">{WEEKDAY[wd]}</td>
                          <td className="py-0.5">
                            {rows.length
                              ? rows
                                  .map(
                                    (h) =>
                                      `${clockText(h.start)}–${clockText(h.end >= 1440 ? 1439 : h.end)}`,
                                  )
                                  .join(', ')
                              : 'Closed'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </details>
              {b.description ? (
                <details className={`${panel} group`}>
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    About {b.name}
                    <IconChevron
                      size={16}
                      className="rotate-90 transition-transform group-open:-rotate-90"
                    />
                  </summary>
                  <p className="whitespace-pre-line px-4 pb-4 text-sm" dir="auto">
                    {b.description}
                  </p>
                </details>
              ) : null}
            </section>

            <footer className="flex flex-col items-center gap-1 py-4 text-xs text-ink-500">
              <span className="flex gap-3">
                <a href="mailto:support@platform.com?subject=Report%20a%20business">
                  Report this business
                </a>
                <Link href="/terms">Terms</Link>
                <Link href="/privacy">Privacy</Link>
              </span>
            </footer>
          </div>
        </main>

        {/* sticky booking panel (≥ 1024 px) */}
        <aside className="hidden lg:block" aria-label="Book">
          <div className={`${panel} sticky top-24 flex flex-col gap-3.5 p-4`}>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold" dir="auto">
                {b.name}
              </p>
              <p className="text-sm">
                <Rating value={p.rating.display_rating} count={p.rating.review_count} />
              </p>
              {p.price_from !== null ? (
                <p className="text-sm text-ink-700">Services from {money(p.price_from)}</p>
              ) : null}
            </div>
            {bookPanel}
          </div>
        </aside>
      </div>

      {/* sticky Book bar (phones & tablets) */}
      {canBook ? (
        <StickyBookBar watchId="hero-book">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span className="flex min-w-0 flex-1 flex-col text-sm">
              <span className="truncate font-semibold" dir="auto">
                {b.name}
              </span>
              <span className="text-ink-500">
                {p.price_from !== null
                  ? `From ${money(p.price_from)}`
                  : instant
                    ? 'Instant confirmation'
                    : 'Request to book'}
              </span>
            </span>
            <Link
              href={bookHref}
              className="flex h-12 shrink-0 items-center justify-center rounded-control bg-accent-600 px-8 font-semibold text-white"
              data-testid="book-cta"
            >
              Book
            </Link>
          </div>
        </StickyBookBar>
      ) : null}
    </CustomerShell>
  );
}

function Info({
  icon,
  title,
  text,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 p-4">
      <span className="mt-0.5 text-ink-700">{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="font-semibold text-ink-900">{title}</span>
        <span className="text-ink-700" dir="auto">
          {text}
        </span>
        {extra}
      </span>
    </div>
  );
}

function ServiceCard({
  s,
  slug,
  locationId,
  canBook,
  whatsapp,
}: {
  s: PublicService;
  slug: string;
  locationId: string;
  canBook: boolean;
  whatsapp: string | null;
}) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="font-semibold" dir="auto">
          {s.name}
        </span>
        <span className="shrink-0 font-semibold">
          {s.price_type === 'on_consultation' ? '' : priceText(s)}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-sm text-ink-500">
        <IconClock size={15} /> {durationText(s.duration_min)}
        {s.audience !== 'everyone' ? ` · ${AUDIENCE[s.audience]}` : ''}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 pt-0.5">
        {canBook && s.online ? (
          <ServiceNext locationId={locationId} serviceId={s.id} />
        ) : (
          <span className="text-sm text-ink-700">
            {s.price_type === 'on_consultation' ? 'Price on consultation · ' : ''}Ask about
            availability
          </span>
        )}
        <IconChevron size={16} className="text-ink-500 rtl:rotate-180" />
      </span>
    </>
  );
  const cls =
    'flex h-full flex-col gap-1 rounded-card border border-line-200 bg-surface-0 px-3.5 py-3 hover:border-accent-600';
  if (canBook && s.online)
    return (
      <Link
        href={`/${slug}/book?service=${s.id}`}
        className={cls}
        aria-label={`Book ${s.name}`}
        data-testid="service-row"
      >
        {body}
      </Link>
    );
  const wa = waLink(whatsapp, `Hi! I'd like to ask about ${s.name}.`);
  return wa ? (
    <a href={wa} className={cls} data-testid="service-row">
      {body}
    </a>
  ) : (
    <div className={cls} data-testid="service-row">
      {body}
    </div>
  );
}

function ServiceRow({
  s,
  slug,
  canBook,
  whatsapp,
}: {
  s: PublicService;
  slug: string;
  canBook: boolean;
  whatsapp: string | null;
}) {
  const inner = (
    <>
      <span className="min-w-0">
        <span className="block font-medium" dir="auto">
          {s.name}
        </span>
        <span className="text-sm text-ink-500">
          {durationText(s.duration_min)} · {priceText(s)}
        </span>
      </span>
      <span className="shrink-0 text-sm font-medium text-accent-600">
        {canBook && s.online ? 'Choose' : 'Ask'}
      </span>
    </>
  );
  const cls = 'flex min-h-14 items-center justify-between gap-3 py-2';
  if (canBook && s.online)
    return (
      <Link href={`/${slug}/book?service=${s.id}`} className={cls}>
        {inner}
      </Link>
    );
  const wa = waLink(whatsapp, `Hi! I'd like to ask about ${s.name}.`);
  return wa ? (
    <a href={wa} className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
