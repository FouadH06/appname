import { devices, expect, test, type Page } from '@playwright/test';
import {
  addMemberByPhone,
  ageReviewsOf,
  businessSlug,
  closePool,
  createBusiness,
  createShadowVisit,
  reviewToken,
} from './support/db';
import { runMediaOrchestrator, runMediaWorker, uniquePhoto } from './support/media';

// M10 · customer results on the local stack: review → consent → photo prepared on the device and
// uploaded privately → worker (sharp) → orchestrator (local classifier) → published → business page
// strip, results grid, result detail with "Book similar" → the business features it → the customer
// removes it and it disappears. Local stack only.
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'mobile', 'customers share results from their phones');
});
test.afterAll(closePool);

async function verifyPhone(page: Page, local: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(local);
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await flow.getByLabel('6-digit code').fill('123456');
}

test('share a result → checked → published → featured → removed', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await ageReviewsOf('96170000015');
  const b = await createBusiness('Results Salon');
  const visit = await createShadowVisit(b, '+96170000015', 1);
  const slug = await businessSlug(b.businessId);
  let reviewUrl = '';

  await test.step('rate the visit, then share a photo (consent first)', async () => {
    reviewUrl = `/review/${await reviewToken(visit)}`;
    await page.goto(reviewUrl);
    await verifyPhone(page, '70 000 015');
    const form = page.getByTestId('review-form');
    await expect(form).toBeVisible({ timeout: 30_000 });
    await form.getByRole('radio', { name: '5 stars' }).first().click();
    await form.getByTestId('submit-review').click();
    const up = page.getByTestId('result-uploader');
    await expect(up.getByTestId('photo-consent')).toBeVisible();
    await expect(up.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await up.getByLabel('I have permission to share this image').check();
    await up.getByRole('button', { name: 'Continue' }).click();
    await up.getByTestId('photo-input').setInputFiles(await uniquePhoto(page));
    await expect(up.getByTestId('my-photo')).toHaveAttribute('data-state', 'pending', {
      timeout: 30_000,
    });
    await expect(up.getByTestId('my-photo')).toContainText('In review');
  });

  await test.step('worker + orchestrator: checked and published', async () => {
    await expect.poll(() => runMediaWorker().classify, { timeout: 60_000 }).toBeGreaterThan(0);
    await expect
      .poll(async () => (await runMediaOrchestrator()).published, { timeout: 60_000 })
      .toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId('my-photo')).toHaveAttribute('data-state', 'approved', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('my-photo')).toContainText('Live on the business page');
  });

  let resultUrl = '';
  await test.step('business page strip → results grid → result detail with "Book similar"', async () => {
    await expect
      .poll(
        async () => {
          await page.goto(`/${slug}`);
          return page.getByTestId('result-tile').count();
        },
        { timeout: 90_000, intervals: [5_000] },
      )
      .toBeGreaterThan(0);
    await page.getByRole('link', { name: /See all 1 results/ }).click();
    await expect(page.getByRole('heading', { name: 'Customer results' })).toBeVisible();
    await page.getByTestId('results-grid').getByTestId('result-tile').first().click();
    await expect(page.getByTestId('result-detail')).toBeVisible();
    resultUrl = page.url();
    await expect(page.getByTestId('trust-mark')).toContainText('Verified visit');
    await expect(page.getByTestId('book-similar')).toHaveAttribute(
      'href',
      new RegExp(`/${slug}/book\\?service=${b.serviceId}`),
    );
    const img = page.getByTestId('result-detail').locator('img').first();
    await expect(img).toHaveAttribute('src', /\/storage\/v1\/object\/public\/ugc-public\//);
  });

  await test.step('the business features it (no hide or delete control exists)', async () => {
    // separate context: the customer's session on `page` stays signed in for the last step
    const ctx = await browser.newContext({
      ...devices['Pixel 7'],
      baseURL: test.info().project.use.baseURL,
    });
    const biz = await ctx.newPage();
    await biz.goto('/biz/login');
    await verifyPhone(biz, '70 000 016');
    await expect(biz).toHaveURL(/\/biz$/, { timeout: 30_000 });
    await addMemberByPhone(b.businessId, '96170000016', 'manager');
    await biz.goto(`/biz/${b.businessId}/reviews`);
    await biz.getByRole('tab', { name: 'Customer photos' }).click();
    const tile = biz.getByTestId('biz-result').first();
    await tile.getByTestId('feature').click();
    await expect(tile).toContainText('Featured #1');
    await expect(biz.getByTestId('results-featuring')).not.toContainText(/hide|delete/i);
    await ctx.close();
  });

  await test.step('the customer removes the photo → gone from the page', async () => {
    await page.goto(reviewUrl);
    const photo = page.getByTestId('my-photo');
    await expect(photo).toBeVisible({ timeout: 30_000 });
    page.once('dialog', (d) => void d.accept());
    await photo.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('my-photo')).toHaveCount(0);
    await expect
      .poll(
        async () => {
          await page.goto(resultUrl);
          return page.getByTestId('result-removed').count();
        },
        { timeout: 90_000, intervals: [5_000] },
      )
      .toBe(1);
  });
});
