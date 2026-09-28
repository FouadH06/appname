import { expect, test, type Page } from '@playwright/test';
import {
  addMemberByPhone,
  beirutDate,
  businessStatus,
  clearProfileName,
  closePool,
  createDraftBusiness,
  firstService,
  publicSlots,
} from './support/db';

// M5 · owner-mode onboarding end to end (claim → wizard → go live), schedule → availability, and
// role-aware navigation. Local stack only (storage included for the cover photo).
test.describe.configure({ mode: 'serial' });
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(
    info.project.name !== 'mobile',
    'runs once (mobile project: owners onboard on their phones)',
  );
});
test.afterAll(closePool);

// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signIn(page: Page, local: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(local);
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await flow.getByLabel('6-digit code').fill('123456');
}

let biz: Awaited<ReturnType<typeof createDraftBusiness>>;

test('owner claims, goes live through the wizard, and the schedule drives availability', async ({
  page,
}) => {
  test.setTimeout(180_000);
  biz = await createDraftBusiness('Fade Studio', '+96170000007');

  // claim: WhatsApp invite link → phone code
  await page.goto(`/invite/${biz.token}`);
  await signIn(page, '70 000 007');
  await expect(page.getByTestId('invite-accepted')).toBeVisible();
  await clearProfileName('96170000007');
  await page.goto(`/biz/${biz.businessId}`);
  await expect(page.getByTestId('overview-checklist')).toBeVisible();
  await page.goto(`/biz/${biz.businessId}/setup`);

  // basics
  await page
    .getByLabel('Short description (optional)')
    .fill('Classic cuts and beard trims in Hazmieh.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByTestId('wizard-continue').click();

  // location (map pin present; keep ops' pin)
  await expect(page.getByTestId('map-pin')).toBeVisible();
  await page.getByLabel('Landmark').fill('Near Mar Takla');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByTestId('wizard-continue').click();

  // hours: open Monday (default 9:00–19:00) and copy to every day
  await page.getByTestId('hours-grid').getByRole('button', { name: 'Open' }).first().click();
  await page.getByRole('button', { name: 'Copy to all' }).click();
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByTestId('wizard-continue').click();

  // services from templates
  const templates = page.getByTestId('service-templates');
  await templates.getByRole('checkbox').nth(0).check();
  await templates.getByRole('checkbox').nth(1).check();
  const prices = templates.getByPlaceholder('$');
  await prices.nth(0).fill('15');
  await prices.nth(1).fill('10');
  await templates.getByRole('button', { name: /Add 2 services/ }).click();
  await expect(page.getByTestId('wizard-services').getByRole('listitem')).toHaveCount(2);
  await page.getByTestId('wizard-continue').click();

  // team: "I also take appointments" — the owner has no name yet, so the wizard asks for it
  await page.getByRole('button', { name: 'I also take appointments' }).click();
  const ask = page.getByTestId('ask-my-name');
  await ask.getByLabel('First name').fill('Fadi');
  await ask.getByLabel('Last name (optional)').fill('Khoury');
  await ask.getByRole('button', { name: 'Add me to the team' }).click();
  await expect(page.getByTestId('wizard-team').getByRole('listitem')).toHaveCount(1);
  await expect(page.getByTestId('wizard-team')).toContainText('Fadi Khoury');
  await page.getByTestId('wizard-continue').click();

  // photos: cover
  await page
    .getByTestId('cover-input')
    .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('cover-photo')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wizard-continue').click();

  // booking rules (no minimum notice so today's test slots exist)
  await page.getByLabel('Minimum notice (minutes)').fill('0');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByText('Saved. Changes apply to new bookings.')).toBeVisible();
  await page.getByTestId('wizard-continue').click();

  // preview & go live
  await expect(page.getByTestId('golive-checklist').getByText('✗')).toHaveCount(0);
  await expect(page.getByTestId('phone-preview')).toContainText(biz.name);
  await page.getByTestId('go-live').click();
  await expect(page.getByTestId('share-link')).toContainText(biz.slug);

  expect(await businessStatus(biz.businessId)).toEqual({ status: 'live', location: 'live' });
  // DoD spot-check: public availability matches the hours on 3 days (9:00–19:00, 30-min service)
  const svc = await firstService(biz.businessId);
  for (const offset of [1, 2, 3]) {
    const slots = await publicSlots(biz.locationId, svc, await beirutDate(offset));
    expect(slots[0]).toBe('09:00');
    expect(slots.at(-1)).toBe('18:30');
  }

  // ── the schedule editor produces the expected availability (same session) ──
  await page.goto(`/biz/${biz.businessId}/staff`);
  await page.getByTestId('staff-list').getByRole('link').first().click();
  await page.getByRole('tab', { name: 'Schedule' }).click();
  // Monday 10:00–12:00, copied to every day
  await page.getByLabel('Monday start 1').fill('10:00');
  await page.getByLabel('Monday end 1').fill('12:00');
  await page.getByRole('button', { name: 'Copy to all' }).click();
  await page.getByRole('button', { name: 'Save weekly hours' }).click();
  await expect(page.getByText('Weekly hours saved')).toBeVisible();
  await expect(page.getByTestId('schedule-preview')).toContainText('10:00–12:00');

  const slots = await publicSlots(biz.locationId, svc, await beirutDate(2));
  expect(slots).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
});

test('reception sees the desk tools but not services or settings', async ({ page }) => {
  test.setTimeout(120_000);
  // reception's account exists after its first sign-in; then the owner's team adds it
  await page.goto('/biz/login');
  await signIn(page, '70 000 008');
  await expect(page).toHaveURL(/\/biz$/);
  await addMemberByPhone(biz.businessId, '96170000008', 'reception');
  await page.goto(`/biz/${biz.businessId}`);
  const nav = page.getByRole('navigation', { name: 'Business navigation (mobile)' });
  await expect(nav.getByText('Customers')).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('Staff')).toBeVisible();
  await expect(menu.getByText('Services')).toHaveCount(0);
  await expect(menu.getByText('Settings')).toHaveCount(0);
  await page.goto(`/biz/${biz.businessId}/services`);
  await expect(page.getByText('Only owners and managers can change services.')).toBeVisible();
});
