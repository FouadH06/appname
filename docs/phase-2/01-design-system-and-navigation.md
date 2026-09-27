# Phase 2 · Part 1 — Design System & Navigation Model

Everything in Parts 2–4 references the tokens, components and patterns defined here. If a screen spec says "standard loading" or "TrustMark", it means the definition in this file.

---

## 1. Design principles

| Principle | What it means on screen |
|---|---|
| **Proof over promises** | Real photos, verified counts and structured ratings carry the page. No marketing adjectives ("best!", "amazing!"). |
| **One decision per screen** | Every booking step asks exactly one question. Anything else is secondary and visually quieter. |
| **Trust has one color** | The verification color (teal) is reserved *exclusively* for verification marks. Nothing else in the product uses it, so users learn it means "real". |
| **Quiet chrome, loud content** | Neutral surfaces, thin borders, minimal shadows. Photos and prices are the loudest things on screen. |
| **Local by default** | +961 phones, USD prices, cash at venue, WhatsApp links, area names people actually say, mixed-language text rendered correctly. |
| **Fast on bad networks** | Skeletons over spinners, small images, cached lists, no layout jump. Booking actions are never optimistic. |
| **Dense for operators, calm for consumers** | Business/admin screens favor information density and keyboard speed; customer screens favor whitespace and big tap targets. |

Avoid (from brief): gradients, random colors, over-rounded everything, generic AI illustrations, cluttered dashboards, cheap marketplace badges.

---

## 2. Foundations (tokens)

Colors are **placeholders until branding**; the *roles* are locked, the hex values are not.

### 2.1 Color roles

| Token | Placeholder | Use |
|---|---|---|
| `ink-900` | `#16181D` | Primary text, primary buttons, selected slot |
| `ink-700` | `#3D3F45` | Secondary text |
| `ink-500` | `#7A7C82` | Tertiary text, placeholders, icons at rest |
| `line-200` | `#E6E4DF` | Borders, dividers |
| `surface-0` | `#FFFFFF` | Cards, sheets |
| `surface-50` | `#F7F6F3` | App background (warm off-white, not cold gray) |
| `surface-100` | `#EFEDE8` | Hover, disabled fills, skeletons |
| `accent-600` | `#B4532E` (clay) | Brand accent — active tab, links, focus ring, selected chips. **Used sparingly.** |
| `trust-600` | `#0E7A6B` (teal) | **Only** Verified Booking / Verified Visit / Verified Business marks |
| `star-500` | `#D69A00` | Rating stars only |
| `success-600` | `#1F8A55` | Confirmed/completed states, success toasts |
| `warning-600` | `#B7791F` | Pending, holds expiring, attention items |
| `danger-600` | `#C2362B` | Errors, destructive actions, no-show |
| `info-600` | `#2F66D0` | Informational banners (rare) |

Dark mode: customer app **Soon After Launch**; business dashboard **Later**. Tokens are named by role so dark mode is a token swap, not a redesign.

### 2.2 Booking status colors (shared everywhere: customer, business, admin)

| Status | Pill style | Calendar block |
|---|---|---|
| Pending | warning text on warning-50 | dashed warning border, light fill |
| Confirmed | ink text on surface-100 | solid ink-900 left bar, white fill |
| Completed | success text on success-50 | muted fill, success left bar |
| Cancelled | ink-500, strikethrough time | hidden by default (toggle "Show cancelled") |
| No-show | danger text on danger-50 | danger left bar, hatched fill |
| Disputed (flag) | small danger dot + "Disputed" | danger dot top-right |

Source icon (small, calendar + booking rows): 🌐 web link · 📱 app/marketplace · ✍️ manual · 🔁 rebook · ⏳ waitlist. (Rendered as Lucide icons, not emoji.)

### 2.3 Typography

- Latin: **Inter** (fallback system-ui). Arabic: **IBM Plex Sans Arabic**. Both loaded as variable/subset fonts. Mixed text uses a font stack so Arabic glyphs inside English text render in the Arabic face automatically.
- Weights: 400 / 500 / 600 only.
- Scale (px / line-height): 12/16 · 14/20 · 16/24 (base) · 18/26 · 22/28 · 28/34 · 34/40.
- Tabular numerals in prices, times, tables, calendar.
- Minimum body size on mobile: 16px (also prevents iOS input zoom).

### 2.4 Spacing, radius, elevation

- 4px grid. Common steps: 4, 8, 12, 16, 24, 32, 48.
- Mobile side gutter 16px; desktop content max width 1120px (customer), fluid (business/admin).
- Radius: **6px** inputs/buttons, **10px** cards, **14px** bottom sheets (top corners only), **full** only for chips, avatars, pills. No 24px+ "bubbly" radii.
- Elevation: borders first. Shadow only for floating layers (sheets, popovers, sticky CTA bar, drag ghost).
- Icons: Lucide, 1.5px stroke, 20px default, 16px in dense tables.

### 2.5 Motion

150–200ms ease-out for sheets/popovers; 120ms for state changes. No bouncing, no confetti. Success uses a single check animation (≤600ms). Respect `prefers-reduced-motion`.

### 2.6 Breakpoints

`sm 640 · md 768 · lg 1024 · xl 1280`. Customer web is designed at 375 first. Business dashboard designed at 1280 (desktop), 1024 (reception tablet landscape), 390 (owner phone). Admin: ≥1280 only (below shows "Use a larger screen").

---

## 3. Localization, RTL and local formats

| Topic | Rule |
|---|---|
| UI languages | **Must Launch:** English UI everywhere; Arabic *content* input/display everywhere; WhatsApp templates EN + AR. **Soon:** full Arabic UI (RTL). **Later:** French UI. Components are RTL-ready from day one (logical properties `margin-inline-start`, `ps-/pe-` utilities, mirrored directional icons). |
| Mixed-language text | Render user text with `dir="auto"` per paragraph. Never force alignment on reviews. |
| Numbers in Arabic UI | Western digits (0–9) by default (common in Lebanon); Arabic-Indic optional setting later. Phone numbers, prices and times always isolated LTR (`<bdi>`). |
| Price | USD primary: `$12`, `from $65`, `$40–60`, `Price on consultation`. LBP never stored as price of record; optional display later. Always shown with "Pay at venue" at launch. |
| Price level | `$` / `$$` / `$$$` computed from median service price vs category+cluster benchmark. |
| Time | 12-hour: `4:30 PM` (Arabic UI: `4:30 م`). Relative: Today / Tomorrow / `Thu 3 Oct`. All times in `Asia/Beirut`; a traveler's device timezone never shifts displayed appointment times (show "Beirut time" note if device TZ differs). |
| Phone | Default country +961. Accepts `03 123 456`, `3123456`, `70123456`, `+961 70 123 456`, `0096170...`. Validates mobile prefixes (3, 70, 71, 76, 78, 79, 81) and landlines. International numbers allowed (diaspora visiting in summer/holidays). Stored E.164. |
| Addresses | Area (from hierarchy) + street/building + floor + landmark ("above Bank Audi, next to Spinneys") + map pin. Displayed as: `Hazmieh · Near Mar Takla` then full detail in About. |

---

## 4. Core component library

Each component exists once in `packages/ui-web` (web) and has a React Native twin in `apps/mobile` sharing props/types from `packages/core`.

### 4.1 Trust & discovery marks

| Component | Visual | Rule |
|---|---|---|
| `TrustMark.VerifiedBooking` | teal filled check + "Verified Booking" | On reviews/results from marketplace-initiated completed bookings |
| `TrustMark.VerifiedVisit` | teal outline check + "Verified Visit" | Business-created booking + customer OTP + completed |
| `TrustMark.VerifiedBusiness` | teal shield + "Verified Business" | Only after admin verification (Soon). Tap → sheet: "Identity and contact details checked by APP_NAME. This isn't a guarantee of service quality." |
| `DiscoveryLabel` | neutral outline chip, small icon | Top Rated · Highly Rated for Cleanliness · Great Punctuality · Popular Near You · Available Today · Best Value · New on APP_NAME. **Max 2 per card**, priority order set in RankingConfig. Earned by rules, never sold. |
| `SponsoredTag` (Later) | plain ink-500 text "Sponsored" top-left of card | Never styled like a label or badge |

Every TrustMark is tappable → `TrustExplainerSheet` ("What does Verified Booking mean?").

### 4.2 Rating display

- `RatingInline`: `★ 4.8 · 463 verified reviews`. **Average shown only at ≥5 verified reviews.** Below 5: `New · 3 verified reviews`. Zero: `New on APP_NAME`.
- `RatingSummary`: big number, star row, count, and `DimensionBars` (Service Quality, Cleanliness, Punctuality, Staff Friendliness, Value for Money, Ambience — dimensions come from category config). A dimension only shows when it has ≥5 ratings.
- Never show half-precision beyond one decimal. The displayed number is the plain mean of verified ratings (honest), while ranking uses Bayesian internally — displayed and ranked values intentionally differ.

### 4.3 Discovery components

- `BusinessCard` (list): 4:3 photo (or 2-photo mosaic), name, area · distance, RatingInline, price level, primary category, up to 2 DiscoveryLabels, "Next: Today 4:30 PM", up to 2 featured services with prices. Whole card tappable; heart top-right (app).
- `BusinessCardCompact` (horizontal rails): square photo, name, rating, area, next slot.
- `ResultTile`: square image, small TrustMark icon, service name overlay at bottom; tap → Result Detail.
- `CategoryChip`, `ServiceChip` (search suggestions), `AreaPicker` (cluster-first list).
- `FilterBar` (horizontal chips) + `FilterSheet` (full options) + `SortMenu`.

### 4.4 Booking components

- `ServiceRow`: name, duration, price (typed display), 2-line description clamp, `Select`/`Book` button; tap row → `ServiceDetailSheet`.
- `StaffPreferenceOption`: radio card for **Any available** (stacked avatars, "Recommended for fastest booking", earliest time) and **Choose someone**.
- `StaffCard`: photo, name, role/title, rating + verified review count (only if ≥5 reviews), verified appointments (rounded, hidden <20), up to 3 specialties, next available, price/duration only if overridden, ♡ (Soon). Compact variant = avatar + name + next time (team strip, chips).
- `RebookStaffShortcut`: "Book again with Maya · last visit 24 days ago · Next: 4:30 PM".
- `AssignedStaffRow`: photo + "You'll be with Karim · Assigned from available staff · Change".
- `DateStrip`: 14 horizontally scrollable days; each shows weekday + date + availability dot; disabled if none. "Pick a date" opens month picker.
- `SlotGrid`: slots grouped Morning / Afternoon / Evening; 3–4 per row on mobile; selected = ink-900 fill.
- `BookingSummaryCard`: business, service, staff, date, time–end time, duration, price, "Pay at venue · Cash".
- `HoldTimer`: subtle text "We're holding 4:30 PM for you · 4:12". Turns warning at <60s.
- `PhoneInput` (+961 default with country switch), `OtpInput` (6 digits, SMS/WhatsApp autofill, paste support, resend countdown, "Send by SMS instead").
- `StickyCTA`: bottom bar (mobile) with price summary left, primary button right; safe-area aware; hides when keyboard open.
- `Stepper` (booking): compact "Step 2 of 4" + back; steps auto-skip when there's only one choice.

### 4.5 Content components

- `ReviewCard`: author (first name + last initial), TrustMark, date of visit (month/year), service + staff, overall stars, dimension mini-scores (collapsed), text (`dir=auto`, 5-line clamp → "More"), photos row, "Translate" link, business reply (indented, labeled "Response from {Business}").
- `BeforeAfterPair`: side-by-side (desktop) / swipe (mobile) with "Before"/"After" labels.
- `PhotoUploader`: multi-select, client-side resize (≤2048px), per-file progress, retry, remove.

### 4.6 Operator components (business + admin)

- `CalendarGrid` (staff columns × 15-min rows), `AppointmentBlock`, `NowLine`, `DataTable` (sortable, sticky header, row actions, bulk select), `KpiTile` (value, delta vs previous period, tooltip definition), `AttentionItem` (icon, count, one-line, action), `QueueItem`, `DiffViewer` (audit), `CommandPalette` (⌘K / Ctrl+K), `Drawer` (right side, desktop), `KeyboardHint`.

### 4.7 Feedback components

`Skeleton`, `InlineError` (with Retry), `Toast` (4s, one at a time, action optional), `Banner` (page-level: offline, account restricted, business not live), `ConfirmSheet` (destructive only), `EmptyState` (one sentence + one action; no illustrations — optionally a single line icon).

---

## 5. Cross-cutting state patterns

Screen specs reference these by name.

| Pattern | Definition |
|---|---|
| **Standard loading** | Layout-matched skeletons render within 100ms. No full-screen spinner except OTP verify and final booking commit. After 8s: inline "Still loading — slow connection?" + Retry. Images use blurred low-res placeholders (blurhash stored with media). |
| **Standard error** | Inline at the failing region with plain-language message + Retry; the rest of the page stays usable. Server error codes map to copy in `packages/i18n` (never raw messages). |
| **Offline** | Top banner "You're offline". Cached content visible read-only. Booking, cancel, review submit disabled with reason. Queued: nothing — we don't queue mutations offline (avoids ghost bookings). |
| **Not found / removed** | Full-page: "This page isn't available" + what to do (search, go home). Suspended businesses show neutral copy (no accusations). |
| **Forbidden** | Business/admin: "You don't have access to this. Ask the owner." Never reveal whether the resource exists to non-members. |
| **Empty** | One sentence explaining *why* it's empty + one action. |
| **Optimistic UI** | Allowed: favorites, notes, read/unread, UI prefs. **Never**: booking create/move/cancel/status, review submit, moderation decisions. |
| **Concurrent change** | If realtime reports that an item on screen changed (e.g., reception moved a booking), refresh it in place and toast "Updated by {name}". |
| **Destructive confirm** | Sheet stating the consequence ("The customer will be notified on WhatsApp"). Reversible actions don't confirm; they offer Undo in the toast where possible. |

---

## 6. Voice & copy

- Short, warm, direct. Second person. No exclamation marks except success.
- Say what happens next: "You'll get a WhatsApp confirmation" beats "Booking submitted".
- Examples:
  - CTA: **Book** · **Confirm booking** · **Send request** · **Book again** · **Book similar**
  - Empty favorites: "Tap ♡ on a place you like and it'll show up here."
  - Slot taken: "Someone just booked 4:30. Here are the nearest times."
  - Moderation pending: "Thanks! Your review is being checked and usually goes live within a few minutes."
- Business copy uses operator language (appointment, walk-in, no-show). Customer copy uses plain language (booking, visit, missed).

---

## 7. Accessibility

WCAG 2.2 AA contrast; 44×44px minimum tap targets; visible focus ring (accent-600, 2px); full keyboard support on web (booking flow, calendar, moderation); screen-reader labels on stars ("Rated 4 out of 5"), slots ("4:30 PM, available with Karim"), and status pills; dynamic type support in app up to 200% without clipping; never communicate status by color alone (status pills always have text).

---

## 8. Navigation model

### 8.1 URL map (web)

| Route | Screen | Notes |
|---|---|---|
| `/{slug}` | Public Business Booking Page | Canonical business URL. Reserved-word list prevents collisions (`/search`, `/biz`, `/login`, area names…). Slug changes 301-redirect. |
| `/{slug}/book` | Booking flow | Step state in query: `?service=&staff=&date=&time=` so back/forward, refresh and shared links work. |
| `/{slug}/results`, `/{slug}/reviews` | Full results grid / all reviews | Indexable. |
| `/r/{resultId}` | Result Detail | Shareable; foundation for visual discovery. |
| `/search?q=&area=&…` | Search results | `noindex` for arbitrary queries. |
| `/{area}/{category}` e.g. `/achrafieh/barbers` | SEO landing = pre-filtered results | Indexable, generated only for live cluster × category with ≥5 businesses. |
| `/bookings`, `/bookings/{id}` | My bookings / detail | Auth by OTP session or signed magic link from WhatsApp (`/m/{token}` → sets session scoped to that booking, upgrade to full login via OTP). |
| `/review/{token}` | Leave review | Signed, single-use, expires with review window. |
| `/biz/...` | Business dashboard | Role-gated. |
| `admin.platform.com` | Admin | Separate origin. |

Every business page ships Open Graph/Twitter meta with a generated share image (cover + name + rating + area) so links look good in WhatsApp and Instagram DMs.

### 8.2 Customer web navigation

- **Business page & booking flow:** focused funnel. Minimal header: back (when inside flow), small `APP_NAME` wordmark, language (Soon), "Sign in" / avatar. **No global nav, no competitor links, no "similar businesses"** on pages reached from a business's own link — businesses won't share a link that advertises competitors. (Rule: `source=business_link` or direct `/{slug}` visits never render cross-business recommendations.)
- **Discovery pages (home/search):** top bar with search field, area picker, account. Mobile: search collapses into a tappable field.

### 8.3 Customer app navigation

```
Bottom tabs:  Home · Explore · Bookings · Favorites · Profile
```
- Tab badges: Bookings shows a dot for "action needed" (review due, pending request update). No numeric badge spam.
- Notifications: bell icon in Home header (not a tab).
- Booking flow: full-screen modal stack over tabs (swipe-down to dismiss with "Leave booking?" confirm if a hold exists).
- Business Profile, Result Detail: pushed onto the current tab's stack.
- Deep links (universal/app links) mirror web routes: `platform.com/{slug}` opens the app's Business Profile if installed, otherwise web. Never interstitial "open in app" walls.
- Explore may later merge into Home (search-first home) if testing shows the tab is redundant; screens are built so Explore content can be embedded.

### 8.4 Business dashboard navigation

- **Desktop (≥1024):** left sidebar — Overview · Calendar · Bookings · Customers · Services · Staff · Reviews · Analytics · Settings. Top bar: business switcher (multi-business owners, Later), global search (Ctrl+K: customers by name/phone, bookings), **+ New appointment** (always visible; shortcut `N`), notifications, account.
- **Tablet (768–1023):** icon rail sidebar; calendar gets full width.
- **Mobile (<768):** bottom nav — **Today · Calendar · [＋] · Customers · More** (More → Bookings, Services, Staff, Reviews, Analytics, Settings). The center ＋ opens Appointment Creation.
- **Staff role:** sees only Today (their day) + Calendar (own column) + their upcoming customers. Sidebar items outside role are hidden, not disabled.
- Pending requests and reviews-needing-reply show counts in the sidebar.

### 8.5 Admin navigation

Desktop-only left sidebar with live counts: Overview · Moderation (n) · Reports & Disputes (n) · Businesses · Customers · Reviews · Catalog · Ranking · Audit Log. Global search (phone, business name, booking ID, review ID). Keyboard-first in queues (`A` approve, `R` reject, `M` more actions, `J/K` next/previous, `E` escalate).

---

## 9. Shared flow rules (apply to web + app)

1. **Auto-skip steps with one option** (one qualified staff → skip Staff step; one service → skip Service step), but show the chosen value in the summary so nothing feels hidden.
1b. **Staff is optional for the customer, mandatory for the booking.** "Any available" is the default; a concrete `staff_id` is assigned at hold time and shown before confirmation. Canonical flow: Service → Staff Preference → Date → Time → Confirmation.
2. **Slot hold** is created when the customer taps a time and lands on Booking Review (5 min; extended to 10 min once OTP is requested). Holds belong to user or anonymous session.
3. **Phone verification happens as late as possible** (Booking Review), never before the customer has picked a time.
4. **Returning customers** (session present) skip OTP entirely.
5. **Final commit** is the only full-screen blocking state in the flow ("Booking…"), max 10s, then deterministic success or a recoverable error.
6. **Policy is shown before commit, not after** (cancellation window, request vs instant, pay at venue).
7. **Every notification deep-links** to the exact screen it's about (booking detail, review form, waitlist offer).
