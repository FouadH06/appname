import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Push (C17): permission is asked only after the first booking ("Want a reminder…?"), never at launch.
// The token is registered for the signed-in account; taps open the exact screen (data.path mirrors
// the web route). Without push, WhatsApp keeps working.

const ASKED = 'push:asked';
const TOKEN = 'push:token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const projectId = () =>
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
  Constants.easConfig?.projectId;

export const pushSupported = () => Platform.OS !== 'web' && Device.isDevice && !!projectId();

async function register(): Promise<boolean> {
  if (!pushSupported()) return false;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId()! });
  const { error } = await supabase().rpc('register_push_token', {
    p_token: data,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (!error) await AsyncStorage.setItem(TOKEN, data);
  return !error;
}

/** Should the post-booking prompt be shown? (supported, not granted yet, not asked before) */
export async function shouldAskForPush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'undetermined' && !(await AsyncStorage.getItem(ASKED));
}

export async function askForPush(): Promise<boolean> {
  await AsyncStorage.setItem(ASKED, '1');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Booking updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted' ? register() : false;
}

/** "Not now" on the prompt: don't ask again (the profile screen keeps an app-notifications switch). */
export const dismissPushPrompt = () => AsyncStorage.setItem(ASKED, '1');

/** App start / sign-in: keep the token current when permission was already granted. */
export async function refreshPushToken(): Promise<void> {
  if (!pushSupported()) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') await register().catch(() => undefined);
}

/** Sign-out: this device stops receiving the account's pushes. */
export async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN);
  if (token) await supabase().rpc('unregister_push_token', { p_token: token });
  await AsyncStorage.removeItem(TOKEN);
}

/** Notification taps (also the one that cold-started the app) open data.path. */
export function useNotificationRouting() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const path = r?.notification.request.content.data?.path;
      if (typeof path === 'string' && path.startsWith('/')) router.push(path as never);
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
