import { z } from 'zod';
import { parseEnv } from '@app/core';

// Call these where the values are needed (from M4 on). Keeping them lazy lets M0 build
// without a running Supabase stack.

export function getPublicEnv() {
  return parseEnv(
    z.object({
      NEXT_PUBLIC_SUPABASE_URL: z.url(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    }),
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  );
}

/** Server-only. Never import from a client component. */
export function getServerEnv() {
  return parseEnv(
    z.object({
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    }),
    process.env,
  );
}
