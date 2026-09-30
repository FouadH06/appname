'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

// "Use my location": asks only on tap (never on page load); adds lat/lng to the URL for distance and
// "Nearest". Denied → nothing changes (the cluster stays the fallback).
export function UseMyLocation() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [state, setState] = useState<'idle' | 'asking' | 'denied'>('idle');
  return (
    <button
      type="button"
      className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-line-200 bg-surface-0 px-4 text-sm font-medium hover:border-accent-600"
      disabled={state === 'asking'}
      onClick={() => {
        if (!navigator.geolocation) return setState('denied');
        setState('asking');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const p = new URLSearchParams(params.toString());
            p.set('lat', pos.coords.latitude.toFixed(5));
            p.set('lng', pos.coords.longitude.toFixed(5));
            router.push(`${path}?${p.toString()}`);
          },
          () => setState('denied'),
          { timeout: 8000, maximumAge: 600_000 },
        );
      }}
    >
      {state === 'denied'
        ? 'Location unavailable'
        : state === 'asking'
          ? 'Locating…'
          : '📍 Near me'}
    </button>
  );
}
