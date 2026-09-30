'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { whenText } from '@/lib/public/format';
import { supabase } from '@/lib/supabase';
import { IconBack, IconCalendar, IconChevron, IconImage, IconShare } from './icons';

// Client pieces of the business profile (UX pass): the photo gallery with its counter, and the
// "next free time" for a service (read from the availability engine, never assumed).

export function Gallery({ images, name }: { images: string[]; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  if (!images.length)
    return (
      <div className="aspect-[3/2] w-full bg-surface-100 md:aspect-auto md:h-[250px] lg:h-[240px] xl:h-[280px] lg:rounded-card" />
    );
  return (
    <div className="relative">
      <div
        ref={ref}
        className="rail rail-flush flex aspect-[3/2] w-full snap-x snap-mandatory overflow-x-auto md:aspect-auto md:h-[250px] md:gap-1 lg:h-[240px] xl:h-[280px] lg:rounded-card"
        onScroll={(e) => {
          // tablets/desktops show two photos side by side: step by one photo, not one viewport
          const el = e.currentTarget;
          const step = (el.firstElementChild as HTMLElement | null)?.offsetWidth || el.clientWidth;
          setIndex(Math.round(Math.abs(el.scrollLeft) / step));
        }}
        aria-label={`${name} photos`}
        data-testid="gallery"
      >
        {images.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- public storage images (≤1600 px, first one is the LCP)
          <img
            key={src}
            src={src}
            alt={i === 0 ? name : ''}
            loading={i === 0 ? 'eager' : 'lazy'}
            fetchPriority={i === 0 ? 'high' : undefined}
            className={`h-full w-full shrink-0 snap-start object-cover ${images.length > 1 ? 'md:w-[calc(50%-2px)]' : ''}`}
          />
        ))}
      </div>
      {images.length > 1 ? (
        <span
          className="absolute bottom-3 end-3 flex items-center gap-1.5 rounded-full bg-ink-900/70 px-3 py-1 text-xs font-medium text-white"
          aria-hidden
        >
          <IconImage size={14} /> {index + 1}/{images.length}
        </span>
      ) : null}
    </div>
  );
}

export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
      aria-label="Back"
      className="grid size-10 place-items-center rounded-full bg-surface-0/95 text-ink-900 shadow-sm"
    >
      <IconBack size={20} className="rtl:rotate-180" />
    </button>
  );
}

export function ShareIconButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? 'Link copied' : 'Share'}
      className="grid size-10 place-items-center rounded-full bg-surface-0/95 text-ink-900 shadow-sm"
      onClick={() => {
        const url = window.location.href.split('?')[0]!;
        if (navigator.share) void navigator.share({ title: name, url }).catch(() => undefined);
        else
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          });
      }}
    >
      <IconShare size={19} />
    </button>
  );
}

function useNext(locationId: string, serviceId: string | null) {
  const [next, setNext] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!serviceId) return;
    let alive = true;
    void supabase()
      .rpc('get_next_available', { p_location_id: locationId, p_service_id: serviceId })
      .then(({ data, error }) => {
        if (alive) setNext(error ? null : ((data as string | null) ?? null));
      });
    return () => {
      alive = false;
    };
  }, [locationId, serviceId]);
  return next;
}

/** "Next available: Today 4:30 PM ›" — opens the booking flow on that time. */
export function NextAvailableRow({
  slug,
  locationId,
  serviceId,
}: {
  slug: string;
  locationId: string;
  serviceId: string;
}) {
  const next = useNext(locationId, serviceId);
  const href = next
    ? `/${slug}/book?service=${serviceId}&start=${encodeURIComponent(next)}`
    : `/${slug}/book?service=${serviceId}`;
  return (
    <Link
      href={href}
      className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-control bg-accent-50 px-3 text-sm hover:bg-accent-100"
      data-testid="next-available"
    >
      <IconCalendar size={18} className="shrink-0 text-accent-600" />
      <span className="min-w-0 flex-1 truncate">
        {next === undefined ? (
          <span className="inline-block h-4 w-40 animate-pulse rounded bg-accent-100 align-middle" />
        ) : next ? (
          <>
            <span className="hidden sm:inline">Next available: </span>
            <span className="sm:hidden">Next </span>
            <span className="font-semibold text-ink-900">{whenText(next)}</span>
          </>
        ) : (
          'See available times'
        )}
      </span>
      <IconChevron size={16} className="shrink-0 text-accent-600 rtl:rotate-180" />
    </Link>
  );
}

/** Per-service "Next 4:30 PM" chip inside a service card. */
export function ServiceNext({ locationId, serviceId }: { locationId: string; serviceId: string }) {
  const next = useNext(locationId, serviceId);
  if (next === undefined)
    return <span className="inline-block h-6 w-28 animate-pulse rounded-full bg-accent-50" />;
  if (!next) return <span className="text-[13px] text-ink-500">No free times soon</span>;
  return (
    <span
      className="rounded-full bg-accent-50 px-2.5 py-0.5 text-[13px] font-medium text-accent-600"
      data-testid="service-next"
    >
      Next {whenText(next)}
    </span>
  );
}

/** Phones/tablets: the Book bar slides in once the header's Book button has scrolled away. */
export function StickyBookBar({
  watchId,
  children,
}: {
  watchId: string;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = document.getElementById(watchId);
    if (!el || typeof IntersectionObserver === 'undefined') {
      const t = window.setTimeout(() => setShow(true), 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(([e]) => setShow(!e!.isIntersecting), {
      rootMargin: '-64px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [watchId]);
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-20 border-t border-line-200 bg-surface-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 transition-transform duration-200 lg:hidden ${show ? 'translate-y-0' : 'translate-y-full'}`}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}
