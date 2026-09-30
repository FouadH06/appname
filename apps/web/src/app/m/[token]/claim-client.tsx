'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  claimBooking,
  claimVisits,
  dismissClaimableVisits,
  resolveAccessToken,
  type ClaimOffer,
  type TokenSummary,
} from '@app/api';
import { Card, primaryButton, secondaryButton } from '@/components/card';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { describeError, format, t } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const TZ = 'Asia/Beirut';
const when = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso));
const month = (isoDate: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(isoDate),
  );

export function ClaimClient({ token }: { token: string }) {
  const { loading, signedIn } = useSession();
  const router = useRouter();
  const [summary, setSummary] = useState<TokenSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<'new' | 'already' | null>(null);
  const [offers, setOffers] = useState<ClaimOffer[]>([]);
  const [offersDone, setOffersDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    resolveAccessToken(supabase(), token)
      .then(setSummary)
      .catch((e: { code?: string }) => setError(describeError(e.code ?? 'TOKEN_INVALID')));
  }, [token]);

  const claim = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await claimBooking(supabase(), token);
      setClaimed(r.already_claimed ? 'already' : 'new');
      setOffers(r.offers ?? []);
    } catch (e) {
      setError(
        describeError((e as { code?: string }).code ?? 'UNKNOWN', {
          hint: summary?.phone_hint ?? '',
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [token, summary]);

  const answerOffers = async (add: boolean) => {
    setBusy(true);
    const ids = offers.map((o) => o.business_id);
    try {
      if (add) await claimVisits(supabase(), ids);
      else await dismissClaimableVisits(supabase(), ids);
      setOffersDone(add ? t.pages.claim.added : '');
      setOffers([]);
    } catch (e) {
      setError(describeError((e as { code?: string }).code ?? 'UNKNOWN'));
    } finally {
      setBusy(false);
    }
  };

  if (!summary) {
    return (
      <Card customer title="…">
        {error ? <p className="text-sm text-danger-600">{error}</p> : null}
      </Card>
    );
  }
  const b = summary.booking;
  const details = (
    <div
      className="rounded-control bg-surface-50 p-3 text-sm text-ink-900"
      data-testid="booking-summary"
    >
      <div className="font-medium">{b.services.join(', ')}</div>
      <div>
        {when(b.starts_at)}
        {b.staff_first_name ? ` · ${b.staff_first_name}` : ''}
      </div>
      {b.area_name ? <div className="text-ink-500">{b.area_name}</div> : null}
    </div>
  );
  const title = format(t.pages.claim.title, { business: b.business_name });

  return (
    <Card customer title={title}>
      {details}
      {claimed ? (
        <>
          <p className="text-ink-900" data-testid="claimed">
            {claimed === 'new' ? t.pages.claim.claimed : t.pages.claim.alreadyClaimed}
          </p>
          <Link
            className={secondaryButton + ' flex items-center justify-center'}
            href={`/bookings/${summary.booking_id}`}
          >
            View booking
          </Link>
        </>
      ) : summary.purpose === 'manage_booking' ? (
        // online booking: verify the phone it was booked with, then manage it (C13)
        loading ? null : signedIn ? (
          <Link
            className={primaryButton + ' flex items-center justify-center'}
            href={`/bookings/${summary.booking_id}`}
            data-testid="manage-booking"
          >
            Manage booking
          </Link>
        ) : (
          <>
            <p className="text-sm text-ink-700">
              Verify {summary.phone_hint ?? 'your number'} to manage this booking.
            </p>
            <PhoneSignIn onVerified={() => router.push(`/bookings/${summary.booking_id}`)} />
          </>
        )
      ) : summary.claimable ? (
        loading ? null : signedIn ? (
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() => void claim()}
          >
            {t.pages.claim.addVisit}
          </button>
        ) : (
          <>
            <p className="text-sm text-ink-700">
              {format(t.pages.claim.signInWith, { hint: summary.phone_hint ?? '' })}
            </p>
            <PhoneSignIn onVerified={() => void claim()} />
          </>
        )
      ) : (
        <p className="text-sm text-ink-700">
          {summary.state === 'used' ? describeError('TOKEN_USED') : t.pages.claim.notClaimable}
        </p>
      )}

      {offers.length > 0 ? (
        <section className="flex flex-col gap-3 border-t border-line-200 pt-4" data-testid="offers">
          <p className="text-sm font-medium text-ink-900">{t.pages.claim.offersTitle}</p>
          <ul className="flex flex-col gap-2">
            {offers.map((o) => (
              <li
                key={o.business_id}
                className="rounded-control border border-line-200 p-3 text-sm"
              >
                <div className="font-medium text-ink-900">
                  {o.business_name}
                  {o.area_name ? ` · ${o.area_name}` : ''}
                </div>
                <div className="text-ink-500">
                  {format(
                    o.visit_count === 1 ? t.pages.claim.offerLineOne : t.pages.claim.offerLine,
                    {
                      count: o.visit_count,
                      month: month(o.latest_month),
                    },
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() => void answerOffers(true)}
          >
            {t.pages.claim.add}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={busy}
            onClick={() => void answerOffers(false)}
          >
            {t.pages.claim.notNow}
          </button>
        </section>
      ) : null}
      {offersDone ? <p className="text-sm text-success-600">{offersDone}</p> : null}
      {error ? (
        <p className="text-sm text-danger-600" role="alert" data-testid="claim-error">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
