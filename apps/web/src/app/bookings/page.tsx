'use client';

import { useEffect, useState } from 'react';
import { claimVisits, dismissClaimableVisits, getClaimableVisits, type ClaimOffer } from '@app/api';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { BookingCard } from '@/components/public/my-booking';
import type { MyBooking } from '@/lib/public/types';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// C12 My bookings (web): phone code to see them; upcoming first, then past.
export default function MyBookingsPage() {
  const { loading, signedIn } = useSession();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [rows, setRows] = useState<{ tab: string; list: MyBooking[] } | null>(null);
  const [offers, setOffers] = useState<ClaimOffer[]>([]);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void supabase()
      .rpc('get_my_bookings', { p_scope: tab })
      .then(({ data }) => alive && setRows({ tab, list: (data as unknown as MyBooking[]) ?? [] }));
    return () => {
      alive = false;
    };
  }, [signedIn, tab]);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void getClaimableVisits(supabase())
      .then((o) => alive && setOffers(o ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const list = rows?.tab === tab ? rows.list : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">My bookings</h1>
      {loading ? null : !signedIn ? (
        <div className="rounded-card border border-line-200 bg-surface-0 p-4">
          <p className="mb-3 text-sm text-ink-700">
            Verify your phone number to see your bookings.
          </p>
          <PhoneSignIn onVerified={() => undefined} />
        </div>
      ) : (
        <>
          {offers.length ? (
            <section
              className="flex flex-col gap-2 rounded-card border border-accent-600 bg-surface-0 p-4"
              data-testid="claim-offers"
            >
              <p className="font-medium">We found previous visits booked with your number</p>
              <ul className="text-sm">
                {offers.map((o) => (
                  <li key={o.business_id}>
                    {o.business_name} · {o.visit_count} visit{o.visit_count === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="h-10 flex-1 rounded-control bg-accent-600 text-sm font-semibold text-white"
                  onClick={() =>
                    void claimVisits(
                      supabase(),
                      offers.map((o) => o.business_id),
                    ).then(() => {
                      setOffers([]);
                      setRows(null);
                    })
                  }
                >
                  Add them to my account
                </button>
                <button
                  type="button"
                  className="h-10 flex-1 rounded-control border border-line-200 text-sm"
                  onClick={() =>
                    void dismissClaimableVisits(
                      supabase(),
                      offers.map((o) => o.business_id),
                    ).then(() => setOffers([]))
                  }
                >
                  Not now
                </button>
              </div>
            </section>
          ) : null}
          <div
            className="flex rounded-control border border-line-200 bg-surface-0 p-1"
            role="tablist"
          >
            {(['upcoming', 'past'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`h-9 flex-1 rounded-control text-sm font-medium ${tab === t ? 'bg-accent-600 text-white' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'upcoming' ? 'Upcoming' : 'Past'}
              </button>
            ))}
          </div>
          {list === null ? <p className="text-sm text-ink-500">Loading…</p> : null}
          {list && !list.length ? (
            <p className="text-sm text-ink-700">
              {tab === 'upcoming' ? 'No upcoming bookings.' : 'Your past visits will appear here.'}
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {(list ?? []).map((b) => (
              <li key={b.id}>
                <BookingCard b={b} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
