'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Tables } from '@app/db';
import { getMyAccess } from '@app/api';
import { supabase } from '@/lib/supabase';

export type Role = 'owner' | 'manager' | 'reception' | 'staff';

export interface BizState {
  business: Tables<'businesses'>;
  location: Tables<'business_locations'> | null;
  settings: Tables<'business_settings'> | null;
  role: Role;
  refresh: () => Promise<void>;
}

const Ctx = createContext<BizState | null>(null);

export function useBiz(): BizState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBiz outside BizProvider');
  return v;
}

/** Owner and manager can change setup (services, staff, hours, settings); Part 1 §6.3. */
export const canManage = (role: Role) => role === 'owner' || role === 'manager';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'signed_out' }
  | { kind: 'forbidden' }
  | { kind: 'ready'; value: Omit<BizState, 'refresh'> };

async function loadBusiness(businessId: string): Promise<LoadState> {
  const client = supabase();
  const { data: s } = await client.auth.getSession();
  if (!s.session || s.session.user.is_anonymous) return { kind: 'signed_out' };
  const access = await getMyAccess(client).catch(() => null);
  const membership = access?.memberships.find((m) => m.business_id === businessId);
  if (!membership) return { kind: 'forbidden' };
  const [biz, loc, set] = await Promise.all([
    client.from('businesses').select('*').eq('id', businessId).single(),
    client
      .from('business_locations')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at')
      .limit(1)
      .maybeSingle(),
    client.from('business_settings').select('*').eq('business_id', businessId).maybeSingle(),
  ]);
  if (biz.error || !biz.data) return { kind: 'forbidden' };
  return {
    kind: 'ready',
    value: {
      business: biz.data,
      location: loc.data ?? null,
      settings: set.data ?? null,
      role: membership.role,
    },
  };
}

export function BizProvider({
  businessId,
  children,
  fallback,
}: {
  businessId: string;
  children: ReactNode;
  fallback: (state: 'loading' | 'signed_out' | 'forbidden') => ReactNode;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setState(await loadBusiness(businessId));
  }, [businessId]);

  useEffect(() => {
    let alive = true;
    void loadBusiness(businessId).then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [businessId]);

  if (state.kind !== 'ready') return <>{fallback(state.kind)}</>;
  return <Ctx.Provider value={{ ...state.value, refresh }}>{children}</Ctx.Provider>;
}
