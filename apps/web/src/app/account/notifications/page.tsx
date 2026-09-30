'use client';

import { NotificationPreferences } from '@/components/account/notification-preferences';
import { Card } from '@/components/card';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { useSession } from '@/lib/session';

// Customer notification preferences (web). The full account area arrives with M8 (C12/C13).
export default function AccountNotificationsPage() {
  const { loading, signedIn } = useSession();
  return (
    <Card customer title="Notifications" subtitle="How we send your booking messages.">
      {loading ? null : signedIn ? (
        <NotificationPreferences />
      ) : (
        <PhoneSignIn onVerified={() => undefined} />
      )}
    </Card>
  );
}
