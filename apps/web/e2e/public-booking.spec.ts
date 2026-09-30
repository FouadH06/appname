import { expect, test, type Page } from '@playwright/test';
import {
  businessSlug,
  closePool,
  createCalendarBusiness,
  latestBooking,
  notificationsFor,
  renameSlug,
  setCancellationWindow,
  setBookingMode,
  setStaffPublic,
} from './support/db';

// M8 · the public funnel on a phone: business page → service → (staff) → time → phone code →
// confirm → success → My bookings → cancel; request mode; old-slug redirect. Local stack only.
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile funnel (the primary surface)');
});
test.afterAll(closePool);

async function verifyPhone(page: Page, local: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(local);
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await flow.getByLabel('6-digit code').fill('123456');
}

async function pickFirstSlot(page: Page) {
  const time = page.getByTestId('step-time');
  await expect(time).toBeVisible();
  const slot = time.getByTestId('slots').first().getByRole('button').first();
  await expect(slot).toBeEnabled({ timeout: 45_000 }); // Turnstile token for the anonymous session
  const label = (await slot.textContent())!.replace(/Instant|Request/, '').trim();
  await slot.click();
  await page.getByTestId('time-continue').click(); // pick, then continue (the hold is taken here)
  return label;
}

test('Instagram link → booked in under a minute; reschedule (Any available) and cancel; request mode; old slug', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const b = await createCalendarBusiness('Web Salon');
  const slug = await businessSlug(b.businessId);
  await setStaffPublic(b.mayaId, false); // internal-only staff must never show publicly
  // the first free slot can be minutes away (staff work from 09:00, no notice): keep it changeable
  await setCancellationWindow(b.businessId, 0);

  await test.step('business page: identity, services, only public staff', async () => {
    await page.goto(`/${slug}?utm_source=instagram`);
    await expect(page.getByTestId('business-name')).toHaveText(b.name);
    await expect(
      page.getByTestId('service-row').filter({ hasText: 'Haircut' }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('team')).toContainText('Karim');
    await expect(page.locator('body')).not.toContainText('Maya');
    await expect(page.getByTestId('book-cta')).toBeVisible();
  });

  await test.step('book: single eligible staff member is auto-selected', async () => {
    await page.getByRole('link', { name: 'Book Haircut' }).first().click();
    await expect(page.getByTestId('step-time')).toContainText('with Karim');
    const label = await pickFirstSlot(page);
    const review = page.getByTestId('step-review');
    await expect(review).toBeVisible();
    await expect(review.getByTestId('summary-time')).toContainText(label);
    await expect(review.getByTestId('hold-timer')).toContainText('holding this time');
    await expect(review.getByTestId('confirm-booking')).toBeDisabled();
    await verifyPhone(page, '70 000 012');
    await expect(review.getByTestId('phone-verified')).toBeVisible();
    const first = review.getByLabel('First name');
    if (await first.isVisible()) await first.fill('Rana');
    await review.getByLabel(/Note to/).fill('Short on the sides please');
    await review.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('booking-success')).toContainText('Booking confirmed');
    await expect(page.getByTestId('booking-status')).toHaveText('Confirmed');
  });

  const booking = await latestBooking(b.businessId);
  expect((await notificationsFor(booking)).map((n) => n.type)).toContain('booking_confirmed');

  await test.step('My bookings → detail → cancel (acknowledgement queued)', async () => {
    await page.goto('/bookings');
    const card = page.getByTestId('my-booking').filter({ hasText: b.name }).first();
    await expect(card).toContainText('Haircut');
    await card.click();

    // reschedule with "Any available": the assigned person is shown before confirming
    await setStaffPublic(b.mayaId, true);
    await page.getByRole('button', { name: 'Reschedule' }).click();
    await page.getByRole('radio', { name: 'Any available' }).click();
    await page.getByTestId('reschedule-slots').getByRole('button').first().click();
    const confirmPanel = page.getByTestId('reschedule-confirm');
    await expect(confirmPanel.getByTestId('reschedule-with')).toHaveText(/Karim|Maya/);
    const who = (await confirmPanel.getByTestId('reschedule-with').textContent())!.trim();
    await confirmPanel.getByRole('button', { name: 'Confirm new time' }).click();
    await expect(page.getByRole('status').filter({ hasText: `with ${who}` })).toBeVisible();
    await expect(page.getByTestId('booking-detail')).toContainText(`with ${who}`);

    await page.getByTestId('cancel-booking').click();
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('booking-status')).toHaveText('Cancelled');
    await expect
      .poll(async () => (await notificationsFor(booking)).map((n) => n.type))
      .toContain('booking_cancelled_by_customer');
  });

  await test.step('request mode: Any available (default) → "Send request" → "Request sent"', async () => {
    await setBookingMode(b.businessId, 'request');
    await page.goto(`/${slug}/book?service=${b.serviceId}`);
    const staff = page.getByTestId('step-staff');
    await expect(staff.getByRole('radio', { name: /Any available/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await staff.getByTestId('staff-continue').click();
    await pickFirstSlot(page);
    const review = page.getByTestId('step-review');
    await expect(review.getByTestId('summary-staff')).toContainText('You’ll be with');
    await expect(review.getByTestId('phone-verified')).toBeVisible(); // already signed in
    await expect(review.getByTestId('confirm-booking')).toContainText('Send booking request');
    await review.getByTestId('confirm-booking').click();
    await expect(page.getByTestId('booking-success')).toContainText('Request sent');
  });

  await test.step('renamed business: the old link redirects', async () => {
    await renameSlug(b.businessId, `${slug}-new`);
    // the page is cached for a minute, so the old address redirects once that copy expires
    await expect
      .poll(
        async () => {
          await page.goto(`/${slug}`);
          return page.url();
        },
        { timeout: 90_000, intervals: [5_000] },
      )
      .toMatch(new RegExp(`/${slug}-new$`));
    await expect(page.getByTestId('business-name')).toHaveText(b.name);
  });
});
