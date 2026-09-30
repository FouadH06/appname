import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, type ColorValue } from 'react-native';
import { C } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// Home · Explore · Bookings · Favorites · Profile. Bookings shows a dot when something needs action
// (a review due, a request waiting) — no numeric badge spam.
const icon =
  (glyph: string) =>
  ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const { signedIn } = useSession();
  const [action, setAction] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    void supabase()
      .rpc('get_my_bookings', { p_scope: 'upcoming' })
      .then(({ data }) => {
        const list = (data as unknown as { is_request: boolean; status: string }[] | null) ?? [];
        setAction(list.some((b) => b.status === 'pending'));
      });
  }, [signedIn]);
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: C.accent, headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: icon('⌂'), tabBarButtonTestID: 'tab-home' }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: 'Explore', tabBarIcon: icon('⌕'), tabBarButtonTestID: 'tab-explore' }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Bookings',
          tabBarIcon: icon('▦'),
          tabBarBadge: action ? '' : undefined,
          tabBarBadgeStyle: { minWidth: 8, maxHeight: 8, borderRadius: 4 },
          tabBarButtonTestID: 'tab-bookings',
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{ title: 'Favorites', tabBarIcon: icon('♡'), tabBarButtonTestID: 'tab-favorites' }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: icon('☺'), tabBarButtonTestID: 'tab-profile' }}
      />
    </Tabs>
  );
}
