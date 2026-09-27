import { expect, test } from '@playwright/test';

test('health endpoint responds', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true });
});

test('foundation page renders tokens and flips to RTL', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'APP_NAME' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Design tokens' }).getByRole('listitem')).toHaveCount(
    14,
  );

  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: /Direction/ }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
