'use client';

import { useCallback, useEffect, useState } from 'react';
import { claimBooking, resolveAccessToken, type TokenSummary } from '@app/api';
import { Card } from '@/components/card';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { ReviewForm } from '@/components/public/review-form';
import { describeError } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export function ReviewTokenClient({ token }: { token: string }) {
  const { loading, signedIn } = useSession();
  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    resolveAccessToken(supabase(), token)
      .then(setSummary)
      .catch((e: { code?: string }) => setError(describeError(e.code ?? 'TOKEN_INVALID')));
  }, [token]);

  // a visit the business logged for someone without an account is claimed first (same phone)
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
    if (!loading && signedIn && summary && !ready) {
      const t = window.setTimeout(() => void prepare(), 0);
      return () => window.clearTimeout(t);
    }
  }, [loading, signedIn, summary, ready, prepare]);

  const title = summary ? `Review ${summary.booking.business_name}` : 'Leave a review';
  return (
    <Card customer title={title}>
      {error ? (
        <p className="text-sm text-danger-600" role="alert" data-testid="review-link-error">
          {error}
        </p>
      ) : !summary || loading ? null : !signedIn ? (
        <>
          <p className="text-sm text-ink-700">
            Verify {summary.phone_hint ?? 'your number'} so we know the review comes from the visit.
          </p>
          <PhoneSignIn onVerified={() => void prepare()} />
        </>
      ) : ready && summary.booking_id ? (
        <ReviewForm bookingId={summary.booking_id} />
      ) : null}
    </Card>
  );
}
