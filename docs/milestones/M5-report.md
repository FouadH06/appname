# M5 — Business dashboard I: onboarding & setup: report

Status: **closed** (approved 2026-09-28, D1–D10) · merged to `main`

Hosted staging verification is deferred together with M4's (staging still runs the M3 schema; see
the M4 report checklist). It must be completed before any real users or launch.

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| App shell | Role-aware navigation: sidebar ≥1024 px, icon rail 768–1023, mobile bottom bar (Today · Calendar · ＋ · Customers · More); business switcher; Ctrl+K command palette (sections + customer search) | Phase 2 §8.4 |
| B1 onboarding wizard | Basics (name, slug with live check and suggestions, serves, description, Instagram) → Location (area, address, landmark, phones, **draggable map pin**, "use my location") → Hours (split shifts, copy to all) → Services (**templates from the category catalog**, price + duration per row) → Team (add member, "I also take appointments") → Photos (cover + up to 10 portfolio) → Booking rules → **Preview & go live** (server checklist, phone preview) → Share kit. Assisted (ops) and owner modes | Phase 2 B1 |
| B8 Services | List with online toggle, archive/restore, "no one performs it" warning; editor with **required catalog mapping** (+ "Other" → catalog suggestion for ops), fixed/from/range/on consultation, duration, buffers, audience, who performs it | Phase 2 B8 |
| B9 Staff | List, add; detail tabs: **Profile** (photo, title, bio, publicly bookable / auto-assignment toggles with the invalid combination prevented, priority, archive/restore), **Services** (per-staff duration/price overrides, up to 3 specialties), **Schedule** (weekly hours with breaks, date overrides, time off with private reason, **conflict check with keep / cancel-and-notify**, 2-week preview), **Access** (phone-bound invite, revoke) | Phase 2 B9 |
| B12 Settings | Profile, photos, location & hours, **closures with the affected-bookings flow**, booking rules (all rule fields), team & roles, share kit (link, **QR code, printable A4 poster**, Instagram bio steps, WhatsApp auto-reply), danger zone (owner: pause online bookings, transfer ownership) | Phase 2 B12 |
| B6 Customers (basic) | Server search (name, phone digits, Lebanese local format), sort, paging, add customer with duplicate detection ("Already a customer: … → Open"); columns projected by role | Phase 2 B6 |
| A4 (minimal admin) | Create business (draft) from name, link, category, area, address, pin (coordinates or a pasted Google Maps link), phones → owner invite (link + WhatsApp share) → open the wizard | Phase 2 A4 |
| Database | `admin_create_business`, `check_slug`, `change_business_slug`, `get_go_live_checklist`, `publish_business`, `pause_online_booking`, `archive_staff`/`restore_staff`, `create_my_staff_profile`; `media_assets` + `business_media` + public `business-media` bucket (folder-per-business policies), `register/remove/reorder_business_media`; `biz_search_customers`, `biz_upsert_customer`, `biz_add/update/delete_note`; `list_members`; `lat`/`lng` computed columns | Part 6 §3.3, Part 4 §2, Part 5 §4 |

## Migrations created

| File | Contents |
|---|---|
| `20261001100000_m5_business_setup.sql` | Assisted create (+ owner-joined trigger), slugs, checklist, publish, pause, staff lifecycle |
| `20261001100100_m5_business_media.sql` | Media tables, bucket and storage policies, media RPCs |
| `20261001100200_m5_crm_rpcs.sql` | Customer search / upsert / notes |
| `20261001100300_m5_team_location.sql` | Team projection, map-pin coordinates |

## Tests executed

| Layer | Result | What it proves |
|---|---|---|
| pgTAP | **498/498** (69 new) | `210_business_setup` (37): ops-only + MFA create, pin in Lebanon, reserved/taken slugs, wizard writes under RLS, checklist → blocked publish → go live → public availability, owner claim ends the ops helper membership, slug check/change + redirects, reception can't edit services, pause (profile stays live), archive blocked by future bookings. `220_business_media` (14): folder rules, one cover, 10-photo cap, reorder, staff photo, removal, isolation. `230_crm` (18): search forms, role projection (reception spend setting, staff only own upcoming customers), duplicates, notes, isolation |
| E2E web (local stack) | **11 passed** (5 M4 auth + 2 M5 + 4 foundation) | **Owner mode end to end**: claim invite → basics → location (map) → hours → services from templates → "I also take appointments" → cover upload → rules → go live → share kit; **public availability matches on 3 spot-checked days**; the **schedule editor** changes availability to exactly 10:00–11:30. **Roles**: reception has Customers/Staff, no Services/Settings, and the services page refuses edits |
| E2E admin | **1 passed** | MFA flow + **assisted mode**: ops creates a draft business, gets the owner invite, and is its temporary manager |
| Unit | web 7 (Beirut time/DST conversions, conflict detection, hours validation), admin 5 (pin parsing), + earlier packages | |
| Booking harness (CI sizes) | ✅ | M3 engine unaffected |
| Lint, typecheck, format, builds | ✅ | Both apps build without env |

Manual check in the browser: desktop shell, settings with the live map, mobile layout with bottom navigation.

## Deviations for your approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | Plan: media in M10 | `media_assets` + `business_media` + bucket created now, as specified; business photos publish immediately, the async safety check stays in M10 | Go-live needs a cover photo |
| D2 | Phase 2 B1/A4 (assisted onboarding) | `admin_create_business` makes ops a **temporary manager**; revoked automatically when the owner's membership becomes active | The wizard writes under the same RLS as owners; no admin bypass paths |
| D3 | Part 6 (`pause_online_booking`) | Toggles `allow_online_booking` (owner only); the business stays `live` | Phase 2 B12: a paused business keeps its profile and contact buttons |
| D4 | Phase 2 go-live minimum | Checked in the database (`get_go_live_checklist`): location, hours, priced online service with a performer, staff hours, cover. "Booking rules accepted" is the wizard step, not a DB flag | One source of truth for UI and publish |
| D5 | New | `list_members` (team names without exposing profiles), `lat`/`lng` computed columns | Profiles are private; PostGIS points need readable coordinates |
| D6 | Phase 2 `MapPinPicker` | Leaflet + OpenStreetMap tiles in the dashboard; admin pastes coordinates / a Google Maps link | Lightweight; production traffic may need a tile provider (to decide before launch) |
| D7 | i18n | Dashboard copy is English in code (customer-facing and error copy stays in the catalogs) | English UI at launch; extraction for the Arabic UI (Soon) is follow-up work |
| D8 | Scope | Customer detail (B7), staff Bookings tab, reassign flows, notification settings → M6/M7 | Belong with the calendar and messaging |
| D9 | Share kit | QR poster via the browser's print → PDF; story template image and Google Business guide deferred (Soon) | No server-side PDF needed |
| D10 | Invites | Sent with a WhatsApp share link (wa.me) until automatic sending in M7 | M7 owns messaging |

## Known gaps / notes

- DoD "ops can onboard a real salon in ≤ 20 minutes on a phone" needs a real run with a salon; the automated walk-through takes ~10 s.
- Hosted staging verification of M4 + M5 is deferred (see the M4 checklist).

## Suggested manual checks

1. Run the wizard on your phone for a test business (local Round 1 setup): does each step feel fast enough to hit 20 minutes with a real salon?
2. Are the go-live requirements right (cover photo mandatory, at least one priced online service)?
3. Default hours when you tap "Open": 9:00–13:00; do you prefer a full-day default (e.g. 9:00–19:00)?

## Approval adjustments (applied before merge)

- "Open" on a day now defaults to **9:00–19:00** (still editable); "+ Shift" unchanged.
- "I also take appointments" / "I work alone — add myself" never creates a "Me" profile: if the
  person's profile has no name, it asks for first/last name, saves it to their profile, and uses it
  for the staff profile. `create_my_staff_profile` rejects blank names (`NAME_REQUIRED`, pgTAP).
- Kept as decided: cover photo and a priced, online-bookable service with a performer are required
  to go live; assisted onboarding's temporary ops manager access ends when the owner accepts;
  pausing online booking keeps the profile visible; OpenStreetMap tiles for now (production tile
  provider is a pre-launch decision); dashboard English-first but RTL/i18n-ready.
- Hosted M4 + M5 staging verification remains a mandatory pre-real-user / pre-launch gate.
