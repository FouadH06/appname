'use client';

import { useEffect } from 'react';

/** Remembers where the visitor came from (utm_*, referrer) for the booking's attribution. */
export function Attribution() {
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem('app:attribution')) return;
      const q = new URLSearchParams(window.location.search);
      const a: Record<string, string> = {};
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'src']) {
        const v = q.get(k);
        if (v) a[k] = v.slice(0, 100);
      }
      if (document.referrer) a.referrer = new URL(document.referrer).hostname;
      window.sessionStorage.setItem('app:attribution', JSON.stringify(a));
    } catch {
      // storage blocked (some in-app browsers): attribution is best effort
    }
  }, []);
  return null;
}
