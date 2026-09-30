'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  IconBell,
  IconCalendar,
  IconChevron,
  IconHeart,
  IconUser,
} from '@/components/customer/icons';
import { CustomerShell } from '@/components/customer/shell';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// Profile (web, UX pass nav target): sign in with a phone code, then the customer's account links.
// Lean on purpose — the full account area (reviews, deletion) lives in the app and the existing pages.

function Account() {
  const { loading, signedIn, session } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn || !session) return;
    let alive = true;
    void supabase()
      .from('profiles')
      .select('first_name,last_name')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(
        ({ data }) =>
          alive && setName([data?.first_name, data?.last_name].filter(Boolean).join(' ') || null),
      );
    return () => {
      alive = false;
    };
  }, [signedIn, session]);

  const row = 'flex min-h-14 items-center gap-4 px-4 hover:bg-surface-50';
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6 sm:px-6 lg:py-10">
      <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Profile</h1>
      {loading ? null : !signedIn ? (
        <div className="rounded-card border border-line-200 bg-surface-0 p-4">
          <p className="mb-3 text-sm text-ink-700">
            Verify your phone to see your bookings, favorites and messages.
          </p>
          <PhoneSignIn
            onVerified={() => (next && next.startsWith('/') ? router.push(next) : undefined)}
          />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-card border border-line-200 bg-surface-0 p-4">
            <span className="grid size-14 place-items-center rounded-full bg-accent-50 text-accent-600">
              <IconUser size={26} />
            </span>
            <span className="flex flex-col">
              <span className="font-semibold">{name ?? 'Your account'}</span>
              <span className="text-sm text-ink-500">
                {session?.user.phone ? `+${session.user.phone}` : ''}
              </span>
            </span>
          </div>
          <nav className="divide-y divide-line-200 overflow-hidden rounded-card border border-line-200 bg-surface-0">
            {(
              [
                ['/bookings', 'My bookings', IconCalendar],
                ['/favorites', 'Favorites', IconHeart],
                ['/account/notifications', 'Notifications', IconBell],
              ] as const
            ).map(([href, label, Icon]) => (
              <Link key={href} href={href} className={row}>
                <Icon size={20} className="text-accent-600" />
                <span className="flex-1 font-medium">{label}</span>
                <IconChevron size={18} className="text-ink-500 rtl:rotate-180" />
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-500">
            <Link href="/biz" className="hover:underline">
              For businesses
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="hover:underline">
              Privacy
            </Link>
          </div>
          <button
            type="button"
            className="h-12 rounded-control border border-line-200 bg-surface-0 font-medium hover:border-danger-600 hover:text-danger-600"
            onClick={() =>
              void supabase()
                .auth.signOut()
                .then(() => router.push('/'))
            }
          >
            Sign out
          </button>
        </>
      )}
    </main>
  );
}

export default function AccountPage() {
  return (
    <CustomerShell>
      <Suspense fallback={null}>
        <Account />
      </Suspense>
    </CustomerShell>
  );
}
