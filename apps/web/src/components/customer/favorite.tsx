'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { IconHeart } from './icons';

// Favorite ♡ on cards and the business page (M13 RPCs). One favorites load per page for signed-in
// visitors; taps are optimistic and roll back on failure. Signed-out visitors go to sign in.

let cache: Promise<Set<string> | null> | null = null;
const listeners = new Set<() => void>();

function loadFavorites(): Promise<Set<string> | null> {
  cache ??= supabase()
    .auth.getSession()
    .then(async ({ data }) => {
      if (!data.session || data.session.user.is_anonymous) return null;
      const { data: rows } = await supabase().rpc('get_my_favorites');
      return new Set(((rows ?? []) as { business_id: string }[]).map((r) => r.business_id));
    })
    .catch(() => null);
  return cache;
}

export function FavoriteButton({
  businessId,
  name,
  className = '',
  size = 20,
}: {
  businessId: string;
  name: string;
  className?: string;
  size?: number;
}) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const sync = () =>
      void loadFavorites().then((set) => {
        if (alive) setOn(!!set?.has(businessId));
      });
    sync();
    listeners.add(sync);
    return () => {
      alive = false;
      listeners.delete(sync);
    };
  }, [businessId]);

  const toggle = async () => {
    const set = await loadFavorites();
    if (!set) return router.push(`/account?next=${encodeURIComponent(window.location.pathname)}`);
    const was = on;
    setOn(!was);
    setBusy(true);
    const { data, error } = await supabase().rpc('toggle_favorite_business', {
      p_business_id: businessId,
    });
    setBusy(false);
    const now = error ? was : !!(data as { favorited?: boolean } | null)?.favorited;
    setOn(now);
    if (now) set.add(businessId);
    else set.delete(businessId);
    listeners.forEach((l) => l());
  };

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from favorites` : `Save ${name} to favorites`}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      className={`grid size-10 place-items-center rounded-full bg-surface-0/95 text-ink-900 shadow-sm ${on ? 'text-accent-600' : ''} ${className}`}
      data-testid="favorite"
    >
      <IconHeart size={size} filled={on} />
    </button>
  );
}
