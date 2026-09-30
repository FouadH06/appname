import { claimBooking, claimVisits, dismissClaimableVisits, resolveAccessToken, type ClaimOffer, type TokenSummary } from '@app/api';
import { format, messages } from '@app/i18n';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { Body, Button, C, Card, H1, Muted, Screen, State } from '@/components/ui';
import { dateTimeText, describeError } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// WhatsApp/SMS magic links (/m/{token}): manage an online booking, or add a visit the business logged
// to your account (+ offer the other visits at that business). Same contract and copy as the web page.
const t = messages.en.pages.claim;
const month = (isoDate: string) => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(isoDate));

export default function MagicLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { loading, signedIn } = useSession();
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
      setError(describeError((e as { code?: string }).code ?? 'UNKNOWN', { hint: summary?.phone_hint ?? '' }));
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
      setOffersDone(add ? t.added : '');
      setOffers([]);
    } catch (e) {
      setError(describeError((e as { code?: string }).code ?? 'UNKNOWN'));
    } finally {
      setBusy(false);
    }
  };

  if (!summary) return <Screen><State loading={!error} error={error} /></Screen>;
  const b = summary.booking;
  const open = () => router.replace({ pathname: '/bookings/[id]', params: { id: summary.booking_id } });
  return (
    <Screen testID="magic-link">
      <Stack.Screen options={{ title: b.business_name }} />
      <H1>{format(t.title, { business: b.business_name })}</H1>
      <Card testID="booking-summary">
        <Text style={{ fontWeight: '600' }}>{b.services.join(', ')}</Text>
        <Body>{dateTimeText(b.starts_at)}{b.staff_first_name ? ` · ${b.staff_first_name}` : ''}</Body>
        {b.area_name ? <Muted>{b.area_name}</Muted> : null}
      </Card>
      {claimed ? (
        <>
          <Body testID="claimed">{claimed === 'new' ? t.claimed : t.alreadyClaimed}</Body>
          <Button title="View booking" kind="secondary" onPress={open} />
        </>
      ) : summary.purpose === 'manage_booking' ? (
        loading ? null : signedIn ? <Button title="Manage booking" onPress={open} testID="manage-booking" /> : (
          <>
            <Body>Verify {summary.phone_hint ?? 'your number'} to manage this booking.</Body>
            <PhoneSignIn onVerified={open} />
          </>
        )
      ) : summary.claimable ? (
        loading ? null : signedIn ? <Button title={t.addVisit} busy={busy} onPress={() => void claim()} /> : (
          <>
            <Body>{format(t.signInWith, { hint: summary.phone_hint ?? '' })}</Body>
            <PhoneSignIn onVerified={() => void claim()} />
          </>
        )
      ) : <Body>{summary.state === 'used' ? describeError('TOKEN_USED') : t.notClaimable}</Body>}
      {offers.length ? (
        <View style={{ gap: 8 }} testID="offers">
          <Text style={{ fontWeight: '600' }}>{t.offersTitle}</Text>
          {offers.map((o) => (
            <Card key={o.business_id}>
              <Text style={{ fontWeight: '600' }}>{o.business_name}{o.area_name ? ` · ${o.area_name}` : ''}</Text>
              <Muted>{format(o.visit_count === 1 ? t.offerLineOne : t.offerLine, { count: o.visit_count, month: month(o.latest_month) })}</Muted>
            </Card>
          ))}
          <Button title={t.add} disabled={busy} onPress={() => void answerOffers(true)} />
          <Button title={t.notNow} kind="secondary" disabled={busy} onPress={() => void answerOffers(false)} />
        </View>
      ) : null}
      {offersDone ? <Text style={{ color: C.success }}>{offersDone}</Text> : null}
      {error ? <Text style={{ color: C.danger }} testID="claim-error">{error}</Text> : null}
    </Screen>
  );
}
