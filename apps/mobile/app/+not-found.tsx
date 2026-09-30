import { Stack, router } from 'expo-router';
import { Body, Button, Screen } from '@/components/ui';

export default function NotFound() {
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Body testID="not-found">This page doesn&apos;t exist.</Body>
      <Button title="Go home" onPress={() => router.replace('/')} />
    </Screen>
  );
}
