import { expect, test } from '@playwright/test';
import { createCalendarBusiness, businessSlug, refreshSearch, closePool } from './support/db';

// UX pass · responsive guard: the customer conversion spine has no horizontal overflow and keeps
// its navigation pattern (bottom tabs below 1024 px, header navigation from 1024 px) at the review
// widths. Local stack only (fixtures commit data).
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'desktop', 'viewport is set per case');
});
test.afterAll(closePool);

const WIDTHS: [number, number][] = [
  [375, 812],
  [430, 932],
  [667, 375],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
];

test('customer pages fit every review width', async ({ page }) => {
  test.setTimeout(240_000);
  const b = await createCalendarBusiness('Responsive Salon');
  await refreshSearch(b.businessId);
  const slug = await businessSlug(b.businessId);
  const paths = [
    '/',
    '/search?q=haircut',
    `/${slug}`,
    `/${slug}/book?service=${b.serviceId}`,
    '/bookings',
    '/favorites',
    '/account',
  ];
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of paths) {
      await page.goto(p);
      await page.waitForLoadState('load');
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${p} at ${w}×${h} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      const hasTabs = await page
        .getByTestId('bottom-nav')
        .isVisible()
        .catch(() => false);
      if (['/', '/search?q=haircut', '/bookings'].includes(p)) {
        expect(
          hasTabs,
          `${p} at ${w}px: bottom tabs ${w < 1024 ? 'expected' : 'not expected'}`,
        ).toBe(w < 1024);
      }
    }
  }
});
