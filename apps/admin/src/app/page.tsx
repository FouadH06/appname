'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMyAccess, type MyAccess } from '@app/api';
import { supabase } from '@/lib/supabase';

// M4: the gate. Admin screens arrive in M5 (create business) and M9–M11.
export default function AdminHome() {
  const router = useRouter();
  const [access, setAccess] = useState<MyAccess | null>(null);

  useEffect(() => {
    void supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!data.session || data.session.user.is_anonymous) {
          router.replace('/login');
          return;
        }
        const a = await getMyAccess(supabase()).catch(() => null);
        if (!a?.admin_role || !a.admin_mfa_ok) router.replace('/login');
        else setAccess(a);
      });
  }, [router]);

  if (!access) return null;
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">APP_NAME Admin</h1>
      <p className="mt-1 text-ink-700" data-testid="admin-home">
        Signed in as {access.admin_role} (MFA verified).
      </p>
      <button
        type="button"
        className="mt-6 h-10 rounded-control border border-line-200 px-4"
        onClick={() =>
          void supabase()
            .auth.signOut()
            .then(() => router.replace('/login'))
        }
      >
        Sign out
      </button>
    </main>
  );
}
