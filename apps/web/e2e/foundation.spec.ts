import { expect, test } from '@playwright/test';

test('health endpoint responds', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true });
});

test('deep health check reaches the database (uptime monitor target)', async ({ request }) => {
  test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
  const res = await request.get('/api/health?deep=1');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true, db: 'ok' });
});

test('foundation page renders tokens and flips to RTL', async ({ page }) => {
  await page.goto('/foundation');
  await expect(page.getByRole('heading', { name: 'APP_NAME' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Design tokens' }).getByRole('listitem')).toHaveCount(
    14,
  );

  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: /Direction/ }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
