import { claimBooking, resolveAccessToken, type TokenSummary } from '@app/api';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { ReviewForm } from '@/components/review-form';
import { Body, C, Screen, State } from '@/components/ui';
import { describeError } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// C15 · review link from WhatsApp/SMS/push (/review/{token}): verify the phone, claim a
// business-logged visit if needed, then rate it. Same flow as the web page.
export default function ReviewLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { loading, signedIn } = useSession();
  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    resolveAccessToken(supabase(), token)
      .then(setSummary)
      .catch((e: { code?: string }) => setError(describeError(e.code ?? 'TOKEN_INVALID')));
  }, [token]);
  const prepare = useCallback(async () => {
    if (!summary) return;
    if (summary.purpose === 'claim_visit' && summary.claimable) {
      try {
        await claimBooking(supabase(), token);
      } catch (e) {
        return setError(
          describeError((e as { code?: string }).code ?? 'UNKNOWN', {
            hint: summary.phone_hint ?? '',
          }),
        );
      }
    }
    setReady(true);
  }, [summary, token]);
  useEffect(() => {
    if (!loading && signedIn && summary && !ready) void prepare();
  }, [loading, signedIn, summary, ready, prepare]);

  return (
    <Screen>
      <Stack.Screen
        options={{ title: summary ? `Review ${summary.booking.business_name}` : 'Leave a review' }}
      />
      {error ? (
        <Text style={{ color: C.danger }} testID="review-link-error">
          {error}
        </Text>
      ) : !summary || loading ? (
        <State loading />
      ) : !signedIn ? (
        <>
          <Body>
            Verify {summary.phone_hint ?? 'your number'} so we know the review comes from the visit.
          </Body>
          <PhoneSignIn onVerified={() => void prepare()} />
        </>
      ) : ready && summary.booking_id ? (
        <ReviewForm bookingId={summary.booking_id} />
      ) : (
        <State loading />
      )}
    </Screen>
  );
}
