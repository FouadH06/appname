import { defineConfig } from 'vitest/config';

// Unit tests for supabase/functions (Deno) code; the shared modules use only fetch + WebCrypto.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
