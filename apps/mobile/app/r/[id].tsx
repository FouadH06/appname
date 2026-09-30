import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, Share, Text, View } from 'react-native';
import { Body, Button, C, Card, H1, Muted, Row, Stars, State, s } from '@/components/ui';
import { priceText, ugcUrl, type PriceType } from '@/lib/format';
import { ENV, supabase } from '@/lib/supabase';

// C6 Result Detail (/r/{id}): the photo, trust mark, the review it came from, "Book similar".
interface Img {
  path: string;
  width: number;
  height: number;
}
interface Result {
  state: 'ok' | 'removed';
  id: string;
  trust_tier: 'verified_booking' | 'verified_visit';
  service: string | null;
  service_id: string;
  staff: string | null;
  staff_id: string | null;
  visit_at: string;
  price_type: PriceType;
  price_min: number | null;
  price_max: number | null;
  currency: string;
  images: { full: Img; thumb: Img };
  more: { id: string; images: { thumb: Img } }[];
  prev_id: string | null;
  next_id: string | null;
  business: {
    name: string;
    slug: string;
    area: string | null;
    rating: { display_rating: number | null; review_count: number };
  };
  review: { overall: number; author: string; text: string | null } | null;
}
const visited = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Beirut',
  }).format(new Date(iso));

export default function ResultDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [r, setR] = useState<Result | null>(null);
  useEffect(() => {
    setR(null);
    void supabase()
      .rpc('get_result', { p_review_media_id: id })
      .then(({ data }) =>
        setR((data as unknown as Result | null) ?? ({ state: 'removed' } as Result)),
      );
  }, [id]);
  if (!r)
    return (
      <View style={s.screen}>
        <State loading />
      </View>
    );
  if (r.state !== 'ok')
    return (
      <View style={[s.screen, s.body]}>
        <Body testID="result-removed">This result was removed.</Body>
      </View>
    );
  const b = r.business;
  return (
    <View style={s.screen} testID="result-detail">
      <Stack.Screen options={{ title: r.service ?? 'Result' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <View style={{ backgroundColor: C.ink900 }}>
          <Image
            source={{ uri: ugcUrl(r.images.full.path)! }}
            resizeMode="contain"
            accessibilityLabel={`${r.service ?? 'Result'} at ${b.name}`}
            style={{
              width: '100%',
              aspectRatio: r.images.full.width / r.images.full.height,
              maxHeight: 560,
            }}
          />
          {r.more.length ? (
            <ScrollView horizontal contentContainerStyle={{ gap: 8, padding: 8 }}>
              {r.more.map((m) => (
                <Link key={m.id} href={{ pathname: '/r/[id]', params: { id: m.id } }}>
                  <Image
                    source={{ uri: ugcUrl(m.images.thumb.path)! }}
                    style={{ width: 64, height: 64, borderRadius: 8 }}
                  />
                </Link>
              ))}
            </ScrollView>
          ) : null}
        </View>
        <View style={s.body}>
          <Text style={{ color: C.success, fontWeight: '600' }} testID="trust-mark">
            ✓ {r.trust_tier === 'verified_booking' ? 'Verified booking' : 'Verified visit'}
          </Text>
          <H1>
            {r.service} at {b.name}
          </H1>
          <Muted>
            {r.staff ? `by ${r.staff} · ` : ''}Visited {visited(r.visit_at)}
            {b.area ? ` · ${b.area}` : ''}
          </Muted>
          <Muted>Price at the time: {priceText(r)}</Muted>
          {b.rating.display_rating !== null ? (
            <Row>
              <Stars value={b.rating.display_rating} />
              <Muted>
                {b.rating.display_rating.toFixed(1)} · {b.rating.review_count} verified reviews
              </Muted>
            </Row>
          ) : null}
          {r.review ? (
            <Card>
              <Row>
                <Stars value={r.review.overall} />
                <Muted>{r.review.author}</Muted>
              </Row>
              {r.review.text ? <Body>{r.review.text}</Body> : null}
            </Card>
          ) : null}
          <Row>
            {r.prev_id ? (
              <Link
                href={{ pathname: '/r/[id]', params: { id: r.prev_id } }}
                style={{ color: C.accent }}
              >
                ← Newer
              </Link>
            ) : null}
            <View style={{ flex: 1 }} />
            {r.next_id ? (
              <Link
                href={{ pathname: '/r/[id]', params: { id: r.next_id } }}
                style={{ color: C.accent }}
              >
                Older →
              </Link>
            ) : null}
          </Row>
          <Row>
            <Link
              href={{ pathname: '/[slug]', params: { slug: b.slug } }}
              style={{ color: C.accent, fontWeight: '600' }}
            >
              {b.name}
            </Link>
            <View style={{ flex: 1 }} />
            <Text
              style={{ color: C.ink700 }}
              onPress={() =>
                void Share.share({
                  message: `${r.service ?? 'Result'} at ${b.name} · ${ENV.webUrl}/r/${r.id}`,
                })
              }
            >
              Share ↗
            </Text>
          </Row>
        </View>
      </ScrollView>
      <View
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
        <Button
          title={`Book similar${r.staff_id && r.staff ? ` with ${r.staff}` : ''}`}
          testID="book-similar"
          onPress={() =>
            router.push({
              pathname: '/[slug]/book',
              params: {
                slug: b.slug,
                service: r.service_id,
                ...(r.staff_id ? { staff: r.staff_id } : {}),
              },
            })
          }
        />
      </View>
    </View>
  );
}
