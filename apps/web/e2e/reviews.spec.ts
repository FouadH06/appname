import { expect, test, type Page } from '@playwright/test';
import {
  addMemberByPhone,
  ageReviewsOf,
  businessSlug,
  closePool,
  createBusiness,
  createShadowVisit,
  replyState,
  reportFor,
  reviewState,
  reviewToken,
} from './support/db';

// M9 · verified reviews on the local stack: review link (claim a business-logged visit) → stars
// published at once → the moderation worker publishes the comment with the phone number removed →
// public page → the business replies (moderated) and reports. Local stack only.
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'mobile', 'customers review on their phones');
});
test.afterAll(closePool);

const FUNCTIONS = 'http://127.0.0.1:54321/functions/v1';
const MODERATE_SECRET = 'local-moderate-secret'; // supabase/config.toml [edge_runtime.secrets]

async function verifyPhone(page: Page, local: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(local);
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await flow.getByLabel('6-digit code').fill('123456');
}

const runWorker = () =>
  fetch(`${FUNCTIONS}/moderate`, {
    method: 'POST',
    headers: { 'x-moderate-secret': MODERATE_SECRET },
  });

test('review link → stars live → comment moderated → public page → business reply and report', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ageReviewsOf('96170000013');
  const b = await createBusiness('Review Salon');
  const visit = await createShadowVisit(b, '+96170000013', 1);
  const token = await reviewToken(visit);
  const slug = await businessSlug(b.businessId);

  await test.step('customer opens the WhatsApp review link, verifies the phone, rates the visit', async () => {
    await page.goto(`/review/${token}`);
    await expect(page.getByRole('heading', { name: `Review ${b.name}` })).toBeVisible();
    await verifyPhone(page, '70 000 013');
    const form = page.getByTestId('review-form');
    await expect(form).toBeVisible({ timeout: 30_000 });
    await expect(form.getByTestId('review-visit')).toContainText('Verified visit');
    await form.getByRole('radio', { name: '5 stars' }).first().click();
    await form
      .getByRole('radiogroup', { name: 'Cleanliness' })
      .getByRole('radio', { name: '4 stars' })
      .click();
    await form
      .getByPlaceholder('What went well? What could be better?')
      .fill('Great fade by Karim, very clean place. Call me on 71 123 456 for the address.');
    await expect(form.getByTestId('phone-hint')).toBeVisible();
    await form.getByTestId('submit-review').click();
    await expect(page.getByTestId('review-thanks')).toContainText('Your rating is live');
    await expect(page.getByTestId('review-state')).toContainText('comment being checked');
    expect(await reviewState(visit)).toMatchObject({
      rating_state: 'active',
      text_state: 'pending',
    });
  });

  await test.step('the worker publishes the comment without the phone number', async () => {
    const unauthorized = await fetch(`${FUNCTIONS}/moderate`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);
    await expect
      .poll(
        async () => {
          await runWorker();
          return reviewState(visit);
        },
        { timeout: 60_000 },
      )
      .toMatchObject({
        text_state: 'approved_redacted',
        text_display:
          'Great fade by Karim, very clean place. Call me on [removed] for the address.',
      });
  });

  await test.step('the business page shows the verified review (after the 1-minute page cache)', async () => {
    await expect
      .poll(
        async () => {
          await page.goto(`/${slug}`);
          return page.getByTestId('review-card').first().textContent();
        },
        { timeout: 90_000, intervals: [5_000] },
      )
      .toContain('[removed]');
    const card = page.getByTestId('review-card').first();
    await expect(card).toContainText('Verified visit');
    await expect(card).not.toContainText('71 123 456');
    await expect(page.getByTestId('rating-headline')).toContainText('1 verified review');
  });

  await test.step('the business replies (moderated) and reports; it cannot hide the review', async () => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto('/biz/login');
    await verifyPhone(page, '70 000 014');
    // signed in = redirected to the business list (/biz/login also matches a loose /\/biz/)
    await expect(page).toHaveURL(/\/biz$/, { timeout: 30_000 });
    await addMemberByPhone(b.businessId, '96170000014', 'manager');
    await page.goto(`/biz/${b.businessId}/reviews`);
    await expect(page.getByTestId('needs-reply-count')).toHaveText('1');
    const card = page.getByTestId('review-card').first();
    await card.getByTestId('reply').click();
    await card.getByLabel('Reply').fill('Thank you! See you next time.');
    await card.getByTestId('send-reply').click();
    await expect(page.getByText('Reply sent.')).toBeVisible();
    await expect(page.getByTestId('reviews-empty')).toHaveText('You’re all caught up.');
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page.getByTestId('reply-state').first()).toContainText('being checked');
    await expect
      .poll(
        async () => {
          await runWorker();
          return replyState(visit);
        },
        { timeout: 60_000 },
      )
      .toBe('approved');
    await page.reload();
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page.getByTestId('review-card').first().getByTestId('review-reply')).toContainText(
      'Thank you! See you next time.',
    );
    const all = page.getByTestId('review-card').first();
    await all.getByTestId('report').click();
    await all.getByLabel('Shares personal information').check();
    await all.getByTestId('send-report').click();
    await expect(page.getByTestId('report-status').first()).toContainText('under review');
    expect(await reportFor(visit)).toEqual({ reason: 'personal_information', status: 'in_review' });
    await expect(page.getByText('can’t be removed or hidden by businesses')).toBeVisible();
  });
});
