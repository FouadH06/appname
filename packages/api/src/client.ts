import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@app/db';

export type AppSupabaseClient = SupabaseClient<Database>;

export interface ClientConfig {
  url: string;
  /** Publishable (anon) key. Never pass the service-role key to a client bundle. */
  anonKey: string;
}

/**
 * Typed Supabase client shared by web and mobile. Product RPC wrappers are added per milestone;
 * all correctness-critical writes go through RPCs (Phase 3 Part 6 §1).
 */
export function createAppClient(config: ClientConfig): AppSupabaseClient {
  if (!config.url || !config.anonKey) {
    throw new Error('createAppClient: url and anonKey are required');
  }
  return createClient<Database>(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
