import { Stack, useLocalSearchParams } from 'expo-router';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { ReviewForm } from '@/components/review-form';
import { Screen, State } from '@/components/ui';
import { useSession } from '@/lib/session';

// C15 from the booking detail ("Leave a review") for a signed-in customer.
export default function BookingReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loading, signedIn } = useSession();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Leave a review' }} />
      {loading ? <State loading /> : signedIn ? <ReviewForm bookingId={id} /> : <PhoneSignIn onVerified={() => undefined} />}
    </Screen>
  );
}
