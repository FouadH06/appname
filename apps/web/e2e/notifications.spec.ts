import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  addMemberByPhone,
  beirutDate,
  closePool,
  confirmedAt,
  createCalendarBusiness,
  failCustomerMessages,
  latestBooking,
  notificationsFor,
} from './support/db';

// M7 · notifications on the local stack (log mode): a phone booking queues the confirmation and
// reminders, the dispatcher sends them, the WhatsApp Confirm button (signed webhook) confirms
// attendance, team alert settings, and the overview's delivery-failure alert.
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');
test.beforeEach(({ page: _page }, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once (desktop project)');
});
test.afterAll(closePool);
test.use({ viewport: { width: 1440, height: 1500 } });

const FUNCTIONS = 'http://127.0.0.1:54321/functions/v1';
// local-only values from supabase/config.toml [edge_runtime.secrets]
const DISPATCH_SECRET = 'local-notify-dispatch-secret';
const META_APP_SECRET = 'local-meta-app-secret';

async function signIn(page: Page, local: string) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill(local);
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 });
  await flow.getByRole('button', { name: 'Send code' }).click();
  await flow.getByLabel('6-digit code').fill('123456');
}

test('booking messages: queue → dispatch → WhatsApp Confirm; alert settings; failure alert', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const b = await createCalendarBusiness('Notify Salon');
  const day = await beirutDate(2);

  await page.goto('/biz/login');
  await signIn(page, '70 000 011');
  await expect(page).toHaveURL(/\/biz$/);
  await addMemberByPhone(b.businessId, '96170000011', 'reception');
  await page.goto(`/biz/${b.businessId}/calendar?date=${day}`);
  await page.getByRole('tab', { name: 'Day · Columns' }).click();

  await test.step('phone booking with "Send confirmation" queues confirmation + reminders', async () => {
    const karim = page.getByTestId(`col-${b.staffId}`);
    const from = Number(await karim.getAttribute('data-from'));
    const ppm = Number(await karim.getAttribute('data-ppm'));
    await karim.click({ position: { x: 30, y: (660 - from) * ppm + 3 } });
    const drawer = page.getByTestId('new-appointment');
    await drawer.getByLabel('Phone or name').fill('71 555 111');
    await expect(drawer.getByTestId('customer-options')).toContainText('Lina Khoury');
    await drawer.getByLabel('Phone or name').press('Enter');
    await expect(
      drawer.getByRole('switch', { name: 'Send confirmation on WhatsApp' }),
    ).toBeChecked();
    await drawer.getByTestId('save-appointment').click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Saved · Lina' })).toBeVisible();
  });

  const booking = await latestBooking(b.businessId);
  expect((await notificationsFor(booking)).map((n) => n.type).sort()).toEqual([
    'booking_confirmed',
    'booking_reminder_24h',
    'booking_reminder_2h',
  ]);

  await test.step('the dispatcher sends the due confirmation (reminders wait for their time)', async () => {
    const res = await fetch(`${FUNCTIONS}/notify-dispatch`, {
      method: 'POST',
      headers: { 'x-dispatch-secret': DISPATCH_SECRET },
    });
    expect(res.status).toBe(200);
    const unauthorized = await fetch(`${FUNCTIONS}/notify-dispatch`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);
    // each run claims the oldest due messages first, so keep dispatching until ours is out
    await expect
      .poll(
        async () => {
          await fetch(`${FUNCTIONS}/notify-dispatch`, {
            method: 'POST',
            headers: { 'x-dispatch-secret': DISPATCH_SECRET },
          });
          return (await notificationsFor(booking)).find((n) => n.type === 'booking_confirmed');
        },
        { timeout: 60_000 },
      )
      .toMatchObject({ status: 'sent', phone: '+96171555111', provider: 'log' });
    const reminders = (await notificationsFor(booking)).filter((n) =>
      n.type.startsWith('booking_reminder'),
    );
    expect(reminders.every((n) => n.status === 'queued')).toBe(true);
  });

  await test.step('WhatsApp Confirm button (signed webhook from the customer’s number)', async () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: `wamid.e2e.${Date.now()}`,
                    from: '96171555111',
                    type: 'button',
                    button: { payload: `confirm:${booking}`, text: 'Confirm' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const sig = 'sha256=' + createHmac('sha256', META_APP_SECRET).update(body).digest('hex');
    const res = await fetch(`${FUNCTIONS}/whatsapp-webhook`, {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': sig },
    });
    expect(res.status).toBe(200);
    expect(await confirmedAt(booking)).not.toBeNull();
    await page.reload();
    await page.getByTestId(`col-${b.staffId}`).getByTestId('appt').first().click();
    await expect(page.getByTestId('drawer-timeline')).toContainText('Customer confirmed');
    await page.keyboard.press('Escape');
  });

  await test.step('owner sets team alerts; overview flags failing customer messages', async () => {
    await addMemberByPhone(b.businessId, '96170000011', 'manager');
    await page.goto(`/biz/${b.businessId}/settings?section=notifications`);
    const table = page.getByTestId('alert-settings');
    await expect(table).toBeVisible();
    const mine = table.getByRole('switch', { name: /New online booking for .*/ }).first();
    await expect(mine).toBeChecked(); // managers get alerts by default
    // wait for the save before reloading (a reload would abort a slow request)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rpc/biz_set_notification_setting') && r.ok()),
      mine.uncheck(),
    ]);
    await expect(mine).not.toBeChecked();
    await page.reload();
    await expect(
      table.getByRole('switch', { name: /New online booking for .*/ }).first(),
    ).not.toBeChecked();
    await failCustomerMessages(booking);
    await page.goto(`/biz/${b.businessId}`);
    await expect(page.getByTestId('messages-failing')).toContainText('couldn’t be delivered');
  });
});
