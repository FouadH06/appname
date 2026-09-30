import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { Button, C, Chip, H1, Muted, Row, State, s } from '@/components/ui';
import { dateTimeText } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { MyBooking } from '@/lib/types';

// C12 My Bookings: Upcoming (soonest first) · Past (most recent first), "Book again" on past cards.
const STATUS: Record<MyBooking['status'], string> = {
  pending: 'Waiting for confirmation',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Missed',
};

export default function Bookings() {
  const { signedIn, loading } = useSession();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [rows, setRows] = useState<MyBooking[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    if (!signedIn) return;
    const { data } = await supabase().rpc('get_my_bookings', { p_scope: tab });
    setRows((data as unknown as MyBooking[]) ?? []);
  }, [signedIn, tab]);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (loading)
    return (
      <SafeAreaView style={s.screen}>
        <State loading />
      </SafeAreaView>
    );
  if (!signedIn) {
    return (
      <SafeAreaView style={s.screen} edges={['top']}>
        <View style={s.body}>
          <H1>Bookings</H1>
          <PhoneSignIn
            onVerified={() => void load()}
            intro="Verify your phone to see your bookings — including visits a business booked for you."
          />
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <FlatList
        data={rows ?? []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={s.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <H1>Bookings</H1>
            <Row>
              <Chip
                label="Upcoming"
                active={tab === 'upcoming'}
                onPress={() => {
                  setRows(null);
                  setTab('upcoming');
                }}
                testID="tab-upcoming"
              />
              <Chip
                label="Past"
                active={tab === 'past'}
                onPress={() => {
                  setRows(null);
                  setTab('past');
                }}
                testID="tab-past"
              />
            </Row>
            <State loading={!rows} />
            {rows && rows.length === 0 ? (
              <View style={{ gap: 8 }} testID="bookings-empty">
                <Muted>
                  {tab === 'upcoming'
                    ? 'No upcoming bookings.'
                    : 'Your past visits will appear here.'}
                </Muted>
                {tab === 'upcoming' ? (
                  <Button
                    title="Find a place"
                    kind="secondary"
                    onPress={() => router.push('/explore')}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item: b }) => (
          <Link href={{ pathname: '/bookings/[id]', params: { id: b.id } }} asChild>
            <Pressable style={s.card} testID="booking-card" accessibilityRole="link">
              <Text style={s.cardTitle}>{b.business.name}</Text>
              <Muted>
                {dateTimeText(b.starts_at)} · {b.service_name} · {b.staff_first_name}
              </Muted>
              <Row>
                <Text
                  style={{
                    color: b.status === 'cancelled' || b.status === 'no_show' ? C.danger : C.accent,
                    fontSize: 13,
                  }}
                >
                  {STATUS[b.status]}
                </Text>
                {b.booked_by_business ? <Muted>· Booked by {b.business.name}</Muted> : null}
              </Row>
              {tab === 'past' && b.business.live ? (
                <Pressable
                  accessibilityRole="button"
                  testID="book-again"
                  onPress={() =>
                    router.push({
                      pathname: '/[slug]/book',
                      params: {
                        slug: b.business.slug,
                        service: b.service_id,
                        ...(b.staff_id ? { staff: b.staff_id, rebook: '1' } : {}),
                      },
                    })
                  }
                >
                  <Text style={{ color: C.accent, fontWeight: '600' }}>
                    Book again{b.staff_id ? ` with ${b.staff_first_name}` : ''}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          </Link>
        )}
      />
    </SafeAreaView>
  );
}
