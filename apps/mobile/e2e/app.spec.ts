import { expect, test, type Page } from '@playwright/test';
import {
  bookingAttribution,
  bookingStatus,
  businessSlug,
  closeAppPool,
  closePool,
  completeInPast,
  createCalendarBusiness,
  favoriteCount,
  issueClaimToken,
  latestBooking,
  refreshSearch,
  setCancellationWindow,
} from './support/db';

// M13 · the customer app (web build of the same Expo code) on a phone viewport: discover → book with
// phone verification → booking detail → cancel; Book again from Home; review; favorites; inbox;
// deep links. Local stack only (fixtures commit data).
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.afterAll(async () => {
  await closePool();
  await closeAppPool();
});

async function verifyPhone(page: Page, local: string) {
  const flow = page.getByTestId('phone-sign-in').last();
  await flow.getByLabel('Phone number').fill(local);
  const send = flow.getByTestId('send-code');
  await expect(send).toBeEnabled({ timeout: 45_000 }); // Turnstile token arrived from the /captcha iframe
  await send.click();
  await flow.getByLabel('6-digit code').fill('123456');
}

async function pickFirstSlot(page: Page) {
  const slot = page.getByTestId('step-time').getByTestId('slot').first();
  await expect(slot).toBeEnabled({ timeout: 45_000 });
  await slot.click();
}

test('app: discover → book → manage → rebook → review → favorites → inbox → deep links', async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.on('dialog', (d) => void d.accept()); // confirmAction on the web build uses window.confirm
  const b = await createCalendarBusiness('App Salon');
  const slug = await businessSlug(b.businessId);
  await setCancellationWindow(b.businessId, 0);
  await refreshSearch(b.businessId);

  await test.step('explore: search suggestions find the business', async () => {
    await page.goto('/');
    await page.getByTestId('home-search').click();
    await page.getByTestId('search-input').fill(b.name);
    await expect(
      page.getByTestId('suggestion-business').filter({ hasText: b.name }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('suggestion-business').filter({ hasText: b.name }).first().click();
    await expect(page.getByTestId('business-profile')).toBeVisible();
    await expect(
      page.getByTestId('service-row').filter({ hasText: 'Haircut' }).first(),
    ).toBeVisible();
  });

  await test.step('favorite while signed out asks to sign in', async () => {
    await page.getByTestId('favorite').click();
    await expect(page.getByTestId('phone-sign-in')).toBeVisible();
    await page.goBack();
  });

  let first = '';
  await test.step('book as a guest: slot → verify phone → confirm → success', async () => {
    await page.goto(`/${slug}`);
    await page.getByTestId('book-service').first().click();
    await page.getByTestId('staff-option').filter({ hasText: 'Karim' }).click();
    await pickFirstSlot(page);
    const review = page.getByTestId('step-review');
    await expect(review.getByTestId('hold-timer')).toContainText('holding this time');
    await verifyPhone(page, '70 000 013');
    const name = review.getByLabel('First name');
    await expect(review.getByTestId('confirm')).toBeVisible({ timeout: 20_000 });
    if (await name.isVisible()) await name.fill('Nour');
    await review.getByTestId('confirm').click();
    await expect(page.getByTestId('booking-success')).toContainText('You’re booked');
    first = await latestBooking(b.businessId);
    expect(await bookingAttribution(first)).toEqual({
      source: 'marketplace_other',
      channel: 'app',
    });
    await expect(page.getByTestId('push-prompt')).toHaveCount(0); // never on the web build
  });

  await test.step('booking detail → cancel with confirm', async () => {
    await page.getByTestId('view-booking').click();
    await expect(page.getByTestId('booking-status')).toHaveText('Confirmed');
    await page.getByTestId('cancel').click();
    await expect(page.getByTestId('booking-status')).toHaveText('Cancelled');
    expect(await bookingStatus(first)).toBe('cancelled');
  });

  let second = '';
  await test.step('book again (signed in, no phone step) and complete it in the past', async () => {
    await page.goto(`/${slug}`);
    await page.getByTestId('book-service').first().click();
    await page.getByTestId('staff-option').filter({ hasText: 'Karim' }).click();
    await pickFirstSlot(page);
    await page.getByTestId('step-review').getByTestId('confirm').click();
    await expect(page.getByTestId('booking-success')).toBeVisible();
    second = await latestBooking(b.businessId);
    await completeInPast(second);
  });

  await test.step('Home: Book again with Karim → time step with Karim preset', async () => {
    await page.goto('/');
    const card = page.getByTestId('rebook-card').filter({ hasText: b.name });
    await expect(card).toContainText('Karim');
    await card.getByTestId('rebook').click();
    await expect(page.getByTestId('step-time')).toContainText('with Karim');
    await pickFirstSlot(page);
    await page.getByTestId('step-review').getByTestId('confirm').click();
    await expect(page.getByTestId('booking-success')).toBeVisible();
    expect((await bookingAttribution(await latestBooking(b.businessId))).source).toBe('rebook');
  });

  await test.step('Bookings tab → past visit → leave a review', async () => {
    await page.goto('/bookings');
    await page.getByTestId('tab-past').click();
    await page
      .getByTestId('booking-card')
      .filter({ hasText: b.name })
      .filter({ hasText: 'Completed' })
      .first()
      .click();
    await expect(page.getByTestId('booking-status')).toHaveText('Completed');
    await page.getByTestId('leave-review').click();
    await expect(page.getByTestId('review-form')).toBeVisible();
    await page.getByTestId('star-5').click();
    await page.getByTestId('submit-review').click();
    await expect(page.getByTestId('review-thanks')).toBeVisible();
    await expect(page.getByTestId('photo-consent')).toBeVisible(); // C16 starts with consent
  });

  await test.step('favorites: save on the profile, list, remove', async () => {
    await page.goto(`/${slug}`);
    await page.getByTestId('favorite').click();
    await expect.poll(() => favoriteCount(b.businessId)).toBe(1);
    await page.goto('/favorites');
    const row = page.getByTestId('favorite-row').filter({ hasText: b.name });
    await expect(row).toBeVisible();
    await row.getByTestId('unfavorite').click();
    await expect(row).toHaveCount(0);
    await expect.poll(() => favoriteCount(b.businessId)).toBe(0);
  });

  await test.step('inbox: booking messages listed; a row opens the booking', async () => {
    await page.goto('/notifications');
    const rows = page.getByTestId('inbox-row');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId('inbox')).toContainText(b.name);
    await rows.filter({ hasText: 'cancelled' }).first().click();
    await expect(page.getByTestId('booking-detail')).toBeVisible();
  });

  await test.step('deep links: magic link, removed result, unknown page', async () => {
    const token = await issueClaimToken(first);
    await page.goto(`/m/${token}`);
    await expect(page.getByTestId('booking-summary')).toContainText('Haircut');
    await page.goto('/r/00000000-0000-0000-0000-000000000000');
    await expect(page.getByTestId('result-removed')).toBeVisible();
    await page.goto('/no-such-business');
    await expect(page.getByText(/This page doesn.t exist/)).toBeVisible();
  });

  await test.step('offline: banner appears and clears', async () => {
    await page.goto('/');
    await page.context().setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  });

  await test.step('profile: preferences load; log out returns to signed-out state', async () => {
    await page.goto('/profile');
    await expect(page.getByTestId('notification-preferences')).toContainText('WhatsApp');
    await page.getByTestId('log-out').click();
    await page.goto('/bookings');
    await expect(page.getByTestId('phone-sign-in')).toBeVisible();
  });
});
