'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Calls `onChange` (debounced) when any booking of the business changes (Phase 3 Part 6 §3.4):
 * Realtime on booking_items + bookings, filtered by business and by RLS (staff only receive their
 * own items). Payloads are ignored; screens refetch through the role-projected RPCs. A slow
 * refresh and a refresh on tab focus cover dropped connections.
 */
export function useBookingChanges(businessId: string, onChange: () => void) {
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  });
  useEffect(() => {
    const client = supabase();
    let t: number | undefined;
    const fire = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => ref.current(), 150);
    };
    const filter = `business_id=eq.${businessId}`;
    const channel = client
      .channel(`biz-bookings-${businessId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'booking_items', filter },
        fire,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'bookings', filter },
        fire,
      )
      .subscribe();
    const poll = window.setInterval(fire, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      void client.removeChannel(channel);
    };
  }, [businessId]);
}

/** Browser online/offline state for the "Offline — read only" banner. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
