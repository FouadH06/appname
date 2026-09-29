'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMyAccess, type MyAccess } from '@app/api';
import { supabase } from './supabase';

/** Admin screens: signed in, admin role in `roles` (superadmin always), MFA verified — else /login. */
export function useAdminGate(roles: string[]): MyAccess | null {
  const router = useRouter();
  const [access, setAccess] = useState<MyAccess | null>(null);
  const key = roles.join(',');
  useEffect(() => {
    void getMyAccess(supabase())
      .catch(() => null)
      .then((a) => {
        const ok =
          a?.admin_mfa_ok &&
          (a.admin_role === 'superadmin' || key.split(',').includes(a.admin_role ?? ''));
        if (!ok) router.replace('/login');
        else setAccess(a);
      });
  }, [router, key]);
  return access;
}

export const MODERATION_ROLES = ['moderator', 'support'];
