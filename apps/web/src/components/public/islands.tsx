'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { dateTimeText, dayText, openState, timeText, waLink } from '@/lib/public/format';
import type { BusinessPage, PublicStaff } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';
import { beirutParts } from '@/lib/biz/schedule';

// Small client pieces of the (server-rendered, cached) business page: anything that depends on
// the current time or on who is looking.

const beirutDate = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

export function OpenNow({ hours }: { hours: BusinessPage['hours'] }) {
  const [state, setState] = useState<{ open: boolean; text: string } | null>(null);
  useEffect(() => {
    const tick = () => setState(openState(hours, new Date().toISOString()));
    const t = window.setTimeout(tick, 0);
    const i = window.setInterval(tick, 60_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(i);
    };
  }, [hours]);
  if (!state) return <span className="text-ink-500">&nbsp;</span>;
  return (
    <span
      className={state.open ? 'font-medium text-success-600' : 'text-ink-700'}
      data-testid="open-now"
    >
      {state.text}
    </span>
  );
}

/** "Earliest: Today 4:30 PM · 5:00 · 6:15" for the most-booked service (C1 §4.4). */
export function NextAvailable({
  slug,
  locationId,
  serviceId,
  serviceName,
  whatsapp,
}: {
  slug: string;
  locationId: string;
  serviceId: string;
  serviceName: string;
  whatsapp: string | null;
}) {
  const [slots, setSlots] = useState<string[] | null | 'error'>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void supabase()
      .rpc('get_available_slots', {
        p_location_id: locationId,
        p_service_id: serviceId,
        p_date_from: beirutDate(0),
        p_date_to: beirutDate(13),
      })
      .then(({ data, error }) => {
        if (!alive) return;
        setSlots(error ? 'error' : (data ?? []).map((r) => r.slot_start).slice(0, 3));
      });
    return () => {
      alive = false;
    };
  }, [locationId, serviceId, attempt]);

  if (slots === null) {
    return (
      <div className="flex gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-10 w-24 animate-pulse rounded-full bg-surface-100" />
        ))}
      </div>
    );
  }
  if (slots === 'error') {
    return (
      <p className="text-sm text-ink-700">
        Couldn’t load times ·{' '}
        <button
          type="button"
          className="font-medium text-accent-600"
          onClick={() => setAttempt((a) => a + 1)}
        >
          Retry
        </button>
      </p>
    );
  }
  if (!slots.length) {
    const wa = waLink(whatsapp, `Hi! Do you have a time for ${serviceName}?`);
    return (
      <p className="text-sm text-ink-700">
        Fully booked for the next 2 weeks.{' '}
        {wa ? (
          <a className="font-medium text-accent-600" href={wa}>
            Ask on WhatsApp
          </a>
        ) : null}
      </p>
    );
  }
  const today = beirutDate(0);
  return (
    <div className="flex flex-col gap-2" data-testid="next-available">
      <p className="text-sm text-ink-700">
        Earliest for <span className="font-medium text-ink-900">{serviceName}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {slots.map((s, i) => {
          const d = beirutParts(s).date;
          const label =
            i === 0 ? `${d === today ? 'Today' : dayText(s)} ${timeText(s)}` : timeText(s);
          return (
            <Link
              key={s}
              href={`/${slug}/book?service=${serviceId}&start=${encodeURIComponent(s)}`}
              className="rounded-full border border-accent-600 px-4 py-2 text-sm font-medium text-accent-600"
            >
              {label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** "You're booked Thu 4:30 PM · Manage" for a returning signed-in visitor. */
export function BookedBanner({ businessId }: { businessId: string }) {
  const [b, setB] = useState<{ id: string; starts_at: string; status: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!data.session || data.session.user.is_anonymous) return;
        const { data: r } = await supabase().rpc('get_my_next_booking_at', {
          p_business_id: businessId,
        });
        if (alive && r) setB(r as { id: string; starts_at: string; status: string });
      });
    return () => {
      alive = false;
    };
  }, [businessId]);
  if (!b) return null;
  return (
    <Link
      href={`/bookings/${b.id}`}
      className="block bg-success-600 px-4 py-2 text-center text-sm font-medium text-white"
      data-testid="booked-banner"
    >
      {b.status === 'pending' ? 'Request sent for' : 'You’re booked'} {dateTimeText(b.starts_at)} ·
      Manage
    </Link>
  );
}

export function ShareButton({ name, className }: { name: string; className: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
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
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}

/** Team strip + staff profile sheet (C8a) with "Book with {name}". */
export function TeamStrip({
  slug,
  staff,
  photoUrls,
  services,
  canBook,
}: {
  slug: string;
  staff: PublicStaff[];
  photoUrls: Record<string, string | null>;
  services: BusinessPage['services'];
  canBook: boolean;
}) {
  const [open, setOpen] = useState<PublicStaff | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const theirs = open ? services.filter((s) => s.online && s.staff_ids.includes(open.id)) : [];
  return (
    <>
      <ul className="flex gap-4 overflow-x-auto pb-1" data-testid="team">
        {staff.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="flex w-20 flex-col items-center gap-1 text-center"
              onClick={() => setOpen(s)}
            >
              <Avatar name={s.name} url={photoUrls[s.id] ?? null} size="size-16" />
              <span className="line-clamp-1 text-sm font-medium">{s.name.split(' ')[0]}</span>
              {s.role_title ? (
                <span className="line-clamp-1 text-xs text-ink-500">{s.role_title}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 md:items-center"
          onClick={() => setOpen(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={open.name}
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface-0 p-5 md:rounded-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <Avatar name={open.name} url={photoUrls[open.id] ?? null} size="size-16" />
              <div>
                <h3 className="text-lg font-semibold">{open.name}</h3>
                {open.role_title ? <p className="text-sm text-ink-500">{open.role_title}</p> : null}
                <p className="text-xs text-ink-500">New to APP_NAME</p>
              </div>
            </div>
            {open.bio ? (
              <p className="mt-3 text-sm" dir="auto">
                {open.bio}
              </p>
            ) : null}
            {open.specialties.length ? (
              <p className="mt-3 text-sm">
                <span className="text-ink-500">Specialties: </span>
                {open.specialties.join(' · ')}
              </p>
            ) : null}
            {theirs.length ? (
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {theirs.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-5 flex gap-2">
              {canBook && theirs.length ? (
                <Link
                  href={`/${slug}/book?staff=${open.id}${theirs.length === 1 ? `&service=${theirs[0]!.id}` : ''}`}
                  className="flex h-12 flex-1 items-center justify-center rounded-control bg-accent-600 font-semibold text-white"
                >
                  Book with {open.name.split(' ')[0]}
                </Link>
              ) : null}
              <button
                type="button"
                className="h-12 rounded-control border border-line-200 px-4"
                onClick={() => setOpen(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function Avatar({
  name,
  url,
  size = 'size-10',
}: {
  name: string;
  url: string | null;
  size?: string;
}) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- public storage image, already resized on upload
    return <img src={url} alt="" loading="lazy" className={`${size} rounded-full object-cover`} />;
  }
  return (
    <span
      className={`${size} grid place-items-center rounded-full bg-surface-100 text-lg font-semibold text-ink-700`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
