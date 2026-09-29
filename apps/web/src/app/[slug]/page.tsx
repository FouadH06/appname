import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Attribution } from '@/components/public/attribution';
import { ResultsStrip } from '@/components/public/results';
import { RatingBreakdown, RatingHeadline, ReviewList } from '@/components/public/reviews';
import {
  BookedBanner,
  NextAvailable,
  OpenNow,
  ShareButton,
  TeamStrip,
} from '@/components/public/islands';
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

// C1 Public business booking page — platform.com/{slug}. Server-rendered and cached for a minute
// (identity, services, hours in the first HTML); availability and "you're booked" load client-side.
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
  if (r.state !== 'ok') return { title: 'APP_NAME' };
  const p = r as BusinessPage;
  const where = p.location.area?.en ? ` in ${p.location.area.en}` : '';
  return {
    title: `${p.business.name} · Book online`,
    description: `${p.business.category?.en ?? 'Book'}${where}. See prices and free times, and book in under a minute.`,
    alternates: { canonical: `/${p.business.slug}` },
  };
}

const card = 'rounded-card border border-line-200 bg-surface-0 p-4';
const action =
  'flex h-11 flex-1 items-center justify-center rounded-control border border-line-200 bg-surface-0 text-sm font-medium';

function groupServices(services: PublicService[]) {
  const popular = services
    .filter((s) => s.popular_rank !== null)
    .sort((a, b) => a.popular_rank! - b.popular_rank!);
  const groups = new Map<string, PublicService[]>();
  for (const s of services) {
    const g = s.group ?? 'Services';
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  return [...(popular.length ? ([['Popular', popular]] as const) : []), ...groups.entries()];
}

export default async function BusinessPageRoute({ params }: Params) {
  const { slug } = await params;
  const p = await load(slug);
  if (p.state !== 'ok') {
    return (
      <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
        <p className="text-ink-700" data-testid="page-unavailable">
          This page isn’t available.
        </p>
      </main>
    );
  }

  const { business: b, location: l } = p;
  const [reviews, results] = await Promise.all([
    getBusinessReviews(b.id, b.slug),
    getBusinessResults(b.id, b.slug, 8),
  ]);
  const cover = mediaUrl(b.cover_path);
  const photoUrls = Object.fromEntries(p.staff.map((s) => [s.id, mediaUrl(s.photo_path)]));
  const bookable = p.services.filter((s) => s.online);
  const topService = bookable
    .slice()
    .sort((a, c) => (a.popular_rank ?? 99) - (c.popular_rank ?? 99))[0];
  const wa = waLink(l.whatsapp, `Hi ${b.name}!`);
  const bookHref = `/${b.slug}/book`;
  const groups = groupServices(p.services);
  const todayIso = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    timeZone: 'Asia/Beirut',
  }).format(new Date());
  const today = WEEKDAY.indexOf(todayIso);

  return (
    <div className="min-h-dvh bg-surface-50 pb-24 lg:pb-8">
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

      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,720px)_1fr] lg:px-4 lg:pt-6">
        <main className="flex min-w-0 flex-col gap-4">
          {/* media header */}
          <div className="relative aspect-video w-full overflow-hidden bg-surface-100 lg:rounded-card">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element -- LCP image from public storage (resized on upload)
              <img
                src={cover}
                alt={b.name}
                fetchPriority="high"
                className="h-full w-full object-cover"
              />
            ) : null}
            {b.portfolio.length ? (
              <a
                href="#photos"
                className="absolute bottom-3 right-3 rounded-full bg-ink-900/70 px-3 py-1 text-xs font-medium text-white"
              >
                +{b.portfolio.length} photos
              </a>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 px-4 lg:px-0">
            {/* identity */}
            <section className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold" dir="auto" data-testid="business-name">
                {b.name}
              </h1>
              <p className="text-sm text-ink-700">
                {b.category?.en}
                {b.price_level ? ` · ${'$'.repeat(b.price_level)}` : ''} · {AUDIENCE[b.audience]}
              </p>
              <p className="text-sm text-ink-700">
                {l.area?.en}
                {l.landmark ? ` · ${l.landmark}` : ''}
              </p>
              <p className="text-sm">
                <OpenNow hours={p.hours} />
              </p>
              <RatingHeadline rating={p.rating} />
            </section>

            {/* quick actions */}
            <div className="flex gap-2">
              {wa ? (
                <a className={action} href={wa}>
                  WhatsApp
                </a>
              ) : null}
              {l.phone ? (
                <a className={action} href={`tel:${l.phone}`}>
                  Call
                </a>
              ) : null}
              <a className={action} href={mapsLink(l.lat, l.lng)} target="_blank" rel="noreferrer">
                Directions
              </a>
              <ShareButton name={b.name} className={action} />
            </div>

            {/* next available */}
            {p.accepting && topService ? (
              <section className={card}>
                <NextAvailable
                  slug={b.slug}
                  locationId={l.id}
                  serviceId={topService.id}
                  serviceName={topService.name}
                  whatsapp={l.whatsapp}
                />
              </section>
            ) : null}

            {/* services */}
            <section className="flex flex-col gap-3" id="services">
              <h2 className="text-lg font-semibold">Services</h2>
              {groups.length > 1 ? (
                <nav className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-surface-50 px-4 py-2 lg:mx-0 lg:px-0">
                  {groups.map(([g]) => (
                    <a
                      key={g}
                      href={`#g-${encodeURIComponent(g)}`}
                      className="whitespace-nowrap rounded-full border border-line-200 bg-surface-0 px-3 py-1 text-sm"
                    >
                      {g}
                    </a>
                  ))}
                </nav>
              ) : null}
              {groups.map(([g, list]) => (
                <div key={g} id={`g-${encodeURIComponent(g)}`} className={card}>
                  <h3 className="mb-2 text-sm font-semibold text-ink-500">{g}</h3>
                  <ul className="flex flex-col divide-y divide-line-200">
                    {list.map((s) => (
                      <li
                        key={`${g}-${s.id}`}
                        className="flex items-center justify-between gap-3 py-3"
                        data-testid="service-row"
                      >
                        <div className="min-w-0">
                          <p className="font-medium" dir="auto">
                            {s.name}
                            {s.audience !== 'everyone' ? (
                              <span className="ms-2 text-xs text-ink-500">
                                {AUDIENCE[s.audience]}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-ink-500">
                            {durationText(s.duration_min)} · {priceText(s)}
                          </p>
                        </div>
                        {!p.accepting ? null : s.online ? (
                          <Link
                            href={`${bookHref}?service=${s.id}`}
                            className="shrink-0 rounded-control bg-accent-600 px-4 py-2 text-sm font-semibold text-white"
                            aria-label={`Book ${s.name}`}
                          >
                            Book
                          </Link>
                        ) : wa ? (
                          <a
                            href={waLink(l.whatsapp, `Hi! I'd like to ask about ${s.name}.`) ?? '#'}
                            className="shrink-0 rounded-control border border-line-200 px-3 py-2 text-sm font-medium"
                          >
                            Ask on WhatsApp
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!bookable.length && p.accepting ? (
                <p className="text-sm text-ink-700">This business takes bookings by WhatsApp.</p>
              ) : null}
            </section>

            {/* team */}
            {p.staff.length ? (
              <section className={card}>
                <h2 className="mb-3 text-lg font-semibold">Team</h2>
                <TeamStrip
                  slug={b.slug}
                  staff={p.staff}
                  photoUrls={photoUrls}
                  services={p.services}
                  canBook={p.accepting}
                />
              </section>
            ) : null}

            {/* customer results (C1 strip; hidden until there are some) */}
            {results.total > 0 ? (
              <section className={`${card} flex flex-col gap-3`} id="results">
                <h2 className="text-lg font-semibold">Customer results</h2>
                <ResultsStrip slug={b.slug} businessName={b.name} data={results} />
              </section>
            ) : null}

            {/* verified reviews */}
            <section className={`${card} flex flex-col gap-3`} id="reviews" data-testid="reviews">
              <h2 className="text-lg font-semibold">Reviews</h2>
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
            </section>

            {/* photos */}
            {b.portfolio.length ? (
              <section className={card} id="photos">
                <h2 className="mb-3 text-lg font-semibold">Photos</h2>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {b.portfolio.map((path) => (
                    // eslint-disable-next-line @next/next/no-img-element -- public storage images, lazy
                    <img
                      key={path}
                      src={mediaUrl(path) ?? ''}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full rounded-control object-cover"
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {/* about */}
            <section className={card}>
              <h2 className="mb-2 text-lg font-semibold">About</h2>
              {b.description ? (
                <p className="mb-3 whitespace-pre-line text-sm" dir="auto">
                  {b.description}
                </p>
              ) : null}
              <p className="text-sm">
                {[l.address_line, l.floor ? `Floor ${l.floor}` : null, l.area?.en]
                  .filter(Boolean)
                  .join(', ')}
              </p>
              {l.landmark ? <p className="text-sm text-ink-500">{l.landmark}</p> : null}
              <a
                className="mt-1 inline-block text-sm font-medium text-accent-600"
                href={mapsLink(l.lat, l.lng)}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Maps
              </a>
              <table className="mt-3 w-full text-sm" data-testid="hours">
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                    const rows = p.hours.filter((h) => h.weekday === wd);
                    return (
                      <tr key={wd} className={wd === today ? 'font-semibold' : ''}>
                        <td className="py-0.5 pe-4">{WEEKDAY[wd]}</td>
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
              {b.instagram ? (
                <a
                  className="mt-3 inline-block text-sm font-medium text-accent-600"
                  href={`https://instagram.com/${b.instagram}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{b.instagram}
                </a>
              ) : null}
            </section>

            <footer className="flex flex-col items-center gap-1 py-4 text-xs text-ink-500">
              <span>Bookings powered by APP_NAME</span>
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

        {/* desktop booking panel */}
        <aside className="hidden lg:block">
          <div className={`${card} sticky top-6 flex flex-col gap-3`}>
            <p className="text-lg font-semibold">Book an appointment</p>
            {p.accepting && bookable.length ? (
              <>
                {topService ? (
                  <NextAvailable
                    slug={b.slug}
                    locationId={l.id}
                    serviceId={topService.id}
                    serviceName={topService.name}
                    whatsapp={l.whatsapp}
                  />
                ) : null}
                <Link
                  href={bookHref}
                  className="flex h-12 items-center justify-center rounded-control bg-accent-600 font-semibold text-white"
                >
                  Book appointment
                </Link>
              </>
            ) : (
              <p className="text-sm text-ink-700">Contact them on WhatsApp or by phone.</p>
            )}
          </div>
        </aside>
      </div>

      {/* sticky CTA (mobile) */}
      {p.accepting && bookable.length ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line-200 bg-surface-0 p-3 lg:hidden">
          <Link
            href={bookHref}
            className="flex h-12 items-center justify-between rounded-control bg-accent-600 px-4 font-semibold text-white"
            data-testid="book-cta"
          >
            <span className="text-sm font-normal">
              {p.price_from !== null ? `from ${money(p.price_from)}` : ''}
            </span>
            <span>Book appointment</span>
            <span className="w-12" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
