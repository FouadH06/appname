'use client';

import { createAppClient, type AppSupabaseClient } from '@app/api';
import { getPublicEnv } from '@/env';

let client: AppSupabaseClient | null = null;

export function supabase(): AppSupabaseClient {
  if (!client) {
    const env = getPublicEnv();
    client = createAppClient({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  return client;
}
