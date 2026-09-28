import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

// Admin sign-in: phone code → (not an admin) → granted → TOTP enrollment → admin home;
// then a second sign-in answers the TOTP challenge. Local stack only.
test.skip(!process.env.E2E_AUTH, 'needs the local Supabase stack (set E2E_AUTH=1)');

const PHONE = '+96170000006';
const dbUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(dbUrl).hostname)) {
  throw new Error('admin e2e refuses to run against a non-local database');
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
function totp(secretB32: string, atMs = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretB32.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, '0');
}

async function waitForNextTotpWindow() {
  const ms = 30_000 - (Date.now() % 30_000) + 500;
  await new Promise((r) => setTimeout(r, ms));
}

async function phoneSignIn(page: Page) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill('70 000 006');
  const send = flow.getByRole('button', { name: 'Send code' });
  await expect(send).toBeEnabled({ timeout: 20_000 });
  await send.click();
  await flow.getByLabel('6-digit code').fill('123456');
}

test('admin must enroll TOTP and reach aal2 before anything works', async ({ page }) => {
  test.setTimeout(180_000);
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  try {
    // clean slate for reruns: no admin role, no factors, no email
    await db.query(
      `delete from public.admin_users where user_id in (select id from auth.users where phone = $1)`,
      [PHONE.slice(1)],
    );
    await db.query(
      `delete from auth.mfa_factors where user_id in (select id from auth.users where phone = $1)`,
      [PHONE.slice(1)],
    );
    await db.query(
      `update auth.users set email = null, email_confirmed_at = null where phone = $1`,
      [PHONE.slice(1)],
    );

    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await phoneSignIn(page);
    await expect(page.getByTestId('not-admin')).toBeVisible();

    // Provisioning (superadmin runbook): the admin role plus an email on the account, which
    // Supabase Auth uses to label the TOTP factor
    await db.query(
      `insert into public.admin_users (user_id, role) select id, 'ops' from auth.users where phone = $1`,
      [PHONE.slice(1)],
    );
    await db.query(
      `update auth.users set email = 'ops-e2e@example.test', email_confirmed_at = now() where phone = $1`,
      [PHONE.slice(1)],
    );
    await page.reload();

    const secret = (await page.getByTestId('totp-secret').textContent())!.split('Key: ')[1]!.trim();
    await page.getByLabel('Authenticator code').fill(totp(secret));
    await expect(page.getByTestId('admin-home')).toHaveText('Signed in as ops (MFA verified).');

    // second login: challenge (no QR), with a code from the next time window
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await new Promise((r) => setTimeout(r, 31_000)); // Auth's 30 s resend interval for phone codes
    await waitForNextTotpWindow(); // and a TOTP code from a fresh window
    await phoneSignIn(page);
    await expect(page.getByText('Enter your authenticator code')).toBeVisible();
    await page.getByLabel('Authenticator code').fill('000000');
    await expect(page.getByText("That authenticator code isn't right.")).toBeVisible();
    await page.getByLabel('Authenticator code').fill(totp(secret));
    await expect(page.getByTestId('admin-home')).toBeVisible();
  } finally {
    await db.end();
  }
});
