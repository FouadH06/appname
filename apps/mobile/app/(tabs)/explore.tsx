import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, Chip, H2, Muted, Row, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { Home } from '@/lib/types';

// C3 Search / Explore: typed suggestions (services with places nearby · businesses · areas), recents
// (device only), popular services, categories.
interface Suggest {
  services: { id: string; name: string; places: number }[];
  businesses: { slug: string; name: string; area: string | null; display_rating: number | null }[];
  areas: { id: string; slug: string; name: string }[];
}
const RECENTS = 'search:recents';

export default function Explore() {
  const [q, setQ] = useState('');
  const [sug, setSug] = useState<Suggest | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [home, setHome] = useState<Home | null>(null);

  useFocusEffect(
    useCallback(() => {
      void AsyncStorage.getItem(RECENTS).then((v) => setRecents(v ? (JSON.parse(v) as string[]) : []));
      void supabase().rpc('get_home', {}).then(({ data }) => setHome((data as unknown as Home) ?? null));
    }, []),
  );
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      void supabase().rpc('search_suggest', { p_q: term }).then(({ data }) => alive && setSug((data as unknown as Suggest) ?? null));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = async (params: Record<string, string>, label?: string) => {
    if (label) {
      const next = [label, ...recents.filter((r) => r !== label)].slice(0, 8);
      setRecents(next);
      await AsyncStorage.setItem(RECENTS, JSON.stringify(next));
    }
    router.push({ pathname: '/search', params });
  };
  const typing = q.trim().length >= 2 && sug;
  const none = typing && !sug.services.length && !sug.businesses.length && !sug.areas.length;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <TextInput
          style={s.input}
          value={q}
          onChangeText={(v) => {
            setQ(v);
            if (v.trim().length < 2) setSug(null);
          }}
          placeholder="Haircut, nails, a business…"
          placeholderTextColor={C.ink500}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => q.trim() && void go({ q: q.trim() }, q.trim())}
          accessibilityLabel="Search services or businesses"
          testID="search-input"
        />
      </View>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {typing ? (
          <View style={{ gap: 4 }} testID="suggestions">
            {none ? <Muted>No exact matches for “{q.trim()}”. Try “haircut”, “nails” or “massage” — or search anyway.</Muted> : null}
            {sug.services.map((x) => (
              <SuggestionRow key={x.id} icon="✂️" label={x.name} hint={x.places ? `${x.places} places` : 'Service'} testID="suggestion-service"
                onPress={() => void go({ q: x.name, service: x.id }, x.name)} />
            ))}
            {sug.businesses.map((b) => (
              <SuggestionRow key={b.slug} icon="🏪" label={b.name} hint={[b.area, b.display_rating ? `★ ${b.display_rating}` : null].filter(Boolean).join(' · ')}
                testID="suggestion-business" onPress={() => router.push({ pathname: '/[slug]', params: { slug: b.slug } })} />
            ))}
            {sug.areas.map((a) => (
              <SuggestionRow key={a.id} icon="📍" label={a.name} hint="Area" testID="suggestion-area" onPress={() => void go({ area: a.id, q: '' })} />
            ))}
          </View>
        ) : (
          <>
            {recents.length ? (
              <View style={{ gap: 4 }}>
                <Row>
                  <View style={{ flex: 1 }}><H2>Recent</H2></View>
                  <Pressable onPress={() => { setRecents([]); void AsyncStorage.removeItem(RECENTS); }}><Muted>Clear</Muted></Pressable>
                </Row>
                {recents.map((r) => <SuggestionRow key={r} icon="🕘" label={r} hint="" onPress={() => void go({ q: r }, r)} />)}
              </View>
            ) : null}
            {home?.popular_services.length ? (
              <View style={{ gap: 8 }}>
                <H2>Popular</H2>
                <Row wrap>{home.popular_services.map((p) => <Chip key={p.id} label={p.name} onPress={() => void go({ q: p.name, service: p.id }, p.name)} />)}</Row>
              </View>
            ) : null}
            {home ? (
              <View style={{ gap: 8 }}>
                <H2>Browse</H2>
                <Row wrap>{home.categories.map((c) => <Chip key={c.id} label={c.name} onPress={() => void go({ category: c.id, q: c.name })} />)}</Row>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SuggestionRow({ icon, label, hint, onPress, testID }: { icon: string; label: string; hint: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <Text>{icon}</Text>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
      <Muted>{hint}</Muted>
    </Pressable>
  );
}
