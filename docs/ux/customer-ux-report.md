# Customer UX pass — report

Status: **implemented, awaiting review** · branch `ux-customer` (not merged)

Scope (PO, 2026-09-30): implement the locked visual references on the existing customer web spine,
responsive from 320 px to 1920 px+, without changing product behaviour, RPCs, RLS or architecture.
Surface: **web first**; the Expo app received the same palette and radii (full app screen pass later).
Business dashboard and admin are untouched (the new palette is scoped to customer pages).

## Screens implemented

| # | Screen | Route | Notes |
|---|---|---|---|
| 1 | Design tokens + shell | all customer routes | `[data-surface='customer']` tokens (ivory, deep green, near-black ink, thin borders, 10/14 px radii); phones/tablets: bottom tabs Home · Search · Bookings · Favorites · Profile; ≥ 1024 px: header navigation; content max 1320 px |
| 2 | Home | `/` | search first, quick intents, categories (only live categories), Your next booking / Book again (signed-in), Available today · Top rated · Popular services · New; rails scroll on phones, 2/3/4-column grids on tablet/desktop (max two rows) |
| 3 | Search / results | `/search` | same search box and URL filters everywhere; phones: concise chip row (Today · Near me/3 km · Rating 4.5+ · price) + "More filters & sort"; desktop: left filter column + 2–3 column results; earliest time is the card's booking shortcut |
| 4 | Business profile | `/{slug}` | gallery with counter and back/♡/share, name, verified rating, area, open status, next available + Book; Services (tappable cards, per-service next time, no Book button per card) · Professionals (Any available + team) · Portfolio & results (shoppable) · Reviews · Important info (payment, real cancellation policy, address, contact, hours, about); desktop 70/30 with sticky booking panel; phones: Book bar appears once the header Book scrolls away |
| 5 | Professional | `/{slug}/book` | compact service header, Any available (default, earliest time), professionals with next time; 1/2/3 columns |
| 6 | Date & time | `/{slug}/book` | compact summary, date cards (Today/Tomorrow…), Morning/Afternoon/Evening, 3→6 slots per row, Instant/Request tags, legend; pick then Continue; desktop keeps Continue in the sticky summary |
| 7 | Review your booking | `/{slug}/book` | pre-confirmation: summary, booking status (Instant confirmation / Request), Payment (cash at the business), Cancellation (business policy + concise no-show line), phone verification if needed, note; CTA **Confirm booking** or **Send booking request** |
| 8 | Success | `/bookings/{id}?new=1` | Booking confirmed! / Request sent, booking card, Add to calendar · Directions · Contact business · View booking · Done |
| 9 | Favorites, Profile | `/favorites`, `/account` | nav targets (existing M13 RPCs; phone sign-in; sign out) |
| — | Other customer pages | bookings, explore, landing, results, review/magic links, legal | inside the same shell and tokens |

## Reusable components (`apps/web/src/components/customer/`)

`CustomerShell` + `Wordmark` (brand from the i18n catalogue — configurable), `layout.ts` (`BRAND`, `container`),
`icons.tsx` (outline set), `CategoryIcon`, **one** `BusinessCard` with three modes (business · availability ·
service) and a compact row layout for result lists, `Rating`, `ServiceTile`, `Section` (rail → grid),
`FavoriteButton` (optimistic, one load per page), `ReturningModules`, profile islands (`Gallery`,
`NextAvailableRow`, `ServiceNext`, `StickyBookBar`, back/share), booking pieces (`ConfidenceTag`,
`StickyAction`, `InfoCard`, `ServiceHeader`, side summary). No mobile/desktop duplicates.

## Responsive behaviour

- < 640: single column, rails, bottom tabs, sticky CTAs above the home indicator (`safe-area-inset-bottom`).
- 640–1023 (tablet portrait / phone landscape): 2-column grids, filters as chips, bottom tabs kept.
- ≥ 1024 (tablet landscape, laptop): header nav, filter column, 3-column grids, profile 70/30 with sticky panel,
  booking with sticky summary + action.
- ≥ 1280: 4-column marketplace grids; content capped at 1320 px on 1920 px screens.
- Guarded by `e2e/ux-responsive.spec.ts`: no horizontal overflow on 7 customer routes at 375, 430, 667×375,
  844×390, 768, 1024, 1280, 1440, 1920; bottom tabs below 1024 px only.
- RTL: logical properties throughout (`start/end`, `ps/pe`, `ms`), chevrons flip; checked with `dir=rtl`
  (layout mirrors, no overflow). Arabic copy itself is not in scope.

## Deviations from the images (and why)

1. **Instant vs Request per slot** — the backend decides per business (booking mode), not per slot; every
   slot shows the business's real mode (⚡ Instant or ◷ Request) and the legend explains only that mode. Services
   that can't be booked online show "Ask about availability". (Functional rules override the mockup.)
2. **Search filters "Open now" and "Instant booking"** and the per-card instant badge are **not shown**:
   search results don't carry opening hours or booking mode, and adding them means changing the locked M12
   search. Home's "Open now" intent became **Soonest available** (existing sort). Needs a decision (below).
3. **Cards show one next time**, not three: search returns the next slot only.
4. **No service photos / staff ratings / amenities / "verified business" check**: not in the data model's public
   payloads (staff ratings don't exist; amenities and verification aren't exposed; verification is a placeholder).
   Services use text cards; professionals show role/specialty.
5. **Time step uses pick + Continue** (as in the image); the hold is taken on Continue (before: on tap). Same RPC.
6. **Payment** reads "Cash at the business"; **cancellation** text comes from the business policy
   (`cancellation_window_minutes`), with one concise no-show line matching the reliability rules.
7. **Light only** on the customer surface (references are light); dark mode users get the light theme there.
8. **Wordmark** is the configurable product name (currently `APP_NAME`), not "Nabni".
9. **Images**: business photos are stored ≤ 1600 px WebP; cards lazy-load them in fixed-ratio boxes. A
   `NEXT_PUBLIC_IMAGE_TRANSFORMS=true` switch requests width-limited renditions where Supabase image
   transformations are available (paid plan). Customer-result tiles already use M10 thumbnails.

## Demo media (UX-level demo data)

- **Library**: `demo/media-library/` (the delivered package, manifest canonical). **Resolution**:
  `demo/src/adapter.mjs` selects deterministically by `category` / `subcategory` / `intended_usage`
  (seeded per business; no image reused across businesses); components only receive normal stored media.
- **Seeder**: `pnpm seed:demo` (local stack only; `DEMO_ALLOW_REMOTE=1` required for a dedicated demo
  environment). 11 fictional businesses: 2 barbers, 2 hair salons, 2 nail studios, 2 brows/lashes, 1 spa,
  2 beauty centers (one contact-only) — instant, request and "ask about availability" examples, 0–31 reviews,
  0–8 results, short and long descriptions, 1–4 staff.
- **Used**: business interiors (barbers, hair-salons, nails, brows-lashes, spas, beauty-salons — stock,
  landscape first), customer results (mens-hair, beard, womens-haircut-styling, hair-color, balayage,
  blowout-styling, manicure, nail-art, pedicure, brows, lashes — stock), staff portraits (**generated** only).
  Not used: generated covers/logos (abstract placeholders; the UI has no logo slot and real interiors make
  better covers), stock staff photos (real people must not be presented as fictional employees).
- **Downloaded / imported**: yes — each selected stock asset's *optimized preview* was fetched once into
  `demo/.cache/` (git-ignored), processed with sharp into the M10 derivative layout and uploaded to the local
  `business-media` / `ugc-public` buckets. **No image is externally referenced** by the product.
- **Source / licence metadata**: stays in the manifest (provider, source page, photographer, original URL,
  category, subcategory, usage, stock/generated flag). Every imported file is stored under
  `…/demo/<library asset id>…` — the durable demo marker and link to that record (it survives M10 processing);
  slugs start with `demo-`; `processor_version` starts as `demo-import:<version>:<asset id>`.
- **M10 not bypassed**: demo business photos pass through the normal M10 transform + safety check (all 47
  approved); the seeder drains the local pipeline so no backlog is left (a backlog first made the results e2e
  time out — fixed in the seeder, no product change).
- **Unavailable**: 2 stock sources returned 404 (`pexels-5484948`, `pexels-5484947`) — skipped
  deterministically, replaced by the next candidate.
- **Insufficient in the library**: spa/massage and waxing/threading **results** (spa and beauty centers show
  no results — honest), makeup (no businesses seeded; the Makeup category still shows because it is live in
  the catalog), and enough generated staff portraits (3 per role, abstract): staff beyond that show initials.
  No non-beauty categories (fitness, pets, home services) — none were faked.
- Stored business photos are ≤ 1600 px WebP (~100–250 KB); cards use them lazily in fixed-ratio frames until
  image transformations are enabled (`NEXT_PUBLIC_IMAGE_TRANSFORMS`); results use the 320/800/2048 derivatives.

## Visual-density pass (PO review, 2026-09-30)

Same components, same behaviour — smaller, denser, more choices as the screen widens:

- **Cards**: image 16/10 → 16/9 (2/1 from 1280 px, ≈ 20 % shorter); body padding and gaps tightened; service/labels
  and price share one line; "Next …" is a compact 32 px row (40 px on phones). Grids: 2 → 3 (768) → 4 (≥ 1024)
  columns, two rows at most.
- **Home**: title/subtitle tighter; search and quick filters share one row on desktop; categories are compact pills
  from 768 px (circles on phones); section gaps 48 → 32 px.
- **Search**: horizontal result cards at every width (112–128 px image) — 1 column on phones, 2 on tablets, 3 from
  1280 px; sidebar 248 → 216 px with denser options. Chosen over tall vertical cards: ~3× more results per
  viewport with rating, area, service, price and next time on each.
- **Profile**: gallery 432 → 240–280 px on desktop (two photos side by side from 768 px), 4/3 → 3/2 on phones;
  shorter service cards (3 per row at ≥ 1280, 3 on tablets); compact "Any available"; sticky panel kept.
- **Professional**: "Any available" is one compact row; staff cards ≈ 30 % shorter (44 px avatar, next time as text);
  1 / 2 / 3 columns.
- **Date & time**: slots 56 → 48 px (52 px on phones), 4 per row from 360 px, 6 on tablets, 8 on desktop; smaller
  date cards and part headers; Instant/Request keep icon + text.
- **Fixes found on the way**: phone rails snapped the first card to the screen edge (scroll-padding now matches the
  16 px gutter); row images no longer stretch result cards.

## Tests

| Check | Result |
|---|---|
| Lint · typecheck · format | ✅ |
| Unit | 197 passed |
| pgTAP (unchanged backend) | 973/973 |
| Web e2e (full, demo data seeded) | 23/23 (15 are device-project skips by design); `results` first timed out behind the demo media backlog → seeder fixed to drain M10, rerun ✅; calendar captcha flake did not recur |
| Responsive guard (`ux-responsive.spec.ts`) | ✅ 7 routes × 9 widths, no overflow |
| Admin e2e · App e2e | 1/1 · 1/1 |
| Builds (web, admin) · Expo web export | ✅ · ✅ |
| Demo seed from a clean reset | 11 businesses, 78 media, M10 queues empty, 0 photos rejected (~25 s) |

## Remaining visual issues / notes

- Home's Available today is empty after the demo businesses close (20:00 Beirut) — correct behaviour.
- Date strip shows 10 of 14 days at 1440 px (the rest scroll horizontally).
- The "You're booked" banner on a business page still uses the older success-green bar.
- Expo app: palette/radii only; its screens still follow the M13 layout.

## Decisions needed

1. Approve the deviations above (especially 1, 2 and 5).
2. "Open now" / "Instant booking" filters and badges: add booking mode + opening hours to search results (small
   M12 change) or leave them out for the pilot?
3. Dark mode on the customer surface: light-only for the pilot, or design a dark variant later?
