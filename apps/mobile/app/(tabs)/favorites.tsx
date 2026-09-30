import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { Button, C, H1, Muted, State, s } from '@/components/ui';
import { dateTimeText, mediaUrl } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { Favorite } from '@/lib/types';

// C14 Favorites · Places. Businesses that stopped taking bookings stay listed (dimmed) until removed.
export default function Favorites() {
  const { signedIn, loading } = useSession();
  const [rows, setRows] = useState<Favorite[] | null>(null);
  const load = useCallback(async () => {
    if (!signedIn) return;
    const { data } = await supabase().rpc('get_my_favorites');
    setRows((data as unknown as Favorite[]) ?? []);
  }, [signedIn]);
  useFocusEffect(useCallback(() => void load(), [load]));
  const remove = async (f: Favorite) => {
    setRows((xs) => xs?.filter((x) => x.business_id !== f.business_id) ?? null);
    const { error } = await supabase().rpc('toggle_favorite_business', { p_business_id: f.business_id });
    if (error) void load();
  };

  if (loading) return <SafeAreaView style={s.screen}><State loading /></SafeAreaView>;
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <FlatList
        data={signedIn ? rows ?? [] : []}
        keyExtractor={(f) => f.business_id}
        contentContainerStyle={s.body}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <H1>Favorites</H1>
            {!signedIn ? <PhoneSignIn onVerified={() => void load()} intro="Verify your phone to save places and find them on any device." /> : null}
            {signedIn ? <State loading={!rows} /> : null}
            {signedIn && rows?.length === 0 ? (
              <View style={{ gap: 8 }} testID="favorites-empty">
                <Muted>Tap ♡ on a place to save it here.</Muted>
                <Button title="Find a place" kind="secondary" onPress={() => router.push('/explore')} />
              </View>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item: f }) => {
          const off = f.state !== 'ok';
          const cover = mediaUrl(f.cover_path);
          const card = (
            <View style={[s.card, { flexDirection: 'row', gap: 12, opacity: off ? 0.55 : 1 }]} testID="favorite-row">
              <View style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: C.surface100 }}>
                {cover ? <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{f.name}</Text>
                <Muted>{f.display_rating ? `★ ${f.display_rating} (${f.review_count})` : 'New'}{f.area ? ` · ${f.area}` : ''}</Muted>
                <Text style={{ color: off ? C.ink500 : C.accent, fontSize: 13 }}>
                  {off ? 'Not taking bookings right now' : f.next_available_at ? `Next: ${dateTimeText(f.next_available_at)}` : 'See times'}
                </Text>
              </View>
              <Pressable onPress={() => void remove(f)} accessibilityRole="button" accessibilityLabel={`Remove ${f.name} from favorites`} testID="unfavorite" hitSlop={8}>
                <Text style={{ fontSize: 22, color: C.accent }}>♥</Text>
              </Pressable>
            </View>
          );
          return off ? card : (
            <Link href={{ pathname: '/[slug]', params: { slug: f.slug } }} asChild>
              <Pressable accessibilityRole="link">{card}</Pressable>
            </Link>
          );
        }}
      />
    </SafeAreaView>
  );
}
