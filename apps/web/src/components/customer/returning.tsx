'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { coverUrl, whenText } from '@/lib/public/format';
import type { MyBooking } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';
import { IconChevron } from './icons';

// Returning-customer modules on Home (simple personalization only): the next booking and "Book again"
// from the last completed visit (M13 get_rebook_suggestions). Nothing renders for new visitors.

interface Rebook {
  slug: string;
  business: string;
  service_id: string;
  service: string;
  staff_id: string | null;
  staff: string | null;
  last_visit_at: string;
  cover_path: string | null;
}

const ago = (iso: string) => {
  const d = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  if (d < 1) return 'today';
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.round(d / 7);
  return w < 9 ? `${w} weeks ago` : `${Math.round(d / 30)} months ago`;
};

export function ReturningModules() {
  const [next, setNext] = useState<MyBooking | null>(null);
  const [again, setAgain] = useState<Rebook | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!data.session || data.session.user.is_anonymous) return;
        const [b, r] = await Promise.all([
          supabase().rpc('get_my_bookings', { p_scope: 'upcoming' }),
          supabase().rpc('get_rebook_suggestions', { p_limit: 1 }),
        ]);
        if (!alive) return;
        const list = ((b.data as unknown as MyBooking[] | null) ?? []).filter(
          (x) => x.status === 'confirmed' || x.status === 'pending',
        );
        setNext(list[0] ?? null);
        setAgain(((r.data as unknown as Rebook[] | null) ?? [])[0] ?? null);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!next && !again) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="returning">
      {next ? (
        <Link
          href={`/bookings/${next.id}`}
          className="flex flex-col gap-3 rounded-card bg-accent-600 p-4 text-white hover:bg-accent-700"
          data-testid="next-booking"
        >
          <span className="flex items-center justify-between text-base font-semibold">
            {next.status === 'pending' ? 'Your request' : 'Your next booking'}
            <IconChevron size={18} className="rtl:rotate-180" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm text-white/80">{whenText(next.starts_at)}</span>
            <span className="text-lg font-semibold">{next.service_name}</span>
            <span className="text-sm text-white/80">
              {next.business.name} · with {next.staff_first_name}
            </span>
          </span>
        </Link>
      ) : null}
      {again ? (
        <div
          className="flex items-center gap-3 rounded-card border border-line-200 bg-surface-0 p-4"
          data-testid="book-again"
        >
          <span className="size-14 shrink-0 overflow-hidden rounded-full bg-surface-100">
            {again.cover_path ? (
              // eslint-disable-next-line @next/next/no-img-element -- small public image
              <img
                src={coverUrl(again.cover_path, 120) ?? ''}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-semibold text-ink-900">Book again</span>
            <span className="line-clamp-1 text-sm text-ink-700">
              {again.service}
              {again.staff ? ` with ${again.staff}` : ''} · {again.business}
            </span>
            <span className="text-xs text-ink-500">Last visit {ago(again.last_visit_at)}</span>
          </span>
          <Link
            href={`/${again.slug}/book?service=${again.service_id}${again.staff_id ? `&staff=${again.staff_id}` : ''}`}
            className="flex h-10 shrink-0 items-center rounded-full border border-accent-600 px-4 text-sm font-semibold text-accent-600 hover:bg-accent-50"
            data-testid="rebook"
          >
            Rebook
          </Link>
        </div>
      ) : null}
    </div>
  );
}
