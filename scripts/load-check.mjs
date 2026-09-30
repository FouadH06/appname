// M14 · load check on the critical customer paths, LOCAL stack only (never point this at a hosted
// project without the PO's go-ahead). Closed-loop virtual users against PostgREST:
//   reads  — search_businesses, search_suggest, get_home, get_business_page, get_available_slots
//   writes — anonymous sessions creating and releasing holds on real slots (the booking critical path);
//            the exclusion constraint makes double booking impossible, the check counts conflicts.
// Prerequisite: `supabase start` + a launch-scale dataset (steps in docs/milestones/M14-report.md).
//   node scripts/load-check.mjs [--seconds 60] [--readers 25] [--holders 10]
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error('load-check only runs against the local stack');
  process.exit(2);
}
const SECONDS = arg('seconds', 60);
const READERS = arg('readers', 25);
const HOLDERS = arg('holders', 10);

const stats = new Map();
function record(name, ms, ok, code) {
  const s = stats.get(name) ?? { ms: [], ok: 0, err: 0, codes: {} };
  s.ms.push(ms);
  if (ok) s.ok += 1;
  else {
    s.err += 1;
    s.codes[code] = (s.codes[code] ?? 0) + 1;
  }
  stats.set(name, s);
}

async function rpc(name, args, token, label = name) {
  const t = performance.now();
  let res;
  try {
    res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${token ?? KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
  } catch (e) {
    record(label, performance.now() - t, false, 'network');
    return { ok: false, code: 'network' };
  }
  const body = await res.json().catch(() => null);
  const ms = performance.now() - t;
  const code = res.ok ? null : (body?.message ?? String(res.status));
  // expected business outcomes are not errors (someone else took the slot)
  const expected = ['SLOT_TAKEN', 'STAFF_NOT_FREE', 'INVALID_SLOT', 'RATE_LIMITED'].includes(code);
  record(label, ms, res.ok || expected, code);
  return { ok: res.ok, code, body };
}

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date());
const plusDays = (n) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(
    new Date(Date.now() + n * 86400000),
  );

async function setup() {
  const slugs = (await rpc('get_public_business_slugs', {}, null, 'setup')).body ?? [];
  if (slugs.length < 20)
    throw new Error(`only ${slugs.length} public businesses — load the dataset first`);
  const pages = [];
  for (const s of slugs.slice(0, 60)) {
    const slug = typeof s === 'string' ? s : s.slug;
    const p = (await rpc('get_business_page', { p_slug: slug }, null, 'setup')).body;
    const svc = p?.services?.find((x) => x.online && x.staff_ids?.length);
    if (p?.state === 'ok' && svc) pages.push({ slug, location: p.location.id, service: svc.id });
  }
  return pages;
}

const QUERIES = [
  'haircut',
  'barber',
  'nails',
  'manicure',
  'balayage',
  'lash',
  'makeup',
  'massage',
  'حلاق',
  '7ala2',
  'facial',
  'waxing',
];

async function reader(pages, until) {
  while (Date.now() < until) {
    const r = Math.random();
    if (r < 0.4) await rpc('search_businesses', { p_q: pick(QUERIES), p_limit: 20 });
    else if (r < 0.55) await rpc('search_suggest', { p_q: pick(QUERIES).slice(0, 3) });
    else if (r < 0.65) await rpc('get_home', {});
    else if (r < 0.8) await rpc('get_business_page', { p_slug: pick(pages).slug });
    else {
      const p = pick(pages);
      await rpc('get_available_slots', {
        p_location_id: p.location,
        p_service_id: p.service,
        p_date_from: today,
        p_date_to: plusDays(1),
      });
    }
  }
}

async function anonSession() {
  const res = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    // Turnstile's official test secret (local config) accepts any token
    body: JSON.stringify({
      data: {},
      gotrue_meta_security: { captcha_token: 'XXXX.DUMMY.TOKEN.XXXX' },
    }),
  });
  const body = await res.json();
  if (!body.access_token)
    throw new Error(`anonymous sign-in failed: ${JSON.stringify(body).slice(0, 200)}`);
  return body.access_token;
}

async function holder(pages, until, token) {
  let holds = 0;
  while (Date.now() < until && holds < 18) {
    const p = pick(pages);
    const slots = (
      await rpc('get_available_slots', {
        p_location_id: p.location,
        p_service_id: p.service,
        p_date_from: plusDays(1),
        p_date_to: plusDays(1),
      })
    ).body;
    if (!slots?.length) continue;
    const s = pick(slots.slice(0, 5)); // crowd onto the earliest slots to force contention
    const h = await rpc(
      'create_hold',
      {
        p_location_id: p.location,
        p_service_id: p.service,
        p_start: s.slot_start,
        p_source: 'marketplace_other',
      },
      token,
    );
    holds += 1;
    const hold = h.ok ? h.body?.[0] : null;
    if (hold)
      await rpc(
        'release_hold',
        { p_booking_id: hold.booking_id, p_hold_token: hold.hold_token },
        token,
      );
  }
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

const pages = await setup();
console.log(
  `dataset: ${pages.length} bookable businesses · ${READERS} readers + ${HOLDERS} hold sessions · ${SECONDS}s`,
);
const tokens = [];
for (let i = 0; i < HOLDERS; i += 1) tokens.push(await anonSession());
const started = Date.now();
const until = started + SECONDS * 1000;
await Promise.all([
  ...Array.from({ length: READERS }, () => reader(pages, until)),
  ...tokens.map((t) => holder(pages, until, t)),
]);
const elapsed = (Date.now() - started) / 1000;
stats.delete('setup');

let total = 0;
let errors = 0;
const rows = [];
for (const [name, s] of stats) {
  total += s.ms.length;
  errors += s.err;
  rows.push({
    rpc: name,
    calls: s.ms.length,
    'p50 ms': Math.round(pct(s.ms, 50)),
    'p95 ms': Math.round(pct(s.ms, 95)),
    'p99 ms': Math.round(pct(s.ms, 99)),
    errors: s.err,
    codes: JSON.stringify(s.codes),
  });
}
console.table(rows);
console.log(
  `throughput: ${(total / elapsed).toFixed(1)} req/s · errors: ${errors} (${((errors / Math.max(total, 1)) * 100).toFixed(2)} %)`,
);
process.exit(errors / Math.max(total, 1) > 0.01 ? 1 : 0);
