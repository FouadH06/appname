import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ensureAnonymousSession } from '@app/api';
import { Captcha } from '@/components/captcha';
import { PhoneSignIn } from '@/components/phone-sign-in';
import {
  Body,
  Button,
  C,
  Card,
  Chip,
  Field,
  H1,
  H2,
  Muted,
  Row,
  State,
  confirmAction,
  s,
} from '@/components/ui';
import {
  beirutDate,
  dateLabel,
  dateTimeText,
  describeError,
  durationText,
  priceText,
  timeText,
} from '@/lib/format';
import { askForPush, dismissPushPrompt, shouldAskForPush } from '@/lib/push';
import { useSession } from '@/lib/session';
import { codeOf, supabase } from '@/lib/supabase';
import type { BusinessPage, BusinessPageResult, Hold, StaffOptions } from '@/lib/types';

// C7–C11 booking flow (full-screen modal): Service → Staff preference → Date & time → Review (+ phone
// verification, only if not signed in) → Success. Same RPCs and rules as the web: auto-skip steps
// with one option, a concrete staff member is assigned at hold time, the hold is 5 minutes.
type Step = 'service' | 'staff' | 'time' | 'review' | 'done';
type Choice = { mode: 'any' } | { mode: 'specific'; staffId: string; rebook?: boolean };

export default function BookingFlow() {
  const p = useLocalSearchParams<{
    slug: string;
    service?: string;
    staff?: string;
    rebook?: string;
  }>();
  const { session, signedIn } = useSession();
  const [page, setPage] = useState<BusinessPage | null>(null);
  const [step, setStep] = useState<Step>(p.service ? 'staff' : 'service');
  const [serviceId, setServiceId] = useState<string | undefined>(p.service);
  const [options, setOptions] = useState<StaffOptions | null>(null);
  const [choice, setChoice] = useState<Choice>({ mode: 'any' });
  const [days, setDays] = useState<string[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [booked, setBooked] = useState<{ id: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void supabase()
      .rpc('get_business_page', { p_slug: p.slug.toLowerCase() })
      .then(({ data }) => {
        const r = data as unknown as BusinessPageResult | null;
        if (r && r.state === 'ok') setPage(r as BusinessPage);
        else setMsg('This business isn’t taking bookings right now.');
      });
  }, [p.slug]);
  const service = page?.services.find((x) => x.id === serviceId);
  const staffId = choice.mode === 'specific' ? choice.staffId : undefined;

  // staff options + auto-skip (one qualified person, any-only, rebook preset)
  useEffect(() => {
    if (!page || !serviceId || step !== 'staff') return;
    void supabase()
      .rpc('get_staff_options', { p_location_id: page.location.id, p_service_id: serviceId })
      .then(({ data }) => {
        const o = data as unknown as StaffOptions;
        setOptions(o);
        if (p.staff && o.staff.some((x) => x.id === p.staff)) {
          setChoice({ mode: 'specific', staffId: p.staff, rebook: p.rebook === '1' });
          setStep('time');
        } else if (o.choice_mode === 'any_only') setStep('time');
        else if (o.staff.length === 1) {
          setChoice({ mode: 'specific', staffId: o.staff[0]!.id });
          setStep('time');
        }
      });
  }, [page, serviceId, step, p.staff, p.rebook]);

  useEffect(() => {
    if (!page || !serviceId || step !== 'time') return;
    void supabase()
      .rpc('get_available_days', {
        p_location_id: page.location.id,
        p_service_id: serviceId,
        p_staff_id: staffId,
        p_date_from: beirutDate(0),
        p_date_to: beirutDate(13),
      })
      .then(({ data }) => {
        const list = ((data ?? []) as string[]).sort();
        setDays(list);
        setDate((d) => (d && list.includes(d) ? d : (list[0] ?? null)));
      });
  }, [page, serviceId, staffId, step]);

  const loadSlots = useCallback(async () => {
    if (!page || !serviceId || !date) return;
    setSlots(null);
    const { data } = await supabase().rpc('get_available_slots', {
      p_location_id: page.location.id,
      p_service_id: serviceId,
      p_staff_id: staffId,
      p_date_from: date,
      p_date_to: date,
    });
    const list = (data ?? []).map((r) => r.slot_start);
    setSlots(list);
    if (!list.length) {
      const { data: n } = await supabase().rpc('get_next_available', {
        p_location_id: page.location.id,
        p_service_id: serviceId,
        p_staff_id: staffId,
      });
      setNext((n as string | null) ?? null);
    }
  }, [page, serviceId, staffId, date]);
  useEffect(() => {
    if (step === 'time') void loadSlots();
  }, [step, loadSlots]);

  const take = async (start: string) => {
    if (!page || !serviceId) return;
    setBusy(true);
    setMsg(null);
    try {
      if (!session) {
        if (!captcha) throw { message: 'CAPTCHA_FAILED' };
        await ensureAnonymousSession(supabase(), captcha);
      }
      const { data, error } = await supabase().rpc('create_hold', {
        p_location_id: page.location.id,
        p_service_id: serviceId,
        p_start: start,
        p_staff_id: staffId,
        p_selection_mode:
          choice.mode === 'specific' ? (choice.rebook ? 'rebook' : 'specific') : 'any',
        p_source: choice.mode === 'specific' && choice.rebook ? 'rebook' : 'marketplace_other',
        p_attribution: { channel: 'app' },
      });
      if (error || !data?.[0]) throw error ?? { message: 'SLOT_TAKEN' };
      setHold(data[0] as unknown as Hold);
      setStep('review');
    } catch (e) {
      const code = codeOf(e);
      if (['SLOT_TAKEN', 'STAFF_NOT_FREE', 'INVALID_SLOT'].includes(code)) {
        setMsg(`Someone just booked ${timeText(start)}. Pick another time.`);
        void loadSlots();
      } else setMsg(describeError(code));
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    if (!hold || step === 'done') return router.back();
    confirmAction(
      'Leave booking?',
      'We’ll release the time we’re holding for you.',
      'Leave',
      () => router.back(),
      'Stay',
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']} testID="booking-flow">
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !hold }} />
      <Row>
        <Pressable
          onPress={leave}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ padding: 16 }}
          testID="close-flow"
        >
          <Text style={{ fontSize: 20 }}>✕</Text>
        </Pressable>
        <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>
          {page?.business.name ?? ''}
        </Text>
      </Row>
      <ScrollView contentContainerStyle={s.body}>
        {msg ? <Body testID="flow-message">{msg}</Body> : null}
        {!page ? <State loading={!msg} /> : null}

        {page && step === 'service' ? (
          <View style={{ gap: 12 }} testID="step-service">
            <H1>Choose a service</H1>
            {page.services
              .filter((x) => x.online)
              .map((x) => (
                <Pressable
                  key={x.id}
                  style={s.card}
                  onPress={() => {
                    setServiceId(x.id);
                    setStep('staff');
                  }}
                  testID="service-option"
                  accessibilityRole="button"
                >
                  <Text style={s.cardTitle}>{x.name}</Text>
                  <Muted>
                    {priceText(x)} · {durationText(x.duration_min)}
                  </Muted>
                </Pressable>
              ))}
          </View>
        ) : null}

        {page && step === 'staff' ? (
          <View style={{ gap: 12 }} testID="step-staff">
            <H1>Who would you like?</H1>
            <State loading={!options} />
            {options && options.choice_mode !== 'choose_only' ? (
              <Pressable
                style={s.card}
                onPress={() => {
                  setChoice({ mode: 'any' });
                  setStep('time');
                }}
                testID="staff-any"
                accessibilityRole="button"
              >
                <Text style={s.cardTitle}>Any available</Text>
                <Muted>
                  {options.any_next ? `Next: ${dateTimeText(options.any_next)}` : 'Whoever is free'}
                </Muted>
              </Pressable>
            ) : null}
            {options?.staff.map((m) => (
              <Pressable
                key={m.id}
                style={s.card}
                onPress={() => {
                  setChoice({
                    mode: 'specific',
                    staffId: m.id,
                    rebook: options.rebook?.staff_id === m.id,
                  });
                  setStep('time');
                }}
                testID="staff-option"
                accessibilityRole="button"
              >
                <Text style={s.cardTitle}>
                  {m.name}
                  {options.rebook?.staff_id === m.id ? ' · your last visit' : ''}
                </Text>
                <Muted>
                  {m.role_title ?? ''}
                  {m.next_available ? ` · Next: ${dateTimeText(m.next_available)}` : ''}
                </Muted>
              </Pressable>
            ))}
          </View>
        ) : null}

        {page && step === 'time' ? (
          <View style={{ gap: 12 }} testID="step-time">
            <H1>Pick a time</H1>
            <Muted>
              {service?.name}
              {choice.mode === 'specific'
                ? ` with ${options?.staff.find((m) => m.id === staffId)?.name.split(' ')[0] ?? ''}`
                : ' · any available'}
            </Muted>
            {!session ? <Captcha onToken={setCaptcha} /> : null}
            <State
              loading={!days}
              empty={days?.length === 0}
              emptyText="No free times in the next two weeks."
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              {(days ?? []).map((d) => (
                <Chip
                  key={d}
                  label={dateLabel(d)}
                  active={d === date}
                  onPress={() => setDate(d)}
                  testID="day"
                />
              ))}
            </ScrollView>
            <State loading={!!date && !slots} />
            {slots && !slots.length ? (
              <Muted>No times left this day.{next ? ` Next: ${dateTimeText(next)}` : ''}</Muted>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="slots">
              {(slots ?? []).map((t) => (
                <Chip
                  key={t}
                  label={timeText(t)}
                  onPress={() => !busy && void take(t)}
                  testID="slot"
                  disabled={!session && !captcha}
                />
              ))}
            </View>
          </View>
        ) : null}

        {page && step === 'review' && hold && service ? (
          <Review
            page={page}
            service={service.name}
            hold={hold}
            anyMode={choice.mode === 'any'}
            signedIn={signedIn}
            onDone={(b) => {
              setBooked(b);
              setStep('done');
            }}
            onExpired={() => {
              setHold(null);
              setStep('time');
              setMsg('Your hold expired. Pick a time again.');
            }}
          />
        ) : null}

        {step === 'done' && booked ? (
          <Success booked={booked} business={page?.business.name ?? ''} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Review({
  page,
  service,
  hold,
  anyMode,
  signedIn,
  onDone,
  onExpired,
}: {
  page: BusinessPage;
  service: string;
  hold: Hold;
  anyMode: boolean;
  signedIn: boolean;
  onDone: (b: { id: string; status: string }) => void;
  onExpired: () => void;
}) {
  const [left, setLeft] = useState(() => new Date(hold.expires_at).getTime() - Date.now());
  const [first, setFirst] = useState('');
  const [needName, setNeedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idem = useMemo(() => `app-${hold.booking_id}`, [hold.booking_id]);

  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(hold.expires_at).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [hold.expires_at]);
  useEffect(() => {
    if (!signedIn) return;
    void supabase()
      .auth.getUser()
      .then(async ({ data }) => {
        const { data: prof } = await supabase()
          .from('profiles')
          .select('first_name')
          .eq('id', data.user!.id)
          .maybeSingle();
        setNeedName(!prof?.first_name);
      });
  }, [signedIn]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase().rpc('confirm_booking', {
      p_booking_id: hold.booking_id,
      p_hold_token: hold.hold_token,
      p_first_name: first.trim() || undefined,
      p_idempotency_key: idem,
    });
    setBusy(false);
    if (e || !data) {
      const code = codeOf(e);
      if (code === 'HOLD_EXPIRED' || code === 'HOLD_NOT_FOUND') return onExpired();
      return setError(describeError(code));
    }
    const b = data as unknown as { id: string; status: string };
    onDone(b);
  };
  const mm = Math.max(0, Math.floor(left / 60000));
  const ss = String(Math.max(0, Math.floor((left % 60000) / 1000))).padStart(2, '0');
  const request = page.rules.booking_mode === 'request';

  return (
    <View style={{ gap: 12 }} testID="step-review">
      <H1>{request ? 'Send your request' : 'Confirm your booking'}</H1>
      <Muted testID="hold-timer">
        {left > 0 ? `We’re holding this time for ${mm}:${ss}` : 'Your hold expired.'}
      </Muted>
      <Card testID="summary">
        <Text style={s.cardTitle}>{page.business.name}</Text>
        <Body>{service}</Body>
        <Body>{dateTimeText(hold.starts_at)}</Body>
        <Body testID="summary-staff">
          {anyMode
            ? `You’ll be with ${hold.staff_first_name} (assigned from available staff)`
            : `with ${hold.staff_first_name}`}
        </Body>
        <Muted>{priceText(hold)} · pay at the venue</Muted>
      </Card>
      <Muted>
        {request ? 'The business confirms requests, usually within an hour. ' : ''}
        Free cancellation up to {Math.round(page.rules.cancellation_window_minutes / 60)} h before.
      </Muted>
      {!signedIn ? (
        <Card>
          <H2>Verify your phone</H2>
          <PhoneSignIn
            onVerified={() => undefined}
            intro="We’ll send your confirmation and reminders on WhatsApp."
          />
        </Card>
      ) : (
        <>
          {needName ? (
            <Field
              label="First name"
              value={first}
              onChangeText={setFirst}
              autoComplete="given-name"
            />
          ) : null}
          <Button
            title={request ? 'Send request' : 'Confirm booking'}
            onPress={() => void confirm()}
            busy={busy}
            disabled={left <= 0 || (needName && !first.trim())}
            testID="confirm"
          />
        </>
      )}
      {error ? (
        <Text style={{ color: C.danger }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Success({
  booked,
  business,
}: {
  booked: { id: string; status: string };
  business: string;
}) {
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    void shouldAskForPush().then(setAsk);
  }, []);
  return (
    <View style={{ gap: 12 }} testID="booking-success">
      <H1>{booked.status === 'pending' ? 'Request sent' : 'You’re booked'}</H1>
      <Body>
        {booked.status === 'pending'
          ? `${business} will confirm shortly. We’ll let you know.`
          : `See you at ${business}. We’ll send a reminder before your visit.`}
      </Body>
      {ask ? (
        <Card testID="push-prompt">
          <Body>Want a reminder before your appointment?</Body>
          <Row>
            <Button
              title="Yes, notify me"
              onPress={() => void askForPush().finally(() => setAsk(false))}
            />
            <Button
              title="Not now"
              kind="secondary"
              onPress={() => {
                void dismissPushPrompt();
                setAsk(false);
              }}
            />
          </Row>
        </Card>
      ) : null}
      <Button
        title="View booking"
        onPress={() => router.replace({ pathname: '/bookings/[id]', params: { id: booked.id } })}
        testID="view-booking"
      />
      <Button title="Done" kind="secondary" onPress={() => router.dismissAll()} />
    </View>
  );
}
