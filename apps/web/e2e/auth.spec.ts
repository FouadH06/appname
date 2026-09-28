import { expect, test, type Page } from '@playwright/test';
import {
  closePool,
  createBusiness,
  createInvite,
  createShadowVisit,
  issueClaimToken,
} from './support/db';

// M4 auth flows against the local stack: Supabase Auth (Turnstile test keys, fixed test OTPs from
// supabase/config.toml [auth.sms.test_otp]), the database RPCs and the real pages.
// Test numbers share accounts across tests, so this file runs serially on one project.

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'mobile', 'auth flows run once (mobile project)');
});
test.afterAll(closePool);

const TEST_CODE = '123456';

async function signInWithPhone(page: Page, localNumber: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(localNumber);
  const send = flow.getByRole('button', { name: 'Send code' });
  await expect(send).toBeEnabled({ timeout: 20_000 }); // Turnstile test widget issues a token
  await send.click();
  await expect(page.getByTestId('otp-sent')).toContainText('WhatsApp');
  await flow.getByLabel('6-digit code').fill(TEST_CODE); // auto-submits at 6 digits
}

test('business login: phone code signs in; a new number has no business yet', async ({ page }) => {
  await page.goto('/biz/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your business' })).toBeVisible();

  // invalid inputs are caught before anything is sent
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill('01 234 567');
  await expect(flow.getByRole('button', { name: 'Send code' })).toBeEnabled({ timeout: 20_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Use a mobile number')).toBeVisible();

  await flow.getByLabel('Phone number').fill('');
  await signInWithPhone(page, '70 000 001');
  await expect(page).toHaveURL(/\/biz$/);
  await expect(page.getByTestId('no-memberships')).toBeVisible();
});

test('team invite: invited number signs in and joins the business', async ({ page }) => {
  const b = await createBusiness('Invite Salon');
  const token = await createInvite(b, '+96170000002', 'reception');

  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: `Join ${b.name}` })).toBeVisible();
  await expect(page.getByText('Role: Reception')).toBeVisible();
  await expect(page.getByText('+961 70 ••• 002')).toBeVisible();

  await signInWithPhone(page, '70000002');
  await expect(page.getByTestId('invite-accepted')).toBeVisible();
  await page.getByRole('link', { name: 'Go to dashboard' }).click();
  await expect(page.getByTestId('memberships')).toContainText(b.name);
  await expect(page.getByTestId('memberships')).toContainText('Reception');
});

test('team invite: a different number cannot accept', async ({ page }) => {
  const b = await createBusiness('Mismatch Salon');
  const token = await createInvite(b, '+96171999999', 'staff');
  await page.goto(`/invite/${token}`);
  await signInWithPhone(page, '70 000 005');
  await expect(page.getByTestId('invite-error')).toContainText('+961 71 ••• 999');
});

test('claim link: verify the number, add the visit, then accept the other offers', async ({
  page,
}) => {
  const a = await createBusiness('Claim Barber');
  const other = await createBusiness('Other Barber');
  const visit = await createShadowVisit(a, '+96170000003', 2);
  await createShadowVisit(other, '+96170000003', 20);
  const token = await issueClaimToken(visit);

  await page.goto(`/m/${token}`);
  await expect(page.getByRole('heading', { name: `Your visit at ${a.name}` })).toBeVisible();
  await expect(page.getByTestId('booking-summary')).toContainText('Haircut');
  await expect(page.getByText('+961 70 ••• 003')).toBeVisible();

  await signInWithPhone(page, '70 000 003');
  await expect(page.getByTestId('claimed')).toHaveText('Added to your account.');
  const offers = page.getByTestId('offers');
  await expect(offers).toContainText(other.name);
  await expect(offers).toContainText('1 visit ·');
  await offers.getByRole('button', { name: 'Add to my account' }).click();
  await expect(page.getByText('Added to your account.').last()).toBeVisible();

  // the same link again: already in the account
  await page.goto(`/m/${token}`);
  await expect(page.getByText('This link was already used.')).toBeVisible();
});

test('lab: anonymous hold → phone code → confirmed booking', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_ENABLE_LAB !== 'true', 'lab pages disabled');
  const b = await createBusiness('Lab Barber');
  await page.goto(`/lab/booking?loc=${b.locationId}&svc=${b.serviceId}`);
  await expect(page.getByTestId('lab-start')).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId('lab-start').click();
  await page.getByTestId('lab-slots').getByRole('button').nth(2).click();
  await expect(page.getByTestId('lab-hold')).toContainText('Karim');

  await signInWithPhone(page, '70 000 004');
  await page.getByLabel('First name').fill('Lab');
  await page.getByTestId('lab-confirm').click();
  await expect(page.getByTestId('lab-done')).toContainText(/Booked: [0-9A-Z]{8} \(confirmed\)/);
});
