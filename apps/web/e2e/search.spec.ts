import { expect, test } from '@playwright/test';
import {
  businessSlug,
  closePool,
  createBusiness,
  refreshSearch,
  zeroResultLogged,
} from './support/db';

// M12 · search & discovery on the local stack: a new live barber becomes searchable (suggestion by
// name → its page), Arabizi service search in its cluster with the service price on the card, a filter
// that removes it and back, the SEO landing page, and "Not on APP_NAME yet" (logged as zero-result).
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.afterAll(closePool);

test('find, filter and land on a business through search', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await createBusiness('Searchable Barber');
  await refreshSearch(b.businessId);
  const name = b.name;
  const slug = await businessSlug(b.businessId);

  await test.step('suggestion by business name opens its page', async () => {
    await page.goto('/?cluster=hazmieh-baabda');
    await expect(page.getByTestId('search-box')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    // retype until the suggestion shows (a dev server may reload the page after an on-demand compile)
    const suggestion = page.getByTestId('suggestion-business').filter({ hasText: name });
    await expect(async () => {
      await page.getByTestId('search-input').fill('');
      await page.getByTestId('search-input').fill(name.split(' ').pop()!);
      await expect(suggestion).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
    await suggestion.click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`), { timeout: 30_000 });
  });

  await test.step('Arabizi "7ala2" in Hazmieh / Baabda → card with the service price and its next time', async () => {
    await page.goto('/?cluster=hazmieh-baabda');
    await expect(page.getByTestId('search-box')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await page.getByTestId('search-input').fill('7ala2');
    await page.getByTestId('search-input').press('Enter');
    await expect(page).toHaveURL(/\/search\?q=7ala2&cluster=/);
    const card = page.getByTestId('business-card').filter({ hasText: name });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId('card-service')).toContainText('Haircut');
    await expect(card).toContainText('$15');
    // the earliest time is the card's booking shortcut
    await expect(card.getByTestId('card-next')).toHaveAttribute(
      'href',
      new RegExp(`/${slug}/book\\?service=`),
    );
  });

  await test.step('a filter it fails removes it; removing the filter brings it back', async () => {
    await page.getByRole('link', { name: 'Rating 4.5+' }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/rating=4.5/);
    await expect(page.getByTestId('business-card').filter({ hasText: name })).toHaveCount(0);
    await page.getByRole('link', { name: 'Rating 4.5+' }).filter({ visible: true }).click();
    await expect(page.getByTestId('business-card').filter({ hasText: name })).toBeVisible();
  });

  await test.step('SEO landing /hazmieh/barber renders with its SEO title and cards', async () => {
    await page.goto('/hazmieh/barber');
    await expect(page.getByTestId('landing-title')).toHaveText('Barber in Hazmieh');
    await expect(page).toHaveTitle(/Barber in Hazmieh · Book online/);
    // cached for 5 minutes and capped at 24 cards (local runs accumulate test barbers here): just cards
    await expect(page.getByTestId('business-card').first()).toBeVisible();
  });

  await test.step('"dentist": not on APP_NAME yet, logged for the catalog team', async () => {
    await page.goto('/search?q=dentist');
    await expect(page.getByTestId('not-offered')).toContainText('Not on APP_NAME yet');
    expect(await zeroResultLogged('dentist')).toBe(true);
  });
});
