import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: 5 * 60_000,
    // Files share one database; run them one after another. Parallelism happens inside tests.
    fileParallelism: false,
  },
});
