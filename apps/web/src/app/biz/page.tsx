'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMyAccess, type MyAccess } from '@app/api';
import { Card, secondaryButton } from '@/components/card';
import { describeError, format, t } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// M4: who you are and where you work. The dashboard itself is M5.
export default function BusinessHomePage() {
  const router = useRouter();
  const { loading, signedIn } = useSession();
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!signedIn) {
      router.replace('/biz/login');
      return;
    }
    getMyAccess(supabase())
      .then(setAccess)
      .catch((e: { code?: string }) => setError(describeError(e.code ?? 'UNKNOWN')));
  }, [loading, signedIn, router]);

  return (
    <Card
      title={t.pages.biz.title}
      subtitle={
        access?.phone_hint ? format(t.pages.biz.signedInAs, { phone: access.phone_hint }) : null
      }
    >
      {error ? <p className="text-sm text-danger-600">{error}</p> : null}
      {access && access.memberships.length === 0 ? (
        <p className="text-sm text-ink-700" data-testid="no-memberships">
          {t.pages.biz.empty}
        </p>
      ) : null}
      {access && access.memberships.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="memberships">
          {access.memberships.map((m) => (
            <li key={m.business_id}>
              <Link
                href={`/biz/${m.business_id}`}
                className="flex items-center justify-between rounded-control border border-line-200 p-3 hover:bg-surface-50"
              >
                <span className="font-medium text-ink-900">{m.business_name}</span>
                <span className="text-sm text-ink-500">{t.roles[m.role]}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className={secondaryButton}
        onClick={() =>
          void supabase()
            .auth.signOut()
            .then(() => router.replace('/biz/login'))
        }
      >
        {t.auth.signOut}
      </button>
    </Card>
  );
}
