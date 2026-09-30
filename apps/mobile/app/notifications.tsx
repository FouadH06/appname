import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { C, H2, Muted, Screen, State, s } from '@/components/ui';
import { ago, dateTimeText, timeText } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { InboxItem } from '@/lib/types';

// C17 Notifications inbox: Today · Earlier (90 days). Opening a row marks it read and goes to the
// same screen the push would open. Rows never duplicate WhatsApp text — a short line per type.
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function line(n: InboxItem): { title: string; body: string } {
  const p = n.payload;
  const biz = str(p.business_name) || 'Your booking';
  const when = str(p.starts_at) ? dateTimeText(str(p.starts_at)) : '';
  switch (n.type) {
    case 'booking_confirmed':
      return { title: biz, body: `Booking confirmed · ${when}` };
    case 'booking_requested':
      return { title: biz, body: `Request sent · ${when}` };
    case 'request_accepted':
      return { title: biz, body: `Request accepted · ${when}` };
    case 'request_declined':
      return { title: biz, body: 'Your request couldn’t be accepted' };
    case 'request_expired':
      return { title: biz, body: 'Your request expired without a reply' };
    case 'booking_reminder_24h':
    case 'booking_reminder_2h':
      return { title: biz, body: `Reminder · ${when}` };
    case 'booking_cancelled_by_business':
      return { title: biz, body: 'Your booking was cancelled by the business' };
    case 'booking_cancelled_by_customer':
      return { title: biz, body: 'You cancelled your booking' };
    case 'booking_rescheduled_by_business':
      return { title: biz, body: `Moved to ${when}` };
    case 'staff_changed':
      return {
        title: biz,
        body: `Your appointment is now with ${str(p.staff_first_name) || 'another team member'}`,
      };
    case 'booking_no_show_marked':
      return { title: biz, body: 'Marked as missed. Tap if you were there.' };
    case 'review_request':
      return { title: biz, body: 'How was your visit? Leave a review' };
    case 'review_published':
      return { title: biz, body: 'Your review is live' };
    case 'review_needs_changes':
      return { title: biz, body: 'Your review comment couldn’t be published as written' };
    case 'result_published':
      return { title: biz, body: 'Your photo is live on the business page' };
    case 'result_rejected':
      return { title: biz, body: 'Your photo couldn’t be published' };
    case 'waitlist_offer':
      return { title: biz, body: 'A time opened up' };
    case 'dispute_update':
      return { title: 'APP_NAME support', body: 'There’s an update on your report' };
    default:
      return { title: biz, body: 'Update' };
  }
}

/** The same destinations as the push payload (notify/render.ts pushPath). */
function pathOf(n: InboxItem): string | null {
  const link = str(n.payload.review_link);
  const review = link ? link.replace(/^https?:\/\/[^/]+/, '') : '';
  if (
    ['review_request', 'review_needs_changes', 'result_rejected'].includes(n.type) &&
    review.startsWith('/')
  )
    return review;
  if (n.type === 'result_published' && str(n.payload.result_id))
    return `/r/${str(n.payload.result_id)}`;
  return n.booking_id ? `/bookings/${n.booking_id}` : null;
}

export default function Notifications() {
  const { signedIn, loading } = useSession();
  const [rows, setRows] = useState<InboxItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    if (!signedIn) return;
    const { data } = await supabase().rpc('get_my_notifications', { p_limit: 100 });
    setRows((data as unknown as InboxItem[]) ?? []);
  }, [signedIn]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const open = async (n: InboxItem) => {
    if (!n.read_at) {
      setRows(
        (xs) =>
          xs?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null,
      );
      await supabase().rpc('mark_notifications_read', { p_ids: [n.id] });
    }
    const path = pathOf(n);
    if (path) router.push(path as never);
  };
  const markAll = async () => {
    const ids = (rows ?? []).filter((r) => !r.read_at).map((r) => r.id);
    if (!ids.length) return;
    await supabase().rpc('mark_notifications_read', { p_ids: ids });
    await load();
  };

  if (loading)
    return (
      <Screen>
        <State loading />
      </Screen>
    );
  if (!signedIn)
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Notifications' }} />
        <PhoneSignIn
          onVerified={() => void load()}
          intro="Verify your phone to see your notifications."
        />
      </Screen>
    );

  const today = new Date().toDateString();
  const items = rows ?? [];
  const sections: (InboxItem | string)[] = [];
  const todays = items.filter((n) => new Date(n.created_at).toDateString() === today);
  const earlier = items.filter((n) => new Date(n.created_at).toDateString() !== today);
  if (todays.length) sections.push('Today', ...todays);
  if (earlier.length) sections.push('Earlier', ...earlier);

  return (
    <View style={s.screen} testID="inbox">
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: () =>
            items.some((n) => !n.read_at) ? (
              <Text onPress={() => void markAll()} style={{ color: C.accent }} testID="mark-all">
                Mark all read
              </Text>
            ) : null,
        }}
      />
      <FlatList
        data={sections}
        keyExtractor={(x) => (typeof x === 'string' ? x : x.id)}
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
          <State
            loading={!rows}
            empty={rows?.length === 0}
            emptyText="Booking updates, reminders and review requests will appear here."
          />
        }
        renderItem={({ item }) => {
          if (typeof item === 'string') return <H2>{item}</H2>;
          const { title, body } = line(item);
          return (
            <Pressable
              onPress={() => void open(item)}
              accessibilityRole="button"
              testID="inbox-row"
              style={[s.card, { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }]}
            >
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  marginTop: 6,
                  backgroundColor: item.read_at ? 'transparent' : C.accent,
                }}
                testID={item.read_at ? undefined : 'unread-dot'}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontWeight: item.read_at ? '400' : '600', color: C.ink900 }}>
                  {title}
                </Text>
                <Text style={{ color: C.ink700 }}>{body}</Text>
                <Muted>
                  {new Date(item.created_at).toDateString() === today
                    ? timeText(item.created_at)
                    : ago(item.created_at)}
                </Muted>
              </View>
            </Pressable>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      />
    </View>
  );
}
