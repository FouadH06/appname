'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Card } from '@/components/card';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { t } from '@/lib/copy';
import { useSession } from '@/lib/session';

export default function BusinessLoginPage() {
  const router = useRouter();
  const { loading, signedIn } = useSession();

  useEffect(() => {
    if (!loading && signedIn) router.replace('/biz');
  }, [loading, signedIn, router]);

  return (
    <Card title={t.pages.bizLogin.title} subtitle={t.pages.bizLogin.subtitle}>
      {loading || signedIn ? null : <PhoneSignIn onVerified={() => router.replace('/biz')} />}
    </Card>
  );
}
