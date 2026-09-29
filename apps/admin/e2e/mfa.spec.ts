import { execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

// Admin sign-in: phone code → (not an admin) → granted → TOTP enrollment → admin home;
// then a second sign-in answers the TOTP challenge; ops creates a business (M5); a moderator
// decides a moderation case (M9). Local stack only.
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

/** A published review whose comment waits for a human (pipeline case), on its own business. */
async function createPipelineCase(db: pg.Client, text: string): Promise<string> {
  const one = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
  const tag = Math.random().toString(36).slice(2, 10);
  const biz = await one(
    `insert into public.businesses (slug, name, primary_category_id, status)
     select $1, 'Moderation Salon', id, 'live' from public.categories where slug = 'barber' returning id`,
    [`e2e-mod-${tag}`],
  );
  const loc = await one(
    `insert into public.business_locations (business_id, area_id, address_line, geo, status)
     select $1, id, 'Main street', centroid, 'live' from public.areas where slug = 'hazmieh' returning id`,
    [biz],
  );
  const staff = await one(
    `insert into public.staff_members (business_id, display_name, slug) values ($1, 'Rami Case', 'rami') returning id`,
    [biz],
  );
  await db.query(
    `insert into public.staff_locations (staff_id, location_id, business_id) values ($1, $2, $3)`,
    [staff, loc, biz],
  );
  const svc = await one(
    `insert into public.services (business_id, canonical_service_id, name, price_type, price_min, duration_min)
     select $1, id, 'Haircut', 'fixed', 15, 30 from public.canonical_services where slug = 'mens-haircut' returning id`,
    [biz],
  );
  const author = await one(
    `insert into auth.users (id, aud, role, created_at, updated_at)
     values (gen_random_uuid(), 'authenticated', 'authenticated', now(), now()) returning id`,
  );
  const rec = await one(
    `insert into public.business_customers (business_id, user_id, display_name, acquired_via, claimed_at)
     values ($1, $2, 'Case Author', 'manual', now()) returning id`,
    [biz, author],
  );
  const booking = await one(
    `insert into public.bookings (business_id, location_id, business_customer_id, customer_user_id, status, source,
                                  starts_at, ends_at, created_by_kind, confirmed_at, completed_at)
     values ($1, $2, $3, $4, 'completed', 'manual', now() - interval '1 day', now() - interval '1 day' + interval '30 minutes',
             'business', now(), now() - interval '1 day' + interval '30 minutes') returning id`,
    [biz, loc, rec, author],
  );
  const item = await one(
    `insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id,
                                       selection_mode, starts_at, ends_at, occupied, duration_min, price_type, price_min)
     select b.id, b.business_id, b.location_id, s.id, s.canonical_service_id, $3, 'business', b.starts_at, b.ends_at,
            tstzrange(b.starts_at, b.ends_at, '[)'), 30, 'fixed', 15
     from public.bookings b, public.services s where b.id = $1 and s.id = $2 returning id`,
    [booking, svc, staff],
  );
  const review = await one(
    `insert into public.reviews (booking_id, booking_item_id, business_id, location_id, staff_id, service_id, canonical_service_id,
                                 author_user_id, trust_tier, visit_at, overall, text_original, text_state, rating_state, status,
                                 published_at, base_weight, editable_until)
     select b.id, $2, b.business_id, b.location_id, $3, s.id, s.canonical_service_id, $4, 'verified_visit', b.starts_at, 2, $5,
            'manual_review', 'active', 'published', now(), 0.5, now() + interval '7 days'
     from public.bookings b, public.services s where b.id = $1 and s.id = $6 returning id`,
    [booking, item, staff, author, text, svc],
  );
  await db.query(
    `insert into public.moderation_cases (subject_type, subject_id, business_id, author_user_id, source, reasons,
                                          auto_decision, auto_confidence, sla_due_at)
     values ('review_text', $1, $2, $3, 'pipeline', '{targeted_person}', 'escalate', 0.6, now() + interval '24 hours')`,
    [review, biz, author],
  );
  return review;
}

/** A customer photo on that review, held for a human (M10), with its card derivative in ugc-staging. */
async function createImageCase(db: pg.Client, reviewId: string): Promise<string> {
  const media = (
    await db.query<{ id: string; author: string }>(
      `insert into public.media_assets (uploader_user_id, business_id, purpose, private_bucket, private_path, mime,
                                        width, height, status, processor, derivatives)
       select r.author_user_id, r.business_id, 'review_media', 'ugc-private', r.author_user_id || '/' || gen_random_uuid() || '.jpg',
              'image/jpeg', 8, 8, 'processing', 'external',
              jsonb_build_array(jsonb_build_object('name', 'card', 'path', gen_random_uuid() || '/card.webp', 'width', 8, 'height', 8))
       from public.reviews r where r.id = $1 returning id, uploader_user_id as author`,
      [reviewId],
    )
  ).rows[0]!;
  await db.query(
    `insert into public.review_media (review_id, media_asset_id, booking_item_id, consent_version, consented_at, business_id,
                                      location_id, area_id, staff_id, service_id, canonical_service_id, price_type, price_min,
                                      visit_at, trust_tier)
     select r.id, $2, r.booking_item_id, 'c16-v1', now(), r.business_id, r.location_id, l.area_id, r.staff_id, r.service_id,
            r.canonical_service_id, 'fixed', 15, r.visit_at, r.trust_tier
     from public.reviews r join public.business_locations l on l.id = r.location_id where r.id = $1`,
    [reviewId, media.id],
  );
  await db.query(`select private.media_to_human($1, 'review_media', '{relevance_unsure}')`, [
    media.id,
  ]);
  // the moderator sees the processed card derivative through a short-lived signed URL
  const path = (
    await db.query<{ path: string }>(
      `select derivatives -> 0 ->> 'path' as path from public.media_assets where id = $1`,
      [media.id],
    )
  ).rows[0]!.path;
  const webp = Buffer.from(
    'UklGRjgAAABXRUJQVlA4ICwAAACwAQCdASoIAAgAAUAmJaACdLoABDAAAP7bUf/Ys5bAvH/8zR+k30m7mAAAAA==',
    'base64',
  );
  const res = await fetch(`${API}/storage/v1/object/ugc-staging/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localServiceKey()}`, 'Content-Type': 'image/webp' },
    body: webp,
  });
  if (!res.ok) throw new Error(`staging upload failed: ${res.status} ${await res.text()}`);
  return (
    await db.query<{ id: string }>(
      `select id from public.moderation_cases where subject_type = 'review_media' and subject_id = $1`,
      [media.id],
    )
  ).rows[0]!.id;
}

const API = 'http://127.0.0.1:54321';
/** The LOCAL stack's service key (CI exports it; locally read from the CLI). Never a hosted key. */
function localServiceKey(): string {
  const out = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? `SERVICE_ROLE_KEY=${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    : execSync('npx supabase status -o env', {
        cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
        encoding: 'utf8',
      });
  const m = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(out);
  if (!m) throw new Error('local service key not found');
  return m[1]!;
}

async function waitForNextTotpWindow() {
  const ms = 30_000 - (Date.now() % 30_000) + 500;
  await new Promise((r) => setTimeout(r, ms));
}

async function phoneSignIn(page: Page) {
  const flow = page.getByTestId('phone-otp-flow');
  await flow.getByLabel('Phone number').fill('70 000 006');
  const send = flow.getByRole('button', { name: 'Send code' });
  await expect(flow).toHaveAttribute('data-captcha', 'ready', { timeout: 45_000 }); // Turnstile token
  await send.click();
  await flow.getByLabel('6-digit code').fill('123456');
}

test('admin must enroll TOTP and reach aal2 before anything works', async ({ page }) => {
  test.setTimeout(240_000);
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

    // ── M5 assisted onboarding (A4): ops creates a draft business and gets the owner invite ──
    const slug = `e2e-ops-${Date.now().toString(36)}`;
    await page.getByTestId('create-business-link').click();
    await page.getByLabel('Business name').fill('Ops Assisted Salon');
    await page.getByLabel('Booking link (platform.com/…)').fill(slug);
    await page.getByLabel('Category').selectOption('barber');
    await page.getByLabel('Area').selectOption({ label: 'Hazmieh' });
    await page.getByLabel('Street / building').fill('Main street');
    await page
      .getByLabel('Map pin (coordinates or Google Maps link)')
      .fill('https://www.google.com/maps/place/x/@33.8547,35.5323,17z');
    await page.getByLabel('Owner phone (sends the owner invite)').fill('71 234 567');
    await page.getByRole('button', { name: 'Create business' }).click();
    await expect(page.getByTestId('business-created')).toBeVisible();
    await expect(page.getByTestId('owner-invite')).toContainText('/invite/');
    const row = await db.query<{ status: string; role: string; invites: number }>(
      `select b.status::text as status, m.role::text as role,
              (select count(*)::int from private.business_invitations i where i.business_id = b.id and i.role = 'owner') as invites
       from public.businesses b
       join public.business_members m on m.business_id = b.id and m.user_id = (select id from auth.users where phone = $2)
       where b.slug = $1`,
      [slug, PHONE.slice(1)],
    );
    expect(row.rows[0]).toEqual({ status: 'draft', role: 'manager', invites: 1 });

    // ── M9 moderation (A2/A3): a moderator decides a comment the automatic check was unsure about ──
    await db.query(
      `update public.admin_users set role = 'moderator' where user_id = (select id from auth.users where phone = $1)`,
      [PHONE.slice(1)],
    );
    const tag = Date.now().toString(36);
    const reviewId = await createPipelineCase(db, `Rami was rude to me at the desk, case ${tag}`);
    await page.goto('/moderation');
    await page
      .getByTestId('case-row')
      .filter({ hasText: `case ${tag}` })
      .click();
    await expect(page.getByTestId('case-content')).toContainText(`case ${tag}`);
    await page.getByTestId('claim-case').click();
    const decide = page.getByTestId('decide');
    await decide.getByLabel('Approve text').check();
    await decide.getByLabel('Reason code').selectOption('follows_policy');
    await decide.getByTestId('submit-decision').click();
    await expect(page.getByTestId('case-decided')).toBeVisible();
    const decided = await db.query<{ text_state: string; audited: number }>(
      `select r.text_state::text,
              (select count(*)::int from audit.admin_actions a where a.subject_id = r.id and a.action = 'moderation.decide') as audited
       from public.reviews r where r.id = $1`,
      [reviewId],
    );
    expect(decided.rows[0]).toEqual({ text_state: 'approved', audited: 1 });

    // ── M10 image case: blurred until revealed; the moderator rejects an irrelevant photo ──
    const caseId = await createImageCase(db, reviewId);
    await page.goto('/moderation');
    await page.locator(`a[href="/moderation/media/${caseId}"]`).click();
    const img = page
      .getByTestId('media-case-image')
      .getByRole('img', { name: 'Photo under review' });
    await expect(img).toHaveAttribute('data-revealed', 'false');
    await expect(img).toHaveClass(/blur-2xl/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(8); // signed URL loads
    await page.getByTestId('reveal').click();
    await expect(img).toHaveAttribute('data-revealed', 'true');
    await page.getByTestId('claim-case').click();
    const decideImage = page.getByTestId('decide');
    await decideImage.getByLabel('Reject (author told the reason)').check();
    await decideImage.getByLabel('Reason code').selectOption('not_relevant');
    await decideImage.getByTestId('submit-decision').click();
    await expect(page.getByTestId('case-decided')).toBeVisible();
    const imageDecided = await db.query<{ state: string; audited: number; told: number }>(
      `select rm.state::text,
              (select count(*)::int from audit.admin_actions a where a.subject_id = rm.media_asset_id and a.action = 'moderation.decide_media') as audited,
              (select count(*)::int from public.notifications n where n.type = 'result_rejected' and n.payload ->> 'result_id' = rm.id::text) as told
       from public.review_media rm join public.moderation_cases c on c.subject_id = rm.media_asset_id where c.id = $1`,
      [caseId],
    );
    expect(imageDecided.rows[0]).toEqual({ state: 'rejected', audited: 1, told: 1 });
  } finally {
    await db.end();
  }
});
