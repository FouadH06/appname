import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addBooking,
  addMemberByPhone,
  beirutAt,
  beirutDate,
  bookingRow,
  closePool,
  createCalendarBusiness,
  creationTimings,
  linkStaffUser,
} from './support/db';

// M6 · calendar & daily operations on the local stack: speed targets for manual bookings,
// keyboard flow, Undo, walk-in, drag-to-move with conflict toast, reassign, block time with the
// affected-booking flow, customer detail, Realtime between two tabs, staff history, role scope.
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'grid views: desktop project (phones open the agenda)',
  );
});
test.afterAll(closePool);
// tall enough that the whole working day is on screen for mouse drags
test.use({ viewport: { width: 1440, height: 1500 } });

async function signIn(page: Page, local: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(local);
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await flow.getByLabel('6-digit code').fill('123456');
}

/** Point inside a grid column at a Beirut wall-clock minute (columns expose their scale). */
async function at(col: Locator, minutes: number) {
  const from = Number(await col.getAttribute('data-from'));
  const ppm = Number(await col.getAttribute('data-ppm'));
  return { x: 30, y: (minutes - from) * ppm + 3 };
}

async function drag(page: Page, block: Locator, col: Locator, minutes: number) {
  const src = (await block.boundingBox())!;
  const dst = (await col.boundingBox())!;
  const p = await at(col, minutes);
  await page.mouse.move(src.x + 10, src.y + 4);
  await page.mouse.down();
  await page.mouse.move(src.x + 30, src.y + 30, { steps: 4 });
  await page.mouse.move(dst.x + p.x, dst.y + p.y + 1, { steps: 8 });
  await page.mouse.up();
}

test('reception runs the day from the calendar', async ({ page, context }) => {
  test.setTimeout(300_000);
  const b = await createCalendarBusiness('Cal Salon');
  const day = await beirutDate(1);
  await addBooking(b, b.mayaId, b.serviceId, null, await beirutAt(1, '12:00'));

  await page.goto('/biz/login');
  await signIn(page, '70 000 009');
  await expect(page).toHaveURL(/\/biz$/);
  await addMemberByPhone(b.businessId, '96170000009', 'reception');
  await page.goto(`/biz/${b.businessId}/calendar?date=${day}`);
  await page.getByRole('tab', { name: 'Day · Columns' }).click();
  const karim = page.getByTestId(`col-${b.staffId}`);
  const maya = page.getByTestId(`col-${b.mayaId}`);
  await expect(karim).toBeVisible();
  const drawer = page.getByTestId('new-appointment');
  const toast = page.getByTestId('toast');

  await test.step('existing customer: ≤ 4 interactions from the slot', async () => {
    let n = 0;
    await karim.click({ position: await at(karim, 600) });
    n++;
    await drawer.getByLabel('Phone or name').fill('71 555 111');
    n++;
    await expect(drawer.getByTestId('customer-options')).toContainText('Lina Khoury');
    await drawer.getByLabel('Phone or name').press('Enter');
    n++;
    await expect(drawer.getByTestId('save-appointment')).toContainText(
      'Lina · Haircut · Karim · 10:00 AM',
    );
    await drawer.getByTestId('save-appointment').click();
    n++;
    expect(n).toBeLessThanOrEqual(4);
    await expect(toast.first()).toContainText('Saved · Lina · Haircut · Karim · 10:00 AM');
    await expect(karim.getByTestId('appt')).toHaveCount(1);
  });

  await test.step('new customer: ≤ 6 interactions', async () => {
    let n = 0;
    await karim.click({ position: await at(karim, 660) });
    n++;
    await drawer.getByLabel('Phone or name').fill('76 444 333');
    n++;
    await drawer.getByLabel('Phone or name').press('Enter');
    n++;
    await drawer.getByLabel('First name').fill('Rami');
    n++;
    await drawer.getByTestId('save-appointment').click();
    n++;
    expect(n).toBeLessThanOrEqual(6);
    await expect(karim.getByTestId('appt')).toHaveCount(2);
  });

  await test.step('keyboard only: N → phone → Enter → time → Enter, then Undo', async () => {
    await page.getByTestId('calendar-title').click();
    await page.keyboard.press('n');
    await expect(drawer).toBeVisible();
    await page.keyboard.type('71555111');
    await expect(drawer.getByTestId('customer-options')).toContainText('Lina Khoury');
    await page.keyboard.press('Enter');
    await expect(drawer.getByLabel('Time')).toBeFocused();
    await page.keyboard.type('17:30');
    await page.keyboard.press('Enter');
    await expect(drawer).toHaveCount(0);
    const saved = toast.filter({ hasText: 'Saved · Lina' }).last();
    await expect(page.getByTestId('appt')).toHaveCount(4);
    await saved.getByRole('button', { name: 'Undo' }).click();
    await expect(toast.filter({ hasText: 'Undone' })).toBeVisible();
    await expect(page.getByTestId('appt')).toHaveCount(3);
  });

  await test.step('conflict toast when dragging onto a busy colleague', async () => {
    const lina = karim.getByTestId('appt').filter({ hasText: 'Lina Khoury' });
    await drag(page, lina, maya, 720);
    await page
      .getByTestId('move-confirm')
      .getByRole('button', { name: 'Move', exact: true })
      .click();
    await expect(
      toast.filter({ hasText: 'Maya Test already has an appointment 12:00 PM–12:30 PM' }),
    ).toBeVisible();
    await expect(karim.getByTestId('appt').filter({ hasText: 'Lina Khoury' })).toHaveCount(1);
  });

  await test.step('drag to move within the column', async () => {
    await drag(page, karim.getByTestId('appt').filter({ hasText: 'Lina Khoury' }), karim, 900);
    await page
      .getByTestId('move-confirm')
      .getByRole('button', { name: 'Move', exact: true })
      .click();
    await expect(toast.filter({ hasText: 'Moved to 3:00 PM' })).toBeVisible();
  });

  await test.step('reassign to a free colleague', async () => {
    await karim.getByTestId('appt').filter({ hasText: 'Lina Khoury' }).click();
    const bd = page.getByTestId('booking-drawer');
    await bd.getByRole('button', { name: 'Change staff' }).click();
    await bd.getByRole('button', { name: 'Give to Maya' }).click();
    await expect(bd.getByTestId('drawer-staff')).toContainText('Maya Test');
    await page.keyboard.press('Escape');
    await expect(maya.getByTestId('appt').filter({ hasText: 'Lina Khoury' })).toHaveCount(1);
  });

  await test.step('block time over a booking → reassign it', async () => {
    await page.getByRole('button', { name: 'Block time for Karim Test' }).click();
    const bt = page.getByTestId('block-time');
    await bt.getByLabel('From').fill('11:00');
    await bt.getByLabel('To').fill('11:30');
    await bt.getByRole('button', { name: 'Block time' }).click();
    const affected = bt.getByTestId('affected-bookings');
    await expect(affected).toContainText('Rami');
    await affected.getByRole('button', { name: 'Reassign' }).click();
    await affected.getByRole('button', { name: 'Give to Maya' }).click();
    await expect(
      toast.filter({ hasText: 'Time blocked. Bookings handled: 1 reassigned' }),
    ).toBeVisible();
    await expect(karim.getByTestId('time-off')).toHaveCount(1);
    await expect(maya.getByTestId('appt').filter({ hasText: 'Rami' })).toHaveCount(1);
  });

  await test.step('walk-in now', async () => {
    await page.getByRole('button', { name: 'Walk-in', exact: true }).click();
    await expect(drawer).toContainText('Walk-in');
    await drawer.getByLabel('Staff').selectOption({ label: 'Karim Test' });
    await drawer.getByTestId('save-appointment').click();
    // outside 09:00–19:00 the drawer offers the manual override
    const err = drawer.getByTestId('appointment-error');
    const saved = toast.filter({ hasText: 'Saved · Walk-in' });
    await expect(err.or(saved)).toBeVisible();
    if (await err.isVisible()) {
      await err.getByRole('button', { name: 'Book outside hours anyway' }).click();
      await drawer.getByTestId('save-appointment').click();
    }
    await expect(saved).toBeVisible();
  });

  await test.step('customer detail: stats, pinned note', async () => {
    await page.goto(`/biz/${b.businessId}/customers/${b.linaId}`);
    await expect(page.getByTestId('customer-stats')).toContainText('Visits');
    await page.getByLabel('Add a note').fill('Allergic to ammonia dyes');
    await page.getByRole('switch', { name: 'Pin (shows on the calendar)' }).check();
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByTestId('customer-notes')).toContainText('📌 Allergic to ammonia dyes');
  });

  await test.step('Realtime: a booking made in tab A appears in tab B within 2 s', async () => {
    const tabB = await context.newPage();
    await tabB.goto(`/biz/${b.businessId}/calendar?date=${day}`);
    const karimB = tabB.getByTestId(`col-${b.staffId}`);
    await expect(karimB).toBeVisible();
    const before = await karimB.getByTestId('appt').count();
    await page.goto(`/biz/${b.businessId}/calendar?date=${day}`);
    await karim.click({ position: await at(karim, 960) });
    await drawer.getByLabel('Phone or name').fill('71 555 111');
    await expect(drawer.getByTestId('customer-options')).toContainText('Lina Khoury');
    await drawer.getByLabel('Phone or name').press('Enter');
    await drawer.getByTestId('save-appointment').click();
    await expect(toast.filter({ hasText: 'Saved · Lina' })).toBeVisible();
    await expect(karimB.getByTestId('appt')).toHaveCount(before + 1, { timeout: 2_000 });
    await tabB.close();
  });

  await test.step('Gate B: each save records a privacy-safe creation time', async () => {
    const rows = await creationTimings(b.businessId);
    expect(rows.slice(0, 3).map((r) => [r.customer_kind, r.flow])).toEqual([
      ['existing', 'slot'],
      ['new', 'slot'],
      ['existing', 'keyboard'],
    ]);
    expect(
      rows.every(
        (r) => r.actor_role === 'reception' && r.duration_ms > 0 && r.duration_ms < 120_000,
      ),
    ).toBe(true);
    expect(rows.some((r) => r.customer_kind === 'walk_in' && r.flow === 'walk_in')).toBe(true);
  });

  await test.step('staff booking history and the bookings list', async () => {
    await page.goto(`/biz/${b.businessId}/staff/${b.mayaId}`);
    await page.getByRole('tab', { name: 'Bookings' }).click();
    await expect(page.getByTestId('staff-bookings')).toContainText('Rami');
    await page.goto(`/biz/${b.businessId}/bookings`);
    await page.getByLabel('Search bookings').fill('Rami');
    await expect(page.getByTestId('bookings-list').getByRole('listitem')).toHaveCount(1);
  });
});

test('staff see only their own column', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await createCalendarBusiness('Cal Staff');
  const day = await beirutDate(1);
  const mine = await addBooking(b, b.staffId, b.serviceId, b.linaId, await beirutAt(1, '10:00'));
  await addBooking(b, b.mayaId, b.serviceId, null, await beirutAt(1, '10:00'));

  await page.goto('/biz/login');
  await signIn(page, '70 000 010');
  await expect(page).toHaveURL(/\/biz$/);
  await linkStaffUser(b.businessId, b.staffId, '96170000010');
  await page.goto(`/biz/${b.businessId}/calendar?date=${day}`);
  await page.getByRole('tab', { name: 'Day · Columns' }).click();
  await expect(page.getByTestId(`col-${b.staffId}`)).toBeVisible();
  await expect(page.getByTestId(`col-${b.mayaId}`)).toHaveCount(0);
  await expect(page.getByTestId('appt')).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Staff' })).toHaveCount(0);
  expect((await bookingRow(mine)).status).toBe('confirmed');
});
