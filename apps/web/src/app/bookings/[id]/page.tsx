'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { CustomerShell } from '@/components/customer/shell';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { BookingDetail } from '@/components/public/my-booking';
import { useSession } from '@/lib/session';

// C11 success (?new=1) + C13 booking detail
function Detail() {
  const { id } = useParams<{ id: string }>();
  const isNew = useSearchParams().get('new') === '1';
  const { loading, signedIn, session } = useSession();
  return (
    <CustomerShell>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6 lg:py-10">
        {isNew ? null : (
          <Link href="/bookings" className="text-sm font-medium text-accent-600">
            ← My bookings
          </Link>
        )}
        {loading ? null : signedIn ? (
          <BookingDetail id={id} isNew={isNew} phone={session?.user.phone} />
        ) : (
          <div className="rounded-card border border-line-200 bg-surface-0 p-4">
            <p className="mb-3 text-sm text-ink-700">
              Verify the phone number you booked with to see this booking.
            </p>
            <PhoneSignIn onVerified={() => undefined} />
          </div>
        )}
      </main>
    </CustomerShell>
  );
}

export default function BookingDetailPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}
