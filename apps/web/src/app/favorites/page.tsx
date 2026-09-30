'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BusinessCard } from '@/components/customer/cards';
import { container } from '@/components/customer/layout';
import { CustomerShell } from '@/components/customer/shell';
import { PhoneSignIn } from '@/components/phone-sign-in';
import type { SearchCard } from '@/lib/public/search';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// C14 Favorites · Places (web, UX pass nav target). Same M13 RPC as the app; places that stopped
// taking bookings stay listed, dimmed, until removed with ♡.

interface Favorite {
  business_id: string;
  slug: string;
  name: string;
  state: 'ok' | 'unavailable';
  area: string | null;
  display_rating: number | null;
  review_count: number;
  cover_path: string | null;
  next_available_at: string | null;
}

const asCard = (f: Favorite): SearchCard => ({
  location_id: f.business_id,
  business_id: f.business_id,
  slug: f.slug,
  name: f.name,
  area: f.area,
  cluster_id: null,
  km: null,
  display_rating: f.display_rating,
  review_count: f.review_count,
  price_level: null,
  cover_path: f.cover_path,
  next_available_at: f.state === 'ok' ? f.next_available_at : null,
  labels: [],
  service: null,
});

export default function FavoritesPage() {
  const { loading, signedIn } = useSession();
  const [rows, setRows] = useState<Favorite[] | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void supabase()
      .rpc('get_my_favorites')
      .then(({ data }) => alive && setRows((data as unknown as Favorite[]) ?? []));
    return () => {
      alive = false;
    };
  }, [signedIn]);

  return (
    <CustomerShell>
      <main className={`${container} flex flex-col gap-4 py-6 lg:py-10`}>
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Favorites</h1>
        {loading ? null : !signedIn ? (
          <div className="max-w-md rounded-card border border-line-200 bg-surface-0 p-4">
            <p className="mb-3 text-sm text-ink-700">
              Verify your phone to save places and see them on any device.
            </p>
            <PhoneSignIn onVerified={() => undefined} />
          </div>
        ) : rows === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-72 animate-pulse rounded-card bg-surface-100" />
            ))}
          </div>
        ) : !rows.length ? (
          <div
            className="flex max-w-md flex-col gap-3 rounded-card border border-line-200 bg-surface-0 p-4 text-sm"
            data-testid="favorites-empty"
          >
            <p className="text-ink-700">Tap ♡ on a place to save it here.</p>
            <Link href="/search" className="font-medium text-accent-600">
              Find a place →
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((f) => (
              <div
                key={f.business_id}
                className={f.state === 'ok' ? '' : 'opacity-60'}
                data-testid="favorite-row"
              >
                <BusinessCard c={asCard(f)} />
                {f.state !== 'ok' ? (
                  <p className="mt-1 text-xs text-ink-500">Not taking bookings right now</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </main>
    </CustomerShell>
  );
}
