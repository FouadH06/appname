// Demo seeder (UX level). DEMO-ONLY data: fake businesses, staff, bookings, reviews and the demo-media library.
// Refuses anything but the local stack unless DEMO_ALLOW_REMOTE=1 is set for a dedicated demo environment —
// demo content must never reach the pilot. Re-running is a no-op for businesses that already exist
// (`npx supabase db reset` starts over).
//
//   pnpm seed:demo              (= node demo/src/seed.mjs --level ux)
//
// Media: each chosen asset is loaded once (generated files from the package; stock previews fetched once into
// demo/.cache), processed with sharp into the same derivative layout M10 produces (business photo ≤ 1600 px WebP;
// results thumb 320 / card 800 / full ≤ 2048), uploaded to the existing buckets, and recorded as approved
// media_assets. The durable demo marker is the storage path `…/demo/<library asset id>…` (plus the `demo-` slug):
// it links back to the manifest, which keeps provider, source page, photographer, original URL and category.
// processor_version starts as 'demo-import:<library version>:<asset id>'; business photos then go through the
// normal M10 safety check (it is not bypassed), which records its own processor version. The seeder runs that
// pipeline to completion so no demo backlog is left in the media queues.
import { execFileSync, execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import { bytesOf, library, pickUsable, unavailable } from './adapter.mjs';
import { BUSINESSES, FIRST_NAMES, LAST_NAMES, MEDIA, REVIEW_TEXTS } from './fixtures-ux.mjs';

const level = process.argv.includes('--level')
  ? process.argv[process.argv.indexOf('--level') + 1]
  : 'ux';
if (level !== 'ux') {
  console.error(
    `seed level "${level}" is not implemented yet (small UX level only; medium/packed come later)`,
  );
  process.exit(2);
}

function localEnv() {
  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.DATABASE_URL
  ) {
    return {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
      db: process.env.DATABASE_URL,
    };
  }
  const out = execSync('npx supabase status -o env', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const get = (k) => out.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1];
  return { url: get('API_URL'), key: get('SERVICE_ROLE_KEY'), db: get('DB_URL') };
}
const env = localEnv();
const isLocal = (u) =>
  /^(postgres(ql)?|https?):\/\/([^@]+@)?(127\.0\.0\.1|localhost)[:/]/.test(u ?? '');
if (!(isLocal(env.url) && isLocal(env.db)) && process.env.DEMO_ALLOW_REMOTE !== '1') {
  console.error(
    'demo seeding only runs against the local stack (set DEMO_ALLOW_REMOTE=1 for a dedicated demo environment)',
  );
  process.exit(2);
}

const db = new pg.Client({ connectionString: env.db });
await db.connect();
const q = (text, params = []) => db.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0];

async function upload(bucket, path, buf) {
  const res = await fetch(`${env.url}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.key}`,
      apikey: env.key,
      'Content-Type': 'image/webp',
      'x-upsert': 'true',
    },
    body: buf,
  });
  if (!res.ok) throw new Error(`upload ${bucket}/${path}: ${res.status} ${await res.text()}`);
}

/** demo marker + link to the manifest record (provider, source page, photographer, original URL, category) */
const version = (a) => `demo-import:${library.version}:${a.id}`;

/** Business photo / staff portrait → one WebP in business-media + an approved media_assets row. */
async function businessAsset(bizId, a, { square = false } = {}) {
  let img = sharp(await bytesOf(a)).rotate();
  img = square
    ? img.resize(480, 480, { fit: 'cover', position: 'attention' })
    : img.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });
  const { data, info } = await img.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  const path = `${bizId}/demo/${a.id}.webp`;
  await upload('business-media', path, data);
  return (
    await one(
      `insert into public.media_assets (business_id, purpose, private_bucket, private_path, public_path, mime, bytes, width, height,
                                        status, processed_at, processor, processor_version)
       values ($1, 'business_media', 'business-media', $2, $2, 'image/webp', $3, $4, $5, 'approved', now(), 'external', $6)
       returning id`,
      [bizId, path, data.length, info.width, info.height, version(a)],
    )
  ).id;
}

/** Customer result → thumb / card / full derivatives in ugc-public (the M10 layout) + an approved media_assets row. */
async function resultAsset(bizId, a) {
  const src = await bytesOf(a);
  const derivatives = [];
  for (const [name, max] of [
    ['thumb', 320],
    ['card', 800],
    ['full', 2048],
  ]) {
    const { data, info } = await sharp(src)
      .rotate()
      .resize(max, max, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const path = `demo/${a.id}/${name}.webp`;
    await upload('ugc-public', path, data);
    derivatives.push({ name, path, width: info.width, height: info.height });
  }
  const full = derivatives[2];
  return (
    await one(
      `insert into public.media_assets (business_id, purpose, private_bucket, private_path, public_path, mime, width, height, derivatives,
                                        status, processed_at, processor, processor_version)
       values ($1, 'review_media', 'ugc-private', $2, $3, 'image/webp', $4, $5, $6, 'approved', now(), 'external', $7)
       returning id`,
      [
        bizId,
        `demo/${a.id}/source`,
        full.path,
        full.width,
        full.height,
        JSON.stringify(derivatives),
        version(a),
      ],
    )
  ).id;
}

const used = new Set();
let seeded = 0;
const reviewers = [];
async function reviewer(i) {
  if (reviewers[i]) return reviewers[i];
  const phone = `96171800${String(i).padStart(3, '0')}`;
  const u =
    (await one(`select id from auth.users where phone = $1`, [phone])) ??
    (await one(
      `insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
       values (gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now() - interval '300 days', now()) returning id`,
      [phone],
    ));
  await q(`update public.profiles set first_name = $2, last_name = $3 where id = $1`, [
    u.id,
    FIRST_NAMES[i % FIRST_NAMES.length],
    LAST_NAMES[(i * 3) % LAST_NAMES.length],
  ]);
  reviewers[i] = u.id;
  return u.id;
}

for (const [bi, f] of BUSINESSES.entries()) {
  const slug = `demo-${f.key}`;
  if (await one(`select 1 from public.businesses where slug = $1`, [slug])) {
    console.log(`= ${f.name} (exists)`);
    continue;
  }
  const m = MEDIA[f.category];
  const interiors = await pickUsable({
    category: 'businesses',
    subcategories: m.interior,
    flag: 'stock',
    orientation: ['landscape'],
    seed: f.key,
    n: f.gallery,
    used,
  });
  const extra =
    interiors.length < f.gallery
      ? await pickUsable({
          category: 'businesses',
          subcategories: m.interior,
          flag: 'stock',
          seed: `${f.key}+`,
          n: f.gallery - interiors.length,
          used,
        })
      : [];
  const photos = [...interiors, ...extra];
  // named fictional staff get generated (non-identifiable) portraits; when those run out: initials, never a stock face
  const portraits = await pickUsable({
    category: 'staff',
    subcategories: m.staff,
    flag: 'generated',
    seed: f.key,
    n: f.staff.length,
    used,
  });
  const results =
    m.results.length && f.reviews.results
      ? await pickUsable({
          category: 'results',
          subcategories: m.results,
          flag: 'stock',
          seed: f.key,
          n: f.reviews.results,
          used,
        })
      : [];

  await q('begin');
  try {
    const biz = await one(
      `insert into public.businesses (slug, name, primary_category_id, status, published_at, audience, description)
       select $1, $2, c.id, 'live', now() - make_interval(days => $3), $4::public.audience, $5 from public.categories c where c.slug = $6
       returning id`,
      [slug, f.name, 30 + bi * 23, f.audience, f.description, f.category],
    );
    await q(
      `update public.business_settings set booking_mode = $2, min_notice_minutes = 30, cancellation_window_minutes = $3 where business_id = $1`,
      [biz.id, f.mode, f.cancelMinutes],
    );
    const loc = await one(
      `insert into public.business_locations (business_id, area_id, address_line, geo, status, phone_e164, whatsapp_e164)
       select $1, a.id, $2, extensions.st_setsrid(extensions.st_makepoint(extensions.st_x(a.centroid::extensions.geometry) + $4,
                                                                          extensions.st_y(a.centroid::extensions.geometry) + $5), 4326)::extensions.geography,
              'live', $6, $6
       from public.areas a where a.slug = $3 returning id, area_id`,
      [
        biz.id,
        `${10 + bi} Main Street`,
        f.area,
        ((bi % 5) - 2) * 0.002,
        ((bi % 3) - 1) * 0.002,
        `+9617090${String(bi).padStart(4, '0')}`,
      ],
    );
    await q(
      `insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
       select $1, $2, d, 540, 1200 from generate_series(1, 7) d where d <> 7 or $3`,
      [loc.id, biz.id, bi % 2 === 0],
    );

    // photos: first = cover, rest = portfolio
    for (const [i, a] of photos.entries()) {
      const asset = await businessAsset(biz.id, a);
      await q(
        `insert into public.business_media (business_id, location_id, media_asset_id, kind, sort, state)
         values ($1, $2, $3, $4, $5, 'approved')`,
        [biz.id, loc.id, asset, i === 0 ? 'cover' : 'portfolio', i],
      );
    }

    // staff (+ generated portrait when available), hours, services
    const staffIds = [];
    for (const [i, [name, role, specialties]] of f.staff.entries()) {
      const st = await one(
        `insert into public.staff_members (business_id, display_name, slug, role_title, publicly_bookable, display_order)
         values ($1, $2, $3, $4, true, $5) returning id`,
        [biz.id, name, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), role, i],
      );
      staffIds.push(st.id);
      await q(
        `insert into public.staff_locations (staff_id, location_id, business_id) values ($1, $2, $3)`,
        [st.id, loc.id, biz.id],
      );
      await q(
        `insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
         select $1, $2, $3, d, $4, $5, current_date - 60 from generate_series(1, 7) d`,
        [st.id, loc.id, biz.id, 540 + (i % 2) * 60, 1140 + (i % 2) * 60],
      );
      if (specialties?.length) {
        await q(`update public.staff_members set bio = $2 where id = $1`, [
          st.id,
          `Specialties: ${specialties.join(', ')}.`,
        ]);
      }
      if (portraits[i]) {
        const asset = await businessAsset(biz.id, portraits[i], { square: true });
        const bm = await one(
          `insert into public.business_media (business_id, location_id, media_asset_id, kind, staff_id, sort, state)
           values ($1, $2, $3, 'staff_photo', $4, 0, 'approved') returning id`,
          [biz.id, loc.id, asset, st.id],
        );
        await q(`update public.staff_members set photo_media_id = $2 where id = $1`, [
          st.id,
          bm.id,
        ]);
      }
    }
    const services = [];
    for (const [i, s] of f.services.entries()) {
      const sv = await one(
        `insert into public.services (business_id, canonical_service_id, name, price_type, price_min, price_max, duration_min, is_online_bookable, sort)
         select $1, c.id, $2, $3::public.price_type, $4, $5, $6, $7, $8 from public.canonical_services c where c.slug = $9
         returning id, canonical_service_id, price_type, price_min, price_max`,
        [
          biz.id,
          s.name,
          s.type ?? 'fixed',
          s.price,
          s.max ?? null,
          s.minutes,
          s.online !== false,
          i,
          s.canonical,
        ],
      );
      services.push({ ...sv, minutes: s.minutes });
      for (const st of staffIds) {
        await q(
          `insert into public.staff_services (staff_id, service_id, business_id) values ($1, $2, $3)`,
          [st, sv.id, biz.id],
        );
      }
    }

    // verified history: completed visits, reviews (counted), a few photo results on them
    const bookable = services.filter((s) => s.price_type !== 'on_consultation');
    for (let j = 0; j < f.reviews.count; j += 1) {
      const svc = (bookable.length ? bookable : services)[j % (bookable.length || services.length)];
      const staffId = staffIds[j % staffIds.length];
      const userId = await reviewer((bi * 7 + j) % 60);
      const start = await one(
        `select date_trunc('hour', now()) - make_interval(days => $1, hours => $2) as t`,
        [4 + j * 3, j % 6],
      );
      const rec =
        (await one(
          `insert into public.business_customers (business_id, user_id, display_name, acquired_via, claimed_at)
         values ($1, $2, 'Demo customer', 'marketplace', now())
         on conflict do nothing returning id`,
          [biz.id, userId],
        )) ??
        (await one(
          `select id from public.business_customers where business_id = $1 and user_id = $2`,
          [biz.id, userId],
        ));
      const bk = await one(
        `insert into public.bookings (business_id, location_id, business_customer_id, customer_user_id, status, source, starts_at, ends_at,
                                      created_by_kind, confirmed_at, completed_at, total_price_min, total_price_max)
         values ($1, $2, $3, $4, 'completed', $5::public.booking_source, $6::timestamptz, $6::timestamptz + make_interval(mins => $7), 'customer', $6::timestamptz - interval '1 day',
                 $6::timestamptz + make_interval(mins => $7), $8, $9) returning id`,
        [
          biz.id,
          loc.id,
          rec.id,
          userId,
          j % 3 === 0 ? 'marketplace_search' : 'business_link',
          start.t,
          svc.minutes,
          svc.price_min,
          svc.price_max ?? svc.price_min,
        ],
      );
      const item = await one(
        `insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id, selection_mode,
                                           starts_at, ends_at, occupied, duration_min, price_type, price_min, price_max)
         values ($1, $2, $3, $4, $5, $6, 'business', $7::timestamptz, $7::timestamptz + make_interval(mins => $8), tstzrange($7::timestamptz, $7::timestamptz + make_interval(mins => $8), '[)'),
                 $8, $9, $10, $11) returning id`,
        [
          bk.id,
          biz.id,
          loc.id,
          svc.id,
          svc.canonical_service_id,
          staffId,
          start.t,
          svc.minutes,
          svc.price_type,
          svc.price_min,
          svc.price_max,
        ],
      );
      const stars = Math.max(
        1,
        Math.min(5, Math.round(2.6 + f.reviews.quality * 2.6 + (((j * 37) % 10) / 10 - 0.5) * 1.4)),
      );
      const text =
        f.reviews.texts && j % 2 === 0 ? REVIEW_TEXTS[(bi + j) % REVIEW_TEXTS.length] : null;
      const rv = await one(
        `insert into public.reviews (booking_id, booking_item_id, business_id, location_id, staff_id, service_id, canonical_service_id,
                                     author_user_id, trust_tier, visit_at, overall, rating_state, status, published_at, base_weight, editable_until,
                                     text_original, text_display, text_state)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'verified_booking', $9::timestamptz, $10, 'active', 'published', $9::timestamptz + interval '1 day', 1.0,
                 $9::timestamptz + interval '7 days', $11, $11, case when $11::text is null then null else 'approved' end::public.content_state)
         returning id`,
        [
          bk.id,
          item.id,
          biz.id,
          loc.id,
          staffId,
          svc.id,
          svc.canonical_service_id,
          userId,
          start.t,
          stars,
          text,
        ],
      );
      if (j < results.length) {
        const asset = await resultAsset(biz.id, results[j]);
        await q(
          `insert into public.review_media (review_id, media_asset_id, booking_item_id, kind, consent_version, consented_at, business_id, location_id,
                                            area_id, staff_id, service_id, canonical_service_id, price_type, price_min, price_max, visit_at, trust_tier,
                                            state, published_at, is_featured, featured_rank, featured_at)
           values ($1, $2, $3, 'result', 'c16-v1', $4::timestamptz, $5, $6, $7, $8, $9, $10, $11, $12, $13, $4::timestamptz, 'verified_booking', 'approved',
                   $4::timestamptz + interval '1 day', $14, $15, case when $14 then now() end)`,
          [
            rv.id,
            asset,
            item.id,
            start.t,
            biz.id,
            loc.id,
            loc.area_id,
            staffId,
            svc.id,
            svc.canonical_service_id,
            svc.price_type,
            svc.price_min,
            svc.price_max,
            j < 2,
            j < 2 ? j + 1 : null,
          ],
        );
      }
    }
    await q(`select private.recompute_rating_summary($1)`, [biz.id]);
    await q('commit');
    seeded += 1;
    console.log(
      `+ ${f.name}: ${photos.length} photos, ${portraits.length}/${f.staff.length} portraits, ${f.reviews.count} reviews, ${results.length} results`,
    );
  } catch (e) {
    await q('rollback');
    throw e;
  }
}

/**
 * Business photos are registered like any upload, so M10 queues a transform + safety check for each. Run the
 * local media worker and orchestrator until the queues are empty (deterministic, nothing left behind).
 */
async function drainMediaPipeline() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const secret = process.env.DEMO_MEDIA_SECRET ?? (isLocal(env.url) ? 'local-media-secret' : null);
  if (!secret) {
    console.log('media pipeline not drained (set DEMO_MEDIA_SECRET for a remote demo environment)');
    return;
  }
  const pending = async () =>
    Number(
      (
        await one(`select (select count(*) from pgmq.q_media_transform) + (select count(*) from pgmq.q_media_classify)
                        + (select count(*) from pgmq.q_media_publish) as n`)
      ).n,
    );
  for (let round = 0; round < 50 && (await pending()) > 0; round += 1) {
    execFileSync(process.execPath, ['--experimental-strip-types', 'src/once.ts'], {
      cwd: resolve(repo, 'apps/media-worker'),
      env: { ...process.env, SUPABASE_URL: env.url, SUPABASE_SERVICE_ROLE_KEY: env.key },
      stdio: 'ignore',
    });
    const res = await fetch(`${env.url}/functions/v1/media-orchestrator`, {
      method: 'POST',
      headers: { 'x-media-secret': secret },
    });
    if (!res.ok) throw new Error(`media orchestrator: ${res.status} ${await res.text()}`);
  }
  const left = await pending();
  const removed = await one(
    `select count(*) as n from public.business_media bm join public.media_assets m on m.id = bm.media_asset_id
      where m.private_path like '%/demo/%' and bm.state <> 'approved'`,
  );
  console.log(`M10 safety check: ${left} jobs left, ${removed.n} demo photos not approved`);
}

if (seeded) {
  await drainMediaPipeline();
  await q(`select private.compute_quality_scores()`);
  await q(`select private.job_search_refresh(100000)`);
}
await db.end();
console.log(`done: ${seeded} demo businesses seeded (library ${library.name} ${library.version})`);
if (unavailable.size)
  console.log(`skipped unreachable stock sources: ${[...unavailable].join(', ')}`);
