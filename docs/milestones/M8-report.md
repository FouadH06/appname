# M8 — Public web booking (acquisition product): report

Status: **implemented, awaiting review** · Branch `m8-public-booking`

Gate B (business pilot) still blocks any broad public-booking launch; M8 may be used on staging
with pilot salons' own links once Gate B passes. Hosted staging verification is deferred with
M4–M7 (M4 report checklist, now including M8) and is mandatory before any real users.

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| C1 business page `platform.com/{slug}` | Server-rendered with a 1-minute cache (identity, services, hours in the first HTML); cover + "+N photos"; name, category · price level · who it serves, area + landmark, **Open now · until …** / **Closed · opens …** (Beirut time); WhatsApp · Call · Directions · Share; **Earliest times** for the most-booked service (tap → flow with service + time); services grouped with sticky tabs and **Popular** first, **Book** per row, **Ask on WhatsApp** for on-consultation services; team strip with **staff sheet** (bio, specialties, services, **Book with {name}**); photos; about (description `dir=auto`, address, Google Maps, hours table with today highlighted, Instagram); footer (powered by, report, terms, privacy); **sticky "Book appointment · from $…"** on phones, **sticky booking panel** on desktop. Not accepting → banner + contact, no Book; draft/suspended → "This page isn't available"; unknown → 404; old slug → **301** to the new one; uppercase → lowercase. "You're booked Thu 4:30 PM · Manage" banner for a returning signed-in visitor. Link preview image (Open Graph) | Phase 2 C1 |
| C7–C10 booking flow `/{slug}/book` | Service → **Staff** (Any available preselected and "Recommended for fastest booking", **Book again with {name}** for returning customers, Choose someone with next available, price/duration differences, appointment counts ≥ 20; auto-skip with one eligible person; `any_only` / `choose_only`) → **Date & time** (staff chips, 14-day strip with availability, Morning / Afternoon / Evening slots, "No times on Thu. Next available: Fri 10:00 AM →", Beirut-time note) → tap = **hold** (anonymous session behind Turnstile; concrete staff assigned by the business rule) → **Review** (hold countdown and "Check if 4:30 is still free" on expiry, "You'll be with Karim · Change", price for the assigned person, **phone code** (WhatsApp first) with the hold extended, name for new customers, note, policy, request-mode wording) → **Confirm booking** / **Send request**. Slot taken → "Someone just booked 4:30. Pick another time." and refreshed slots. Booking rules are refreshed on arrival (the cached page may be a minute old). UTM / referrer stored as attribution | Phase 2 C7–C10 |
| C11 success + C13 booking detail `/bookings/{id}` | "You're booked" / "Request sent", "Confirmation sent to WhatsApp +961 70 ••• 456"; status, when/where, service/staff/price, note; **Add to calendar** (.ics + Google Calendar), **Directions**, **WhatsApp/Call**; **Reschedule** (same staff member, their free times), **Cancel** (late-cancellation warning inside the policy window, optional reason), completed → **Book again with {staff}** / with anyone, cancelled → Book another time, no-show → **"I was there"** contest (7 days, once) → "Under review"; staff-change banner; activity timeline; "We couldn't reach you on WhatsApp" when messages failed | Phase 2 C11, C13 |
| C12 My bookings `/bookings` | Phone code to see them; Upcoming · Past; cards with status, "Booked by {Business}"; **"We found previous visits"** claim prompt (Flow B) | Phase 2 C12 |
| WhatsApp links `/m/{token}` | Online bookings: verify the booking's phone → **Manage booking**; claimed visits → **View booking** | Part 3 §4.2 |
| Database | `get_business_page` (non-leak, redirects, states), `get_my_next_booking_at`, `get_staff_options` (public staff only, rebook shortcut, display rules), `get_my_bookings` / `get_my_booking` (customer-visible timeline), `contest_no_show` + `disputes` / `dispute_messages` (admin UI in M11); `resolve_access_token` now returns the booking id | Part 3 §4.2, Part 4 §5, Part 5 §2.2 |

## Migration created

| File | Contents |
|---|---|
| `20261004100000_m8_public_booking.sql` | Disputes, business page, staff options, customer read models, no-show contest, token summary with booking id |

## Tests executed

| Layer | Result | What it proves |
|---|---|---|
| pgTAP | **636/636** (26 new in `270_public_booking`) | Visitors (anon) get the page, slug case-insensitive; **only public, active staff; no internal-only or archived staff id or name anywhere in the payload** (and in staff options); on-consultation services shown but not bookable; accepting vs paused; draft → unavailable; unknown → not_found; **old slug → redirect**; rebook shortcut only for the returning customer; My bookings only their own, internal staff first name but never the id, past includes no-shows; detail with timeline; "you're booked" data; someone else's booking FORBIDDEN; anonymous visitors must verify; contest: statement required, 7-day window, once, opens a dispute + marks disputed + logs event |
| E2E web (local stack) | **15 passed** (1 new) | **Phone funnel**: Instagram link → business page (no internal staff anywhere) → Book → auto-selected single staff → first free slot → hold with countdown → phone code → name → note → **Confirm** → "You're booked" (confirmation queued) → My bookings → detail → **Cancel** (acknowledgement queued); **request mode**: Any available (recommended) → "You'll be with …" → **Send request** → "Request sent"; **renamed business → old link redirects** |
| E2E admin, unit, harness, lint, typecheck, format, DB lint, builds | ✅ | Web builds without env (public pages render on demand) |

Manual check in the browser: phone business page (identity, open-now, earliest times, services,
sticky CTA). Local e2e runs best with `--workers=2` (a cold dev server under five workers plus
Cloudflare's captcha check caused timeouts).

## Deviations for your approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | M4 `resolve_access_token` | Summary also returns the booking id | Lets `/m/{token}` open the booking after phone verification; ownership is still checked by `get_my_booking` |
| D2 | C1 loading | Page cached for 1 minute (ISR); the booking flow refreshes booking rules on arrival; after a slug change the old address may show the old page for up to a minute before redirecting | Fast first HTML on slow 4G without per-visitor data |
| D3 | C1 reviews / results | Reviews show "New on APP_NAME — reviews appear after verified visits"; results strip hidden | Reviews M9, results M10 |
| D4 | C1 map | "Open in Google Maps" link instead of a static map image | Map provider is a pre-launch decision (as M5 D6) |
| D5 | C13 reschedule | Same staff member only (their free times); "Any available" reschedule and bookings with internal-only staff → contact the business | Needs server-side Any assignment for reschedules; small follow-up if you want it |
| D6 | i18n | Customer pages' copy is English in code (error copy stays in the catalogs; business content `dir=auto`) | English UI at launch; extraction with the Arabic UI (Soon) |
| D7 | C13 contest | Text statement only; evidence photo upload later | Needs the dispute-evidence media pipeline (M10) |
| D8 | C1 footer / C10 | Terms and privacy pages are placeholders ("published before launch") | Legal text is a pre-launch task |
| D9 | C11 | No "Get the app" prompt; Share on the success page not added | No app yet (Expo later) |
| D10 | Scope | Favorites (♡), staff ratings (≥ 5 reviews rule) not shown | Soon / M9 |
| D11 | Tooling | Test number `70 000 012` | Customer funnel e2e |

## Known gaps / notes

- **Not measured yet**: Lighthouse LCP < 2.5 s on slow 4G / CLS < 0.1 (needs a production build on
  staging), and the **in-app browser matrix** (Instagram / TikTok / WhatsApp × iOS / Android) —
  both added to the deferred hosted checklist.
- Slot-taken recovery is implemented (toast + refresh) but not driven in e2e; server-side
  conflicts are covered by pgTAP and the concurrency harness.
- The business-side dashboard now links to real booking pages; the share kit still shows
  `platform.com/{slug}` until the web domain is set.

## Suggested manual checks

1. Open a pilot business link on your phone from Instagram: is booking in under a minute realistic?
2. Staff step: is "Any available · Recommended" clear enough, and is the rebook shortcut useful?
3. Cancel inside the policy window: is the warning wording right?
