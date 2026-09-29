'use client';

import { use } from 'react';
import { Card } from '@/components/card';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { ReviewForm } from '@/components/public/review-form';
import { useSession } from '@/lib/session';

// C15 from the booking detail ("Leave a review") for a signed-in customer.
export default function BookingReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading, signedIn } = useSession();
  return (
    <Card title="Leave a review">
      {loading ? null : signedIn ? (
        <ReviewForm bookingId={id} />
      ) : (
        <PhoneSignIn onVerified={() => undefined} />
      )}
    </Card>
  );
}
