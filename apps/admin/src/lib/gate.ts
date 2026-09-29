'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMyAccess, type MyAccess } from '@app/api';
import { supabase } from './supabase';

/** Admin screens: signed in, admin role in `roles` (superadmin always), MFA verified — else /login. */
export function useAdminGate(roles: readonly string[]): MyAccess | null {
  const router = useRouter();
  const [access, setAccess] = useState<MyAccess | null>(null);
  const key = roles.join(',');
  useEffect(() => {
    void getMyAccess(supabase())
      .catch(() => null)
      .then((a) => {
        const ok = a?.admin_mfa_ok && canSee(a.admin_role, key ? key.split(',') : []);
        if (!ok) router.replace(a?.admin_mfa_ok ? '/' : '/login');
        else setAccess(a);
      });
  }, [router, key]);
  return access;
}

/** superadmin sees everything; an empty list means "any admin". The backend enforces the same rules. */
export function canSee(role: string | null | undefined, roles: readonly string[]): boolean {
  if (!role) return false;
  return role === 'superadmin' || roles.length === 0 || roles.includes(role);
}

// Who may open which area (Phase 2 Part 4 · mirrors the backend role checks)
export const ANY_ADMIN: readonly string[] = [];
export const MODERATION_ROLES = ['moderator', 'support'] as const;
export const BUSINESS_ROLES = ['moderator', 'support', 'ops'] as const;
export const CUSTOMER_ROLES = ['support'] as const;
export const REVIEW_ROLES = ['moderator', 'support'] as const;
export const DISPUTE_ROLES = ['support'] as const;
export const CATALOG_ROLES = ['ops'] as const;
export const RANKING_ROLES = ['ops'] as const; // read; drafts / publish are superadmin only
