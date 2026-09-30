import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, C, Card, Chip, H1, H2, Muted, Row, Stars, State, s } from '@/components/ui';
import { durationText, mediaUrl, priceText, ugcUrl } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ENV, codeOf, supabase } from '@/lib/supabase';
import type { BusinessPage, BusinessPageResult } from '@/lib/types';

// C5 Business Profile: the C1 storefront in the marketplace. Tabs Services · Results · Reviews · About,
// favorite ♡, share, sticky Book. Arriving from a service search highlights that service.
type Tab = 'services' | 'results' | 'reviews' | 'about';
interface Review {
  id: string;
  overall: number;
  author: string;
  service: string | null;
  staff: string | null;
  text: string | null;
  published_at: string;
  reply: { text: string } | null;
}
interface Result {
  id: string;
  images: { thumb: { path: string } };
  service: string | null;
}

export default function BusinessProfile() {
  const { slug, service } = useLocalSearchParams<{ slug: string; service?: string }>();
  const { signedIn } = useSession();
  const [page, setPage] = useState<BusinessPage | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'not_found' | 'unavailable'>('loading');
  const [tab, setTab] = useState<Tab>('services');
  const [fav, setFav] = useState(false);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void supabase()
      .rpc('get_business_page', { p_slug: slug.toLowerCase() })
      .then(({ data }) => {
        const r = data as unknown as BusinessPageResult | null;
        if (r && 'redirect_to' in r && r.redirect_to)
          return router.replace({ pathname: '/[slug]', params: { slug: r.redirect_to } });
        if (!r || r.state !== 'ok')
          return setState(r?.state === 'not_found' ? 'not_found' : 'unavailable');
        setPage(r as BusinessPage);
        setState('ok');
      });
  }, [slug]);
  useEffect(() => {
    if (!page || !signedIn) return;
    void supabase()
      .rpc('is_favorite_business', { p_business_id: page.business.id })
      .then(({ data }) => setFav(!!data));
  }, [page, signedIn]);
  useEffect(() => {
    if (!page) return;
    if (tab === 'reviews' && !reviews)
      void supabase()
        .rpc('get_business_reviews', { p_business_id: page.business.id, p_limit: 20 })
        .then(({ data }) => setReviews((data as unknown as Review[]) ?? []));
    if (tab === 'results' && !results)
      void supabase()
        .rpc('get_business_results', { p_business_id: page.business.id, p_limit: 24 })
        .then(({ data }) => {
          const r = data as unknown as { featured: Result[]; items: Result[] } | null;
          setResults([...(r?.featured ?? []), ...(r?.items ?? [])]);
        });
  }, [tab, page, reviews, results]);

  const toggleFav = async () => {
    if (!signedIn) return router.push('/sign-in');
    const was = fav;
    setFav(!was); // optimistic, rolled back on failure
    const { data, error } = await supabase().rpc('toggle_favorite_business', {
      p_business_id: page!.business.id,
    });
    if (error) {
      setFav(was);
      setToast(
        codeOf(error) === 'AUTH_REQUIRED'
          ? 'Sign in to save places.'
          : 'Couldn’t update your favorites.',
      );
    } else setFav(!!(data as { favorited: boolean }).favorited);
  };
  const book = (serviceId?: string) =>
    router.push({
      pathname: '/[slug]/book',
      params: { slug, ...(serviceId ? { service: serviceId } : {}) },
    });

  if (state !== 'ok' || !page) {
    return (
      <SafeAreaView style={s.screen}>
        <Stack.Screen options={{ title: '' }} />
        <View style={s.body}>
          <State loading={state === 'loading'} />
          {state === 'not_found' ? <Body>This page doesn&apos;t exist.</Body> : null}
          {state === 'unavailable' ? (
            <Body>This business isn&apos;t taking bookings right now.</Body>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }
  const b = page.business;
  const cover = mediaUrl(b.cover_path);
  return (
    <View style={s.screen} testID="business-profile">
      <Stack.Screen options={{ title: b.name }} />
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: 110 }]}
        stickyHeaderIndices={[1]}
      >
        <View style={{ gap: 8 }}>
          {cover ? (
            <Image
              source={{ uri: cover }}
              style={{ width: '100%', height: 180, borderRadius: 16 }}
            />
          ) : null}
          <Row>
            <View style={{ flex: 1 }}>
              <H1>{b.name}</H1>
              <Muted>
                {b.category?.en}
                {page.location.area ? ` · ${page.location.area.en}` : ''}
                {page.rating.display_rating
                  ? ` · ★ ${page.rating.display_rating} (${page.rating.review_count} verified)`
                  : page.rating.review_count
                    ? ` · ${page.rating.review_count} verified reviews so far`
                    : ' · New on APP_NAME'}
              </Muted>
            </View>
            <Pressable
              onPress={() => void toggleFav()}
              accessibilityRole="button"
              accessibilityLabel={fav ? 'Remove from favorites' : 'Save to favorites'}
              testID="favorite"
              style={{ padding: 8 }}
            >
              <Text style={{ fontSize: 26, color: fav ? C.accent : C.ink500 }}>
                {fav ? '♥' : '♡'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void Share.share({ message: `${b.name} · ${ENV.webUrl}/${b.slug}` })}
              accessibilityRole="button"
              accessibilityLabel="Share"
              style={{ padding: 8 }}
            >
              <Text style={{ fontSize: 22 }}>↗</Text>
            </Pressable>
          </Row>
          {toast ? <Muted testID="toast">{toast}</Muted> : null}
        </View>
        <View style={{ backgroundColor: C.surface50, paddingVertical: 8 }}>
          <Row>
            {(['services', 'results', 'reviews', 'about'] as Tab[]).map((t) => (
              <Chip
                key={t}
                label={t[0]!.toUpperCase() + t.slice(1)}
                active={tab === t}
                onPress={() => setTab(t)}
                testID={`tab-${t}`}
              />
            ))}
          </Row>
        </View>

        {tab === 'services' ? (
          <View style={{ gap: 12 }}>
            {page.staff.length ? (
              <Muted>Team: {page.staff.map((m) => m.name.split(' ')[0]).join(', ')}</Muted>
            ) : null}
            {page.services.map((sv) => (
              <Card
                key={sv.id}
                style={sv.id === service ? { borderColor: C.accent, borderWidth: 2 } : undefined}
                testID="service-row"
              >
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle}>{sv.name}</Text>
                    <Muted>
                      {priceText(sv)} · {durationText(sv.duration_min)}
                    </Muted>
                  </View>
                  {sv.online && page.accepting ? (
                    <Pressable
                      onPress={() => book(sv.id)}
                      accessibilityRole="button"
                      testID="book-service"
                      style={[s.chip, { borderColor: C.accent }]}
                    >
                      <Text style={{ color: C.accent, fontWeight: '600' }}>Book</Text>
                    </Pressable>
                  ) : (
                    <Muted>Call to book</Muted>
                  )}
                </Row>
              </Card>
            ))}
          </View>
        ) : null}

        {tab === 'results' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <State
              loading={!results}
              empty={results?.length === 0}
              emptyText="No customer results yet."
            />
            {(results ?? []).map((r) => (
              <Link key={r.id} href={{ pathname: '/r/[id]', params: { id: r.id } }} asChild>
                <Pressable
                  style={{
                    width: '31%',
                    aspectRatio: 0.8,
                    borderRadius: 12,
                    overflow: 'hidden',
                    backgroundColor: C.surface100,
                  }}
                >
                  <Image
                    source={{ uri: ugcUrl(r.images.thumb.path)! }}
                    style={{ width: '100%', height: '100%' }}
                  />
                </Pressable>
              </Link>
            ))}
          </View>
        ) : null}

        {tab === 'reviews' ? (
          <View style={{ gap: 12 }}>
            <Muted>
              Every review comes from a real booking or visit. Businesses can reply but can&apos;t
              remove reviews.
            </Muted>
            <State loading={!reviews} empty={reviews?.length === 0} emptyText="No reviews yet." />
            {(reviews ?? []).map((r) => (
              <Card key={r.id}>
                <Row>
                  <Stars value={r.overall} />
                  <Muted>
                    {r.author}
                    {r.service ? ` · ${r.service}` : ''}
                    {r.staff ? ` · ${r.staff}` : ''}
                  </Muted>
                </Row>
                {r.text ? <Body>{r.text}</Body> : null}
                {r.reply ? (
                  <Muted>
                    Reply from {b.name}: {r.reply.text}
                  </Muted>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}

        {tab === 'about' ? (
          <View style={{ gap: 12 }}>
            {b.description ? <Body>{b.description}</Body> : null}
            <Card>
              <H2>Location</H2>
              <Body>
                {[page.location.address_line, page.location.landmark, page.location.area?.en]
                  .filter(Boolean)
                  .join(' · ')}
              </Body>
              <Row wrap>
                <Button
                  title="Directions"
                  kind="secondary"
                  onPress={() =>
                    void Linking.openURL(
                      `https://maps.google.com/?q=${page.location.lat},${page.location.lng}`,
                    )
                  }
                />
                {page.location.whatsapp ? (
                  <Button
                    title="WhatsApp"
                    kind="secondary"
                    onPress={() =>
                      void Linking.openURL(
                        `https://wa.me/${page.location.whatsapp!.replace(/\D/g, '')}`,
                      )
                    }
                  />
                ) : null}
                {page.location.phone ? (
                  <Button
                    title="Call"
                    kind="secondary"
                    onPress={() => void Linking.openURL(`tel:${page.location.phone}`)}
                  />
                ) : null}
              </Row>
            </Card>
          </View>
        ) : null}
      </ScrollView>
      {page.accepting ? (
        <SafeAreaView
          edges={['bottom']}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: 16,
            backgroundColor: C.surface0,
            borderTopWidth: 1,
            borderColor: C.line,
          }}
        >
          <Button title="Book" onPress={() => book(service)} testID="book" />
        </SafeAreaView>
      ) : null}
    </View>
  );
}
