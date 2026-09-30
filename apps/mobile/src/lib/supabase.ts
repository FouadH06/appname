import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createAppClient, type AppSupabaseClient } from '@app/api';

// Public config (inlined at build time by Expo). Never a service key.
export const ENV = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  webUrl: (process.env.EXPO_PUBLIC_WEB_URL ?? 'https://platform.com').replace(/\/$/, ''),
};

// Sessions live in the device keychain / keystore. SecureStore entries are limited (~2 KB), so the
// session JSON is split into chunks. The web target (tests, previews) uses localStorage.
const CHUNK = 1800;
const secureChunked = {
  async getItem(key: string) {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? '0');
    if (!n) return null;
    let out = '';
    for (let i = 0; i < n; i++) out += (await SecureStore.getItemAsync(`${key}.${i}`)) ?? '';
    return out;
  },
  async setItem(key: string, value: string) {
    const old = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? '0');
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++)
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    for (let i = n; i < old; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.setItemAsync(`${key}.n`, String(n));
  },
  async removeItem(key: string) {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? '0');
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};

let client: AppSupabaseClient | null = null;
export function supabase(): AppSupabaseClient {
  client ??= createAppClient({
    url: ENV.supabaseUrl,
    anonKey: ENV.anonKey,
    storage: Platform.OS === 'web' ? undefined : secureChunked,
    detectSessionInUrl: false,
  });
  return client;
}

/** Error code from an RPC / auth error ("SLOT_TAKEN", …) for i18n copy. */
export const codeOf = (e: unknown): string => {
  const m = (e as { message?: string; code?: string } | null)?.message ?? '';
  return /^[A-Z_]+$/.test(m) ? m : ((e as { code?: string } | null)?.code ?? 'UNKNOWN');
};
