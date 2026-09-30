import { deleteMyAccount } from '@app/api';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Switch, Text, View } from 'react-native';
import { PhoneSignIn } from '@/components/phone-sign-in';
import {
  Body,
  Button,
  C,
  Card,
  Field,
  H1,
  H2,
  Muted,
  Row,
  Screen,
  State,
  confirmAction as ask,
} from '@/components/ui';
import { dateTimeText, describeError } from '@/lib/format';
import { unregisterPush } from '@/lib/push';
import { useSession } from '@/lib/session';
import { ENV, supabase } from '@/lib/supabase';
import type { MyBooking } from '@/lib/types';

// C18 Profile: name, phone (verified; changes go through support), my reviews, notification channels,
// legal, log out, delete account (explicit confirm that lists upcoming bookings).
type Channel = 'whatsapp' | 'sms' | 'push';
const CHANNELS: [Channel, string, string][] = [
  ['whatsapp', 'WhatsApp', 'Confirmations, reminders with Confirm / Cancel, changes'],
  ['sms', 'SMS', 'Backup when WhatsApp can’t reach you'],
  ['push', 'App notifications', 'Reminders and updates on this phone'],
];
interface MyReview {
  id: string;
  booking_id: string | null;
  overall: number;
  business: string;
  created_at: string;
}

export default function Profile() {
  const { signedIn, loading, userId } = useSession();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<Channel, boolean> | null>(null);
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPrefs = useCallback(async () => {
    const { data } = await supabase().rpc('get_my_notification_preferences');
    const next = { whatsapp: true, sms: true, push: true };
    for (const p of data ?? []) if (p.channel in next) next[p.channel as Channel] = p.enabled;
    setPrefs(next);
  }, []);
  const load = useCallback(async () => {
    if (!signedIn || !userId) return;
    const { data: p } = await supabase()
      .from('profiles')
      .select('first_name,last_name,phone_e164')
      .eq('id', userId)
      .maybeSingle();
    setFirst(p?.first_name ?? '');
    setLast(p?.last_name ?? '');
    setPhone(p?.phone_e164 ?? null);
    void loadPrefs();
    void supabase()
      .rpc('get_my_reviews')
      .then(({ data }) => setReviews((data as unknown as MyReview[]) ?? []));
  }, [signedIn, userId, loadPrefs]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const saveName = async () => {
    setError(null);
    const { error: e } = await supabase()
      .from('profiles')
      .update({ first_name: first.trim() || null, last_name: last.trim() || null })
      .eq('id', userId!);
    if (e) setError(describeError(e.message));
    else setMsg('Saved.');
  };
  const setPref = async (c: Channel, enabled: boolean) => {
    setError(null);
    const { error: e } = await supabase().rpc('set_notification_preference', {
      p_channel: c,
      p_enabled: enabled,
    });
    if (e) setError(describeError(e.message));
    await loadPrefs();
  };
  const logOut = async () => {
    await unregisterPush().catch(() => undefined);
    await supabase().auth.signOut();
    router.replace('/');
  };
  const del = async () => {
    const { data } = await supabase().rpc('get_my_bookings', { p_scope: 'upcoming' });
    const upcoming = ((data as unknown as MyBooking[]) ?? []).filter(
      (b) => b.status === 'pending' || b.status === 'confirmed',
    );
    const list = upcoming.length
      ? `Your upcoming bookings will be cancelled:\n${upcoming.map((b) => `• ${b.business.name}, ${dateTimeText(b.starts_at)}`).join('\n')}\n\n`
      : '';
    ask(
      'Delete your account?',
      `${list}Your reviews stay anonymous; your name and phone are removed. This can’t be undone.`,
      'Delete account',
      () => {
        void deleteMyAccount(supabase())
          .then(async () => {
            await unregisterPush().catch(() => undefined);
            await supabase().auth.signOut();
            router.replace('/');
          })
          .catch((e: { code?: string }) => setError(describeError(e.code ?? 'UNKNOWN')));
      },
    );
  };

  if (loading)
    return (
      <Screen>
        <State loading />
      </Screen>
    );
  if (!signedIn) {
    return (
      <Screen>
        <H1>Profile</H1>
        <PhoneSignIn
          onVerified={() => void load()}
          intro="Verify your phone to manage your bookings, favorites and reviews."
        />
        <Legal />
      </Screen>
    );
  }
  return (
    <Screen testID="profile">
      <H1>Profile</H1>
      <Card>
        <H2>You</H2>
        <Field
          label="First name"
          value={first}
          onChangeText={setFirst}
          autoComplete="given-name"
          testID="first-name"
        />
        <Field label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" />
        <Button title="Save" kind="secondary" onPress={() => void saveName()} testID="save-name" />
        <Muted>Phone: {phone ?? '—'} · verified. To change it, contact support.</Muted>
        {msg ? <Text style={{ color: C.success }}>{msg}</Text> : null}
      </Card>
      <Card testID="notification-preferences">
        <H2>Notifications</H2>
        {!prefs ? (
          <State loading />
        ) : (
          CHANNELS.map(([c, title, hint]) => (
            <Row key={c}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '500' }}>{title}</Text>
                <Muted>{hint}</Muted>
              </View>
              <Switch
                value={prefs[c]}
                onValueChange={(v) => void setPref(c, v)}
                accessibilityLabel={title}
                testID={`pref-${c}`}
              />
            </Row>
          ))
        )}
        <Muted>Booking messages always need one way to reach you.</Muted>
      </Card>
      <Card>
        <H2>My reviews</H2>
        <State
          empty={reviews?.length === 0}
          emptyText="Reviews you write appear here."
          loading={!reviews}
        />
        {(reviews ?? []).map((r) =>
          r.booking_id ? (
            <Link
              key={r.id}
              href={{ pathname: '/bookings/[id]/review', params: { id: r.booking_id } }}
              style={{ color: C.ink900 }}
            >
              {'★'.repeat(r.overall)} · {r.business}
            </Link>
          ) : (
            <Body key={r.id}>
              {'★'.repeat(r.overall)} · {r.business}
            </Body>
          ),
        )}
      </Card>
      <Legal />
      {error ? (
        <Text style={{ color: C.danger }} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button title="Log out" kind="secondary" onPress={() => void logOut()} testID="log-out" />
      <Button
        title="Delete account"
        kind="danger"
        onPress={() => void del()}
        testID="delete-account"
      />
    </Screen>
  );
}

function Legal() {
  return (
    <Card>
      <H2>Legal</H2>
      <Text style={{ color: C.accent }} onPress={() => void Linking.openURL(`${ENV.webUrl}/terms`)}>
        Terms
      </Text>
      <Text
        style={{ color: C.accent }}
        onPress={() => void Linking.openURL(`${ENV.webUrl}/privacy`)}
      >
        Privacy
      </Text>
    </Card>
  );
}
