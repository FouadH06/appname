import { defineConfig, devices } from '@playwright/test';

// M13 · the customer app's web build (same code as iOS/Android via react-native-web) against the
// local stack. The web app on :3000 serves /captcha (Turnstile test key) for the app's iframe.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: process.env.CI ? 'pnpm --filter @app/web start' : 'pnpm --filter @app/web dev',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npx expo export --platform web --output-dir dist && node e2e/support/serve.mjs',
      url: 'http://127.0.0.1:8081',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
