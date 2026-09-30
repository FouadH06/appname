import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C } from '@/components/ui';
import { refreshPushToken, useNotificationRouting } from '@/lib/push';
import { SessionProvider, useSession } from '@/lib/session';

// Customer app shell (Phase 2 §8.3): bottom tabs; business profile, result detail and booking detail
// push onto the stack; the booking flow is a full-screen modal. Routes mirror the web URLs, so
// universal links (platform.com/{slug}, /bookings/{id}, /review/{token}, /r/{id}, /m/{token}) and push
// taps open the same screens.
function Shell() {
  const { signedIn } = useSession();
  useNotificationRouting();
  useEffect(() => {
    if (signedIn) void refreshPushToken();
  }, [signedIn]);
  return (
    <Stack screenOptions={{ headerTintColor: C.ink900, headerBackTitle: 'Back', contentStyle: { backgroundColor: C.surface50 } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="[slug]/book" options={{ presentation: 'fullScreenModal', title: 'Book' }} />
      <Stack.Screen name="sign-in" options={{ presentation: 'modal', title: 'Sign in' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Shell />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
