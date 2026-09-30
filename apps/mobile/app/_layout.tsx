import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useNetworkState } from 'expo-network';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { C } from '@/components/ui';
import { refreshPushToken, useNotificationRouting } from '@/lib/push';
import { SessionProvider, useSession } from '@/lib/session';

// Customer app shell (Phase 2 §8.3): bottom tabs; business profile, result detail and booking detail
// push onto the stack; the booking flow is a full-screen modal. Routes mirror the web URLs, so
// universal links (platform.com/{slug}, /bookings/{id}, /review/{token}, /r/{id}, /m/{token}) and push
// taps open the same screens.
/** Offline: screens keep what they loaded; actions fail with a clear message. The banner says why. */
function OfflineBanner() {
  const net = useNetworkState();
  if (net.isConnected !== false && net.isInternetReachable !== false) return null;
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: C.ink900 }} testID="offline-banner">
      <Text style={{ color: '#fff', textAlign: 'center', paddingVertical: 6, fontSize: 13 }}>
        You’re offline. Bookings and changes need a connection.
      </Text>
    </SafeAreaView>
  );
}

function Shell() {
  const { signedIn } = useSession();
  useNotificationRouting();
  useEffect(() => {
    if (signedIn) void refreshPushToken();
  }, [signedIn]);
  return (
    <Stack
      screenOptions={{
        headerTintColor: C.ink900,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: C.surface50 },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="[slug]/book"
        options={{ presentation: 'fullScreenModal', title: 'Book' }}
      />
      <Stack.Screen name="sign-in" options={{ presentation: 'modal', title: 'Sign in' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <OfflineBanner />
        <Shell />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
