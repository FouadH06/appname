import { z } from 'zod';
import { parseEnv } from '@app/core';

export function getPublicEnv() {
  return parseEnv(
    z.object({
      NEXT_PUBLIC_SUPABASE_URL: z.url(),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
      // Admin has its own origin, so its own Turnstile site key. Local/CI: Cloudflare's test key.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).default('1x00000000000000000000AA'),
      // Business dashboard origin (links from admin into the setup wizard / invite pages)
      NEXT_PUBLIC_WEB_URL: z.url().default('http://127.0.0.1:3000'),
    }),
    {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
    },
  );
}
