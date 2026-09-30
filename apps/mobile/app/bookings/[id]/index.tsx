import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { Body, Button, C, Card, Chip, Field, H1, H2, Muted, Row, Screen, State, confirmAction } from '@/components/ui';
import { beirutDate, dateLabel, dateTimeText, describeError, durationText, priceText, timeText } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { MyBookingDetail } from '@/lib/types';

// C13 Booking Detail: status → when/where → actions by state → timeline. Always shows the current state
// (opening from an old notification never shows stale data).
export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signedIn, loading } = useSession();
  const [b, setB] = useState<MyBookingDetail | 'forbidden' | null>(null);
  const [mode, setMode] = useState<'none' | 'reschedule' | 'contest'>('none');
  const [toast, setToast] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc('get_my_booking', { p_booking_id: id });
    setB(error ? 'forbidden' : (data as unknown as MyBookingDetail));
  }, [id]);
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  if (loading) return <Screen><State loading /></Screen>;
  if (!signedIn) return <Screen><H1>Your booking</H1><PhoneSignIn onVerified={() => void load()} intro="Verify your phone to see this booking." /></Screen>;
  if (!b) return <Screen><State loading /></Screen>;
  if (b === 'forbidden') return <Screen><Body>This booking isn&apos;t linked to your account.</Body></Screen>;

  const done = async (message: string) => {
    setMode('none');
    setToast(message);
    await load();
  };
  const cancel = () => {
    const late = new Date(b.starts_at).getTime() - Date.now() < b.cancellation_window_minutes * 60_000;
    confirmAction(
      'Cancel this booking?',
      late ? `This is within ${Math.round(b.cancellation_window_minutes / 60)} hours of your booking. Late cancellations may affect your ability to book instantly.` : 'The business will be told right away.',
      'Cancel booking',
      () =>
        void supabase().rpc('cancel_my_booking', { p_booking_id: b.id }).then(({ error }) =>
          error ? setToast(describeError(error.message)) : void done('Cancelled. You’ll get a confirmation on WhatsApp.')),
      'Keep it',
    );
  };
  const rebook = (withStaff: boolean) =>
    router.push({ pathname: '/[slug]/book', params: { slug: b.business.slug, service: b.service_id, ...(withStaff && b.staff_id ? { staff: b.staff_id, rebook: '1' } : {}) } });

  return (
    <Screen testID="booking-detail">
      <Stack.Screen options={{ title: b.business.name }} />
      <View style={{ gap: 4 }}>
        <Text style={{ color: b.status === 'cancelled' || b.status === 'no_show' ? C.danger : C.accent, fontWeight: '600' }} testID="booking-status">
          {{ pending: 'Waiting for confirmation', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: b.no_show_disputed ? 'Missed · under review' : 'Missed' }[b.status]}
        </Text>
        <H1>{dateTimeText(b.starts_at)}</H1>
        <Muted>{b.service_name} · {durationText(b.duration_min)} · with {b.staff_first_name} · {priceText(b)}</Muted>
      </View>
      {b.staff_changed ? <Card><Body>Your appointment is now with {b.staff_first_name} (changed by {b.business.name}).</Body></Card> : null}
      {toast ? <Muted testID="toast">{toast}</Muted> : null}
      <Card>
        <Text style={{ fontWeight: '600' }}>{b.business.name}</Text>
        <Muted>{[b.location.address_line, b.location.landmark, b.location.area].filter(Boolean).join(' · ')}</Muted>
        <Row wrap>
          <Button title="Directions" kind="secondary" onPress={() => void Linking.openURL(`https://maps.google.com/?q=${b.location.lat},${b.location.lng}`)} />
          {b.location.whatsapp ? <Button title="WhatsApp" kind="secondary" onPress={() => void Linking.openURL(`https://wa.me/${b.location.whatsapp!.replace(/\D/g, '')}`)} /> : null}
        </Row>
      </Card>

      {mode === 'reschedule' ? <Reschedule b={b} onDone={done} onCancel={() => setMode('none')} /> : null}
      {mode === 'contest' ? <Contest b={b} onDone={done} onCancel={() => setMode('none')} /> : null}

      {mode === 'none' ? (
        <View style={{ gap: 8 }} testID="actions">
          {b.can_reschedule ? <Button title="Reschedule" onPress={() => setMode('reschedule')} testID="reschedule" /> : null}
          {b.status === 'completed' || b.status === 'cancelled' ? (
            b.business.live ? (
              <>
                <Button title={b.staff_id && b.status === 'completed' ? `Book again with ${b.staff_first_name}` : 'Book again'} onPress={() => rebook(b.status === 'completed')} testID="book-again" />
                {b.status === 'completed' && b.staff_id ? <Button title="Book again with anyone" kind="secondary" onPress={() => rebook(false)} /> : null}
              </>
            ) : <Muted>This business isn&apos;t taking bookings right now.</Muted>
          ) : null}
          {b.status === 'completed' ? (
            <Button title="Leave a review" kind="secondary" onPress={() => router.push({ pathname: '/bookings/[id]/review', params: { id: b.id } })} testID="leave-review" />
          ) : null}
          {b.can_contest ? <Button title="I was there" kind="secondary" onPress={() => setMode('contest')} testID="contest" /> : null}
          {b.can_cancel ? <Button title={b.status === 'pending' ? 'Cancel request' : 'Cancel booking'} kind="danger" onPress={cancel} testID="cancel" /> : null}
          <Muted>Free cancellation up to {Math.round(b.cancellation_window_minutes / 60)} h before.</Muted>
        </View>
      ) : null}

      <Card>
        <H2>Activity</H2>
        {b.timeline.map((t, i) => <Muted key={i}>{dateTimeText(t.created_at)} · {t.event.replace(/_/g, ' ')}</Muted>)}
      </Card>
    </Screen>
  );
}

// Same staff by default; the old time is released only when the new one commits (atomic move).
function Reschedule({ b, onDone, onCancel }: { b: MyBookingDetail; onDone: (m: string) => Promise<void>; onCancel: () => void }) {
  const [days, setDays] = useState<string[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void supabase()
      .rpc('get_available_days', { p_location_id: b.location.id, p_service_id: b.service_id, p_staff_id: b.staff_id ?? undefined, p_date_from: beirutDate(0), p_date_to: beirutDate(13) })
      .then(({ data }) => {
        const l = ((data ?? []) as string[]).sort();
        setDays(l);
        setDate(l[0] ?? null);
      });
  }, [b]);
  useEffect(() => {
    if (!date) return;
    setSlots(null);
    void supabase()
      .rpc('get_available_slots', { p_location_id: b.location.id, p_service_id: b.service_id, p_staff_id: b.staff_id ?? undefined, p_date_from: date, p_date_to: date })
      .then(({ data }) => setSlots((data ?? []).map((r) => r.slot_start).filter((t) => t !== b.starts_at)));
  }, [b, date]);
  const move = async (start: string) => {
    const { error: e } = await supabase().rpc('reschedule_my_booking', { p_booking_id: b.id, p_new_start: start });
    if (e) return setError(describeError(e.message));
    await onDone(`Moved to ${dateTimeText(start)}.`);
  };
  return (
    <Card testID="reschedule-picker">
      <H2>New time with {b.staff_first_name}</H2>
      <State loading={!days} empty={days?.length === 0} emptyText={`${b.staff_first_name} has no free times in the next two weeks.`} />
      <Row wrap>{(days ?? []).map((d) => <Chip key={d} label={dateLabel(d)} active={d === date} onPress={() => setDate(d)} />)}</Row>
      <Row wrap>{(slots ?? []).map((t) => <Chip key={t} label={timeText(t)} onPress={() => void move(t)} testID="reschedule-slot" />)}</Row>
      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
      <Button title="Keep the current time" kind="secondary" onPress={onCancel} />
    </Card>
  );
}

function Contest({ b, onDone, onCancel }: { b: MyBookingDetail; onDone: (m: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Card testID="contest-sheet">
      <H2>Tell us what happened</H2>
      <Muted>APP_NAME support will review it with {b.business.name}. One contest per booking, within 7 days.</Muted>
      <Field label="What happened?" value={text} onChangeText={setText} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
      <Button title="Send" disabled={text.trim().length < 5} testID="contest-send"
        onPress={() => void supabase().rpc('contest_no_show', { p_booking_id: b.id, p_statement: text.trim() }).then(({ error: e }) =>
          e ? setError(describeError(e.message)) : void onDone('Thanks — we’ll look into it and let you know.'))} />
      <Button title="Cancel" kind="secondary" onPress={onCancel} />
    </Card>
  );
}
