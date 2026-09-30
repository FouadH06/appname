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

## Tests

| Check | Result |
|---|---|
| Lint · typecheck · format | ✅ |
| Unit | 197 passed |
| pgTAP (unchanged backend) | 973/973 |
| Web e2e | _see final run_ — booking, search, reviews, results specs updated for the new UI (pick + Continue, copy), new responsive guard |
| Admin e2e · App e2e · builds | _see final run_ |

## Remaining visual issues / notes

- The local data has no photos, so screenshots show neutral image placeholders; the design relies on real
  photography (the packed demo will show it).
- Date strip shows 10 of 14 days at 1440 px (the rest scroll horizontally).
- The "You're booked" banner on a business page still uses the older success-green bar.
- Expo app: palette/radii only; its screens still follow the M13 layout.

## Decisions needed

1. Approve the deviations above (especially 1, 2 and 5).
2. "Open now" / "Instant booking" filters and badges: add booking mode + opening hours to search results (small
   M12 change) or leave them out for the pilot?
3. Dark mode on the customer surface: light-only for the pilot, or design a dark variant later?
