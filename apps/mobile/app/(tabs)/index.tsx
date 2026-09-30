import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, Card, Chip, H1, H2, Muted, Rail, Row, s } from '@/components/ui';
import { ago, dateTimeText, mediaUrl } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { Home, MyBooking, Rebook } from '@/lib/types';

// C2 Home: search → Book again (staff-first) → upcoming (48 h) → available today → top rated → new.
// Sections with fewer than 3 items are hidden; new users see no empty placeholders.
export default function HomeScreen() {
  const { signedIn } = useSession();
  const [cluster, setCluster] = useState<string | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [rebook, setRebook] = useState<Rebook[]>([]);
  const [upcoming, setUpcoming] = useState<MyBooking | null>(null);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [h, r, u, n] = await Promise.all([
      supabase().rpc('get_home', { p_cluster_id: cluster ?? undefined }),
      signedIn ? supabase().rpc('get_rebook_suggestions', { p_limit: 3 }) : Promise.resolve({ data: [] }),
      signedIn ? supabase().rpc('get_my_bookings', { p_scope: 'upcoming' }) : Promise.resolve({ data: [] }),
      signedIn ? supabase().rpc('get_unread_notification_count') : Promise.resolve({ data: 0 }),
    ]);
    setHome((h.data as unknown as Home) ?? null);
    setRebook((r.data as unknown as Rebook[]) ?? []);
    const next = ((u.data as unknown as MyBooking[]) ?? []).find((b) => new Date(b.starts_at).getTime() - Date.now() < 48 * 3600_000);
    setUpcoming(next ?? null);
    setUnread((n.data as number) ?? 0);
  }, [cluster, signedIn]);
  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}>
        <Row>
          <View style={{ flex: 1 }}>
            <H1>APP_NAME</H1>
          </View>
          <Link href="/notifications" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'} testID="bell" style={{ padding: 8 }}>
              <Text style={{ fontSize: 22 }}>🔔</Text>
              {unread ? <View testID="bell-dot" style={{ position: 'absolute', right: 6, top: 6, width: 9, height: 9, borderRadius: 5, backgroundColor: C.accent }} /> : null}
            </Pressable>
          </Link>
        </Row>

        <Pressable onPress={() => router.push('/explore')} style={[s.input, { justifyContent: 'center' }]} accessibilityRole="search" testID="home-search">
          <Text style={{ color: C.ink500, fontSize: 16 }}>What do you need? Haircut, nails, balayage…</Text>
        </Pressable>

        {home ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="All areas" active={!cluster} onPress={() => setCluster(null)} />
            {home.clusters.map((c) => <Chip key={c.id} label={c.name} active={cluster === c.id} onPress={() => setCluster(c.id)} testID="cluster-chip" />)}
          </ScrollView>
        ) : null}
        {home ? (
          <Row wrap>
            {home.categories.map((c) => (
              <Chip key={c.id} label={c.name} onPress={() => router.push({ pathname: '/search', params: { category: c.id, q: c.name, ...(cluster ? { cluster } : {}) } })} />
            ))}
          </Row>
        ) : null}

        {rebook.length ? (
          <View style={{ gap: 8 }} testID="book-again">
            <H2>Book again</H2>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              {rebook.map((r) => (
                <Card key={r.booking_id} style={{ width: 260 }} testID="rebook-card">
                  <Row>
                    {mediaUrl(r.cover_path) ? <Image source={{ uri: mediaUrl(r.cover_path)! }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : null}
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardTitle} numberOfLines={1}>{r.staff ? `Book again with ${r.staff}` : r.business}</Text>
                      <Muted>{r.service} · {r.staff ? r.business : `last time with ${r.last_staff ?? 'the team'}`} · {ago(r.last_visit_at)}</Muted>
                    </View>
                  </Row>
                  <Muted>{r.next_available_at ? `Next: ${dateTimeText(r.next_available_at)}` : 'No free times soon'}</Muted>
                  <Pressable
                    accessibilityRole="button"
                    testID="rebook"
                    onPress={() => router.push({ pathname: '/[slug]/book', params: { slug: r.slug, service: r.service_id, ...(r.staff_id ? { staff: r.staff_id, rebook: '1' } : {}) } })}
                    style={[s.btn, { backgroundColor: C.accent, borderColor: C.accent, minHeight: 40 }]}
                  >
                    <Text style={[s.btnText, { color: '#fff', fontSize: 15 }]}>{r.staff ? `Book with ${r.staff}` : 'Book again'}</Text>
                  </Pressable>
                </Card>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {upcoming ? (
          <Link href={{ pathname: '/bookings/[id]', params: { id: upcoming.id } }} asChild>
            <Pressable style={s.card} testID="upcoming-card">
              <Text style={s.cardTitle}>{dateTimeText(upcoming.starts_at)} · {upcoming.business.name}</Text>
              <Muted>{upcoming.service_name} with {upcoming.staff_first_name}{upcoming.status === 'pending' ? ' · waiting for confirmation' : ''}</Muted>
            </Pressable>
          </Link>
        ) : null}

        {home ? (
          <>
            <Rail title="Available today" cards={home.available_today} testID="rail-today" />
            <Rail title="Top rated" cards={home.top_rated} testID="rail-top" />
            <Rail title="New on APP_NAME" cards={home.new} testID="rail-new" />
            {!home.available_today.length && !home.top_rated.length && !home.new.length ? (
              <Muted>We&apos;re live in {home.clusters.map((c) => c.name).join(', ')}. Search for a service to get started.</Muted>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
