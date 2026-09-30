# M13 — Expo customer app: report

Status: **implemented, awaiting review** · branch `m13-app`

Lean scope: the Phase 2 customer screens as a native app on the existing RPCs, plus the retention backend
(favorites, rebook suggestions, push, inbox). No new booking logic; M12 search untouched. Store builds
and device testing need the PO's Apple/Google accounts (M4 checklist → app release).

## Built

| Area | Contents |
|---|---|
| Backend (`20261009100000_m13_app`) | `favorite_businesses` (RLS: own rows only, writes via RPC) + `toggle_favorite_business` / `get_my_favorites` (unavailable businesses stay listed, flagged) / `is_favorite_business`; `get_rebook_suggestions` (last completed visit per business + service, same staff only if still active, public and performing the service, next free time, live businesses and online services only); `push_tokens` + `register_push_token` (Expo token format check; a token moves to the account now signed in on that device) / `unregister_push_token` / `push_tokens_invalid` (service role); inbox `get_my_notifications` (customer types only, 90 days) + `get_unread_notification_count`; reserved slugs `captcha`, `sign-in` |
| Push channel | Dispatcher gains `push` (Expo push service; `DeviceNotRegistered` tokens disabled automatically; optional `EXPO_ACCESS_TOKEN`); log sender locally. Routing: review request / published / needs changes, result published / rejected and dispute updates go **by push when the customer has an active app token and hasn't turned app notifications off, otherwise WhatsApp**; booking messages stay WhatsApp + SMS. Push taps open the same path the web uses (`/bookings/{id}`, review link, `/r/{id}`) |
| App (`apps/mobile`, Expo SDK 57 + expo-router) | Tabs Home · Explore · Bookings · Favorites · Profile. C2 Home (Book again with {staff} → one tap into the time step, upcoming < 48 h, rails, unread bell); C3 Explore (typed suggestions, recents, popular); C4 results (filters, sorts, paging, honest empty states, also nearby); C5 profile (tabs, ♡ optimistic, share, sticky Book); C6 result detail; C7–C11 booking flow (same RPCs as web, hold timer, phone code only if signed out, first name if missing, `channel: app` attribution, `rebook` source); C12 bookings; C13 detail (cancel with late warning, reschedule same staff, contest, book again, review, directions, WhatsApp, timeline); C14 favorites; C15 review + C16 photo upload (consent, on-device resize/re-encode → EXIF stripped, private bucket, status polling); C17 inbox (Today / Earlier, mark read, deep-link rows); C18 profile (name, phone, notification switches, my reviews, legal, log out → token unregistered, **delete account** with an explicit confirm listing upcoming bookings); magic links `/m/{token}`, `/review/{token}`; offline banner |
| Auth | Same phone OTP as web; Turnstile runs on the web app's `/captcha` page inside a WebView (iframe on the web build) and posts the single-use token back. Session in SecureStore (chunked) on devices |
| Push permission | Asked only on the first booking's success screen ("Want a reminder…?"); "Not now" never asks again (switch in Profile) |
| Links | Routes mirror web URLs; `scheme appname`, iOS associated domains, Android verified intent filter; web serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` from `APPLE_TEAM_ID` / `ANDROID_CERT_SHA256` (empty until set) |

## Decisions (please confirm)

1. **Push replaces WhatsApp** for the six non-booking message types when the app can receive it; booking
   confirmations, reminders and changes always stay WhatsApp + SMS (reliability; Confirm/Cancel buttons).
2. **No session hand-off from web to app** via links (a link that carries a session is a takeover risk).
   Someone who installs the app verifies their phone once; the same account then works on both, and
   `/m/{token}` + `/review/{token}` links still open the right screen.
3. **Favorites do not affect search ranking.** The Phase spec lists favorite = 1.0 in the personal score,
   but M12 is locked ("no extra personalization") — not changed. Your call (see below).
4. The Expo **web build is a test harness**, not a product: customers use the Next.js site. The app e2e runs
   on it because this machine has no Android SDK/emulator.
5. Profile shows Terms and Privacy; **no Help page exists yet** on the web, so none is linked.

## Migrations / schema

One migration, `20261009100000_m13_app.sql`: `favorite_businesses`, `push_tokens`, notification routes
`{push,whatsapp}` for the six types, `notify_claim` (push-aware due check + `push_tokens` in the payload),
`get_my_notifications` (replaced), new RPCs above, two reserved slugs. DB types regenerated.

## Security

Favorites and push tokens: RLS own-rows read, no direct writes (definer RPCs, `AUTH_REQUIRED` for
anonymous sessions). `push_tokens_invalid` is service-role only. Inbox excludes business and OTP rows and
dashboard links. Tokens are validated by format; a token re-registered by another account moves to it
(one device = one account). Log out unregisters the device before signing out. Photo uploads keep the M10
private-first path and consent version.

## Tests

| Layer | Result |
|---|---|
| pgTAP | **930/930** (31 in `320_app`: favorites RLS/toggle/order/unavailable, rebook staff rules + live/online filters, push token format/move/unregister/service-role guard, push-vs-WhatsApp routing incl. disabled push, inbox filtering/retention/unread, reserved slugs) |
| Edge unit | 96 passed, 2 skipped (push: Expo request, invalid-token disable, fallback, deep-link paths) |
| API unit | 21 |
| App e2e (web build, phone viewport) | **1 flow, 13 steps, passing (~22 s)**: search suggestion → profile; ♡ signed out → sign-in; guest booking with captcha + OTP (attribution `app`); detail → cancel; signed-in booking; Home **Book again with Karim** → preset time step (`rebook` source); past visit → review → photo consent; favorites save/list/remove; inbox → booking; deep links (magic link, removed result, unknown page); offline banner; preferences + log out |
| Web e2e | **15 passed**, 13 skipped (project split). Full run with 2 workers: 12 passed, 3 failed (auth OTP, public booking, results — captcha/cold-server timeouts under parallel load); those 3 specs rerun serially: all pass. No web code changed except the `/captcha` bridge and `.well-known` routes |
| Admin e2e | **1 passed** |
| Lint, typecheck, format, unit, db lint (no new warnings), web + admin + app web builds | ✅ |

## Performance (local, a real e2e customer, 30 runs)

| RPC | p50 | p95 |
|---|---|---|
| `get_rebook_suggestions(3)` (includes next free time per suggestion) | 2.5 ms | 3.8 ms |
| `get_my_notifications(30)` | 0.3 ms | 0.4 ms |
| `get_my_favorites` | 0.2 ms | 0.4 ms |
| `get_unread_notification_count` | 0.2 ms | 0.3 ms |

Search and booking paths are unchanged (M12/M3 numbers stand).

## Bugs found and fixed

- Home crashed on the web build once rails had ≥ 3 cards: `Link asChild` forwards a style **array** to the
  anchor → flattened.
- `expo serve` has no SPA fallback, so deep links 404'd on the web build → test server with fallback.
- react-native-web's `Alert` is a no-op → cancel/leave/delete confirms use `window.confirm` on web.
- Slots were tappable before the captcha token arrived → disabled until ready.
- `get_rebook_suggestions` returned an untyped `'[]'` (plpgsql_check warning) → `'[]'::jsonb`.

## Known limitations / needs your accounts

- No Android SDK/emulator or iOS device here: native-only behavior (WebView captcha, SecureStore, push
  delivery and taps, image picker, universal links) is untested on devices. Maestro flows, EAS builds,
  TestFlight, Play internal testing and store submission need your developer accounts (M4 checklist).
- `extra.eas.projectId` is null until `eas init`; push stays off until then.
- English-first UI (Arabic/RTL follow-up, as on web).
- Hosted M4–M13 verification remains mandatory before real users.

## Decisions needed from you

1. Approve decisions 1–5 above (push replaces WhatsApp for non-booking messages; no web→app session hand-off;
   favorites not in ranking; web build = test harness; no Help link yet).
2. Favorites in the search personal score: keep off (recommended, M12 locked) or add later?
3. Apple Developer + Google Play accounts and `eas init` to unlock device builds, push and store submission.
