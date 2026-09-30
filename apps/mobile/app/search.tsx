import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { BusinessCard, Button, Chip, H2, Muted, Row, State, s } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { SearchCard, SearchResult } from '@/lib/types';

// C4 Search results: filters (Available today · Price · Rating 4.5+ · For), sort, 20 per page with
// "load more", honest empty states. Same RPC as the web (search_businesses).
const SORTS: [string, string][] = [
  ['recommended', 'Recommended'],
  ['rating', 'Highest rated'],
  ['price', 'Price'],
  ['soonest', 'Soonest'],
];

export default function SearchScreen() {
  const p = useLocalSearchParams<{
    q?: string;
    service?: string;
    category?: string;
    cluster?: string;
    area?: string;
  }>();
  const [today, setToday] = useState(false);
  const [rating, setRating] = useState(false);
  const [audience, setAudience] = useState<'women' | 'men' | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [sort, setSort] = useState('recommended');
  const [rows, setRows] = useState<SearchCard[] | null>(null);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const filters: Record<string, boolean | number | string | number[]> = {};
    if (today) filters.available_today = true;
    if (rating) filters.min_rating = 4.5;
    if (audience) filters.audience = audience;
    if (price) filters.price_levels = [price];
    void supabase()
      .rpc('search_businesses', {
        p_q: p.q || undefined,
        p_service_id: p.service || undefined,
        p_category_id: p.category || undefined,
        p_cluster_id: p.cluster || undefined,
        p_area_id: p.area || undefined,
        p_filters: filters,
        p_sort: sort,
        p_offset: page * 20,
        p_limit: 20,
      })
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) return setError('Search is unavailable right now. Pull to retry.');
        const r = data as unknown as SearchResult;
        setRes(r);
        setRows((old) => (page === 0 ? r.results : [...(old ?? []), ...r.results]));
      });
    return () => {
      alive = false;
    };
  }, [p.q, p.service, p.category, p.cluster, p.area, today, rating, audience, price, sort, page]);
  const reset = () => setPage(0);

  return (
    <View style={s.screen} testID="search-results">
      <Stack.Screen options={{ title: p.q || 'Results' }} />
      <FlatList
        data={rows ?? []}
        keyExtractor={(c) => c.location_id}
        contentContainerStyle={s.body}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8 }}
            >
              <Chip
                label="Available today"
                active={today}
                onPress={() => {
                  setToday(!today);
                  reset();
                }}
                testID="filter-today"
              />
              <Chip
                label="Rating 4.5+"
                active={rating}
                onPress={() => {
                  setRating(!rating);
                  reset();
                }}
                testID="filter-rating"
              />
              {[1, 2, 3].map((l) => (
                <Chip
                  key={l}
                  label={'$'.repeat(l)}
                  active={price === l}
                  onPress={() => {
                    setPrice(price === l ? null : l);
                    reset();
                  }}
                />
              ))}
              <Chip
                label="For women"
                active={audience === 'women'}
                onPress={() => {
                  setAudience(audience === 'women' ? null : 'women');
                  reset();
                }}
              />
              <Chip
                label="For men"
                active={audience === 'men'}
                onPress={() => {
                  setAudience(audience === 'men' ? null : 'men');
                  reset();
                }}
              />
            </ScrollView>
            <Row wrap>
              {SORTS.map(([k, label]) => (
                <Chip
                  key={k}
                  label={label}
                  active={sort === k}
                  onPress={() => {
                    setSort(k);
                    reset();
                  }}
                />
              ))}
            </Row>
            {res ? (
              <Muted testID="result-count">
                {res.total} {res.total === 1 ? 'place' : 'places'}
              </Muted>
            ) : null}
            <State loading={!rows && !error} error={error} />
            {res?.intent.not_offered ? (
              <View testID="not-offered">
                <H2>Not on APP_NAME yet</H2>
                <Muted>
                  We cover hair, barbers, nails, lashes & brows, makeup, spas and beauty centers.
                </Muted>
              </View>
            ) : rows && rows.length === 0 ? (
              <Muted testID="no-results">No places match all your filters. Try removing one.</Muted>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => <BusinessCard c={item} />}
        ListFooterComponent={
          <View style={{ gap: 12, marginTop: 12 }}>
            {res && rows && res.total > rows.length ? (
              <Button title="More places" kind="secondary" onPress={() => setPage(page + 1)} />
            ) : null}
            {res?.nearby?.length ? (
              <View style={{ gap: 12 }} testID="also-nearby">
                <H2>Also nearby</H2>
                {res.nearby.map((c) => (
                  <BusinessCard key={c.location_id} c={c} />
                ))}
              </View>
            ) : null}
          </View>
        }
      />
    </View>
  );
}
