'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { BizShell } from '@/components/biz/shell';
import { BizProvider } from '@/lib/biz/context';

function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return null;
}

export function BizLayoutClient({
  businessId,
  children,
}: {
  businessId: string;
  children: ReactNode;
}) {
  return (
    <BizProvider
      businessId={businessId}
      fallback={(state) =>
        state === 'signed_out' ? (
          <Redirect to="/biz/login" />
        ) : state === 'forbidden' ? (
          <main className="mx-auto max-w-md p-6 text-sm">
            <p>You don&apos;t have access to this business.</p>
            <Link href="/biz" className="mt-3 inline-block text-accent-600">
              Your businesses
            </Link>
          </main>
        ) : (
          <div className="p-6 text-sm text-ink-500">Loading…</div>
        )
      }
    >
      <BizShell>{children}</BizShell>
    </BizProvider>
  );
}
