// Demo-media adapter: reads the canonical manifest (demo/media-library/manifest.json) and selects assets
// deterministically by category / subcategory / usage. Fixtures ask for "a barber interior" or "men's hair
// results"; components never see Pexels URLs — only the stored, processed media the seeder creates.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const LIBRARY_DIR = join(here, '..', 'media-library');
const CACHE_DIR = join(here, '..', '.cache');

const manifest = JSON.parse(readFileSync(join(LIBRARY_DIR, 'manifest.json'), 'utf8'));
export const library = {
  name: manifest.library,
  version: manifest.version,
  assets: manifest.assets,
};

const rank = (seed, id) => createHash('sha1').update(`${seed}|${id}`).digest().readUInt32BE(0);

/**
 * Deterministic selection: the same seed always yields the same assets (stable screenshots). A shared
 * `used` set keeps one image from appearing at two businesses.
 */
export function pick({ category, subcategories, flag, orientation, seed, n = 1, used }) {
  const pool = library.assets.filter(
    (a) =>
      a.category === category &&
      subcategories.includes(a.subcategory) &&
      (!flag || a.stock_generated_flag === flag) &&
      (!orientation || orientation.includes(a.orientation)) &&
      !used?.has(a.id),
  );
  const chosen = pool.sort((a, b) => rank(seed, a.id) - rank(seed, b.id)).slice(0, n);
  for (const a of chosen) used?.add(a.id);
  return chosen;
}

export const unavailable = new Set();

/**
 * Like pick(), but only returns assets whose bytes can actually be loaded (stock sources can disappear);
 * unreachable ones are skipped deterministically and reported.
 */
export async function pickUsable(opts) {
  const pool = pick({ ...opts, n: 10_000, used: new Set(opts.used) });
  const out = [];
  for (const a of pool) {
    if (out.length >= (opts.n ?? 1)) break;
    try {
      await bytesOf(a);
      out.push(a);
      opts.used?.add(a.id);
    } catch {
      unavailable.add(a.id);
    }
  }
  return out;
}

/** Source metadata kept with every imported asset (licensing / traceability). */
export const provenance = (a) => ({
  library_asset_id: a.id,
  provider: a.provider,
  source_page: a.source_page,
  photographer: a.photographer,
  original_source_url: a.original_source_url,
  category: a.category,
  subcategory: a.subcategory,
  intended_usage: a.intended_usage,
  stock_generated_flag: a.stock_generated_flag,
  demo_only: true,
});

/**
 * The asset's bytes: generated assets come from the package; stock assets are fetched ONCE from their
 * optimized preview URL into an ignored local cache (never hotlinked by the product).
 */
export async function bytesOf(a) {
  if (a.filename) return readFileSync(join(LIBRARY_DIR, a.filename));
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${a.id}.jpg`);
  if (existsSync(file)) return readFileSync(file);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(a.optimized_preview_url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      if (attempt === 3) throw new Error(`could not fetch ${a.id}: ${e.message}`);
    }
  }
}
