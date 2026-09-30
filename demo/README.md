# Demo data (demo-only — never pilot data)

Fake businesses, staff, bookings, reviews and the beauty/grooming demo-media library, for UI density,
responsive testing, internal testing and demonstrations. The seeder refuses anything but the local stack unless
`DEMO_ALLOW_REMOTE=1` is set for a dedicated demo environment. Demo content must never be seeded into the
pilot/production project.

```
pnpm seed:demo          # UX level: 11 businesses (local stack; `npx supabase db reset` to start over)
```

## Layout

- `media-library/` — the delivered source library as-is. `manifest.json` is canonical (category, subcategory,
  intended usage, provider, source page, photographer, original URL, stock/generated flag). Stock records have
  `filename: null` by design (source descriptors, not redistributed binaries); generated SVGs are local.
- `src/adapter.mjs` — deterministic selection from the manifest by category/subcategory/usage (`pick`,
  `pickUsable`), one-time fetch of stock previews into `demo/.cache/` (git-ignored), provenance helper.
- `src/fixtures-ux.mjs` — the UX-level businesses (coherent per business type: interiors, staff, results).
- `src/seed.mjs` — creates the data through ordinary tables and uploads processed media to the existing buckets.

## How media is handled

1. Selection is deterministic (seeded hash per business; one image is never used by two businesses).
2. Stock: the optimized preview is fetched **once** by the seeder and cached locally; the product never
   hotlinks Pexels. Generated SVGs are rasterised.
3. Processing uses sharp into the same layout M10 produces: business photos ≤ 1600 px WebP in `business-media`;
   customer results as `thumb` 320 / `card` 800 / `full` ≤ 2048 WebP in `ugc-public` (paths `demo/<asset id>/…`).
4. Rows: approved `media_assets` with `processor = 'external'` and
   `processor_version = 'demo-import:<library version>:<asset id>'` — the demo marker and the link back to the
   manifest record that holds the licence/source metadata. Business slugs start with `demo-`.
5. Named fictional staff get generated (non-identifiable) portraits; when those run out they show initials —
   no stock person is presented as a fictional employee.

## Levels

`ux` (small) is implemented. `medium` / `packed` (50–100 businesses, many bookings/reviews/results) are a later
phase; the adapter and fixture format are built to scale to them.
