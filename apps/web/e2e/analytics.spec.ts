import { expect, test, type Page } from '@playwright/test';
import { addMemberByPhone, closePool, createCalendarBusiness, refreshMetrics } from './support/db';

// M14 · B11 analytics from rollups: a manager sees revenue and the team table; reception sees the
// same counts without any revenue. Local stack only.
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout (tiles 2-col)');
});
test.afterAll(closePool);

async function signIn(page: Page, local: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(local);
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await flow.getByLabel('6-digit code').fill('123456');
}

test('analytics: manager sees revenue from the rollups; reception sees counts only', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const b = await createCalendarBusiness('Analytics Salon'); // Lina: one completed Haircut 10 days ago
  await refreshMetrics(14);
  await page.goto('/biz/login');
  await signIn(page, '70 000 006');
  await expect(page).toHaveURL(/\/biz/, { timeout: 30_000 });
  await addMemberByPhone(b.businessId, '96170000006', 'manager');

  await page.goto(`/biz/${b.businessId}/analytics`);
  await page.getByRole('tab', { name: '30 days' }).click();
  const a = page.getByTestId('analytics');
  await expect(a.getByTestId('kpi').filter({ hasText: 'Completed bookings' })).toContainText('1');
  await expect(a.getByTestId('kpi').filter({ hasText: 'Revenue' })).toContainText('$15');
  await expect(a.getByTestId('top-services')).toContainText('Haircut');
  await expect(a.getByTestId('source-mix')).toContainText('Added by you');
  await expect(a.getByTestId('staff-table')).toContainText('Karim');

  await addMemberByPhone(b.businessId, '96170000006', 'reception');
  await page.reload();
  await page.getByRole('tab', { name: '30 days' }).click();
  await expect(a.getByTestId('kpi').filter({ hasText: 'Completed bookings' })).toContainText('1');
  await expect(a.getByTestId('kpi').filter({ hasText: 'Revenue' })).toHaveCount(0);
  await expect(a.getByTestId('staff-table')).not.toContainText('$');
});
