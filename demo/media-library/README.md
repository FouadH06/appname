# APP_NAME Beauty/Grooming demo-media source library

This ZIP is a standalone **source library** for demo/fake beauty and grooming businesses.

## Scope
- Business/interior imagery: hair salons, barbers, nails, brows/lashes, spas, general beauty salons.
- Customer-result imagery: women's hair/styling and blowouts, color, balayage/highlights, men's cuts/fades, beard grooming, manicure/pedicure/nail art, brows, lashes.
- Staff imagery: hairstylists, barbers, nail technicians, brow/lash technicians, spa/beauty staff.
- Branding: generated business covers and generic/demo logo placeholders.

**Total manifest assets:** 294
- Source-linked Pexels stock references: 159
- Embedded generated SVG demo assets: 135

## Important: source-linked stock
The stock photos are intentionally stored as **source descriptors**, not redistributed binary copies. Every stock record includes its original image URL, optimized preview URL, source photo page, photographer/provider, category/subcategory, orientation, intended usage, and stock/generated flag. This keeps licensing attribution and source traceability intact.

Open `preview.html` with internet access to see remote stock previews. Generated assets work offline.

## Aspect-ratio policy
`preview.html` uses `object-fit: contain`, intrinsic dimensions, and a neutral preview frame. Portrait and landscape photography are **not center-cropped into uniform squares**.

## Folder structure
```text
demo-media/
  businesses/
    hair-salons/
    barbers/
    nails/
    brows-lashes/
    spas/
    beauty-salons/
  results/
    womens-hair/
    hair-color/
    balayage/
    mens-hair/
    beard/
    nails/
    brows/
    lashes/
  staff/
  covers/
  logos/
  manifest.json
  preview.html
  README.md
```

## Metadata
Each stock/generated asset is represented in `manifest.json`. Category folders also contain per-asset `.json` descriptors. Generated files have a local `filename`; stock records use remote source/preview URLs.

## Licensing
Pexels entries were curated as license-friendly stock references. Before production reuse, verify the current source-page terms and any people/property release requirements for your specific use case. Generated SVGs are demo placeholders produced for this package.

## Non-scope
This package deliberately does **not** modify Supabase, seeding logic, migrations, or application code.
