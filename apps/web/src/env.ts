import { z } from 'zod';
import { parseEnv } from '@app/core';

// Call these where the values are needed (from M4 on). Keeping them lazy lets M0 build
// without a running Supabase stack.

export function getPublicEnv() {
  return parseEnv(
    z.object({
      NEXT_PUBLIC_SUPABASE_URL: z.url(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
      // Cloudflare Turnstile. Local/CI: the official always-pass test key.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).default('1x00000000000000000000AA'),
      // /lab/* test pages (M4 phone and in-app-browser checks). Never on in production.
      NEXT_PUBLIC_ENABLE_LAB: z.enum(['true', 'false']).default('false'),
    }),
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      NEXT_PUBLIC_ENABLE_LAB: process.env.NEXT_PUBLIC_ENABLE_LAB,
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
