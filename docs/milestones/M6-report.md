# M6 — Business dashboard II: calendar & daily operations: report

Status: **closed** (approved 2026-09-28, D1–D11) · merged to `main`

Hosted staging verification is deferred together with M4's and M5's (see the M4 report checklist,
now including the M6 migration and hosted Realtime). It must be completed before any real users or
launch.

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| B3 Calendar | **Day · Columns** (all staff / several / one, chips remembered per device), **Day · Single**, **Week** (one staff member's 7 days: shifts, breaks, time off, bookings), **Agenda** (default on phones). Toolbar: Today, ‹ ›, date picker, view switch, zoom 10/15/30 min, Show cancelled, **Walk-in**, **+ New appointment**. Grid: hatched non-working time, labelled breaks/time off, now line, blocks with status styling, source icon, 📝 note, **New** (first visit), ⚠ some missed appointments, **★ Requested**. Column header: hours summary ("9 AM–7 PM · break 2–3"), booked %, Block. Click an empty slot → B4 prefilled with staff + time; **drag to move** (to another time or colleague) with the notify prompt (mandatory when the customer chose that person); conflicts snap back with "Maya already has an appointment 12:00 PM–12:30 PM"; outside hours → "Move anyway" for desk roles. **Block time** from the grid; tap a block to remove. Keyboard: N, T, ←/→, D/W/L, Esc. **Realtime** refresh + "New booking from APP_NAME: …" toast; offline banner (read-only); "N past appointments not marked · Mark all completed" | Phase 2 B3 |
| B4 Appointment creation | Drawer (full-screen on phones), conversation order Customer → Service → Staff → Time → Save. Smart "Phone or name" field (Lebanese local format, live match with visits, usual staff, reliability) → pick, **New customer: +961 …** (first name required) or **Skip → Walk-in (no details)**. Top-6 service chips by use (customer's favorite preselected), "Adjust for this booking" (duration/price). Staff prefilled from the column, **Any available** or a staff member (busy ones marked), "Usually with Maya". Free-time chips; free typing ("16:30", "4.30", "430"). Note, WhatsApp confirmation toggle, "Already done — mark as completed" for past times. Save button shows the summary ("Save · Lina · Haircut · Karim · 10:00 AM"); Enter picks the first match, Enter on the time saves; **Save & add another**; **Undo** toast. Errors: busy → next free chips; outside hours → "Book outside hours anyway" | Phase 2 B4 |
| B5 Bookings | Tabs Pending (default when non-zero, with count) · Upcoming · Past · Cancelled & no-shows; search (name, phone, booking ref); filters (staff, service, source, dates); inline **Accept / Decline** with expiry countdown; "Mark all completed" on Past; paging (50); row → booking drawer | Phase 2 B5 |
| Booking drawer | Customer (Call / WhatsApp / pinned note / labels), time, staff, status, source, price, ref, notes; **Complete · No-show · Undo no-show · Reschedule · Change staff · Cancel (reason required for online bookings) · Accept / Decline · Edit note**; **event timeline with who did it** | Phase 2 B3 §4.3, B5 |
| B7 Customer detail | Header (phone, Call/WhatsApp, coarse label, customer since, acquired via), stats (visits, lifetime/average spend per role, last visit, favorite service, usual staff, no-shows and cancellations **at this business**), upcoming, notes (add, pin → shows on the calendar, visible-to-staff, delete), history, **New appointment** prefilled, edit name/phone. No reviews | Phase 2 B7 |
| B2 Overview (lean) | Needs attention (pending requests, unmarked past appointments, contested no-shows), tiles (appointments, expected revenue — "~" for from/range prices, owners/managers or reception with the setting —, booked %, cancellations), today's list with Complete / No-show; staff see "My day" | Phase 2 B2 |
| Staff | **Bookings tab** (upcoming / past, all sources) = staff booking history; archiving with upcoming bookings opens the **affected-booking flow**, then archives | Phase 2 B9 |
| Affected-booking flows | One component: per booking **Reassign** (colleagues who perform the service, marked free / busy / outside hours; mandatory notify for requested staff), **Cancel & notify**, **Keep**. Used by Block time, staff schedule changes ("Save, then reassign or cancel each" next to keep / cancel all) and archiving | Phase 2 B9/B12 |
| Database | `biz_get_calendar`, `biz_block_time` / `biz_remove_block`, `biz_reassign_options`, `biz_affected_bookings`, `biz_list_bookings`, `biz_get_booking` (with timeline + actor names), `biz_get_customer`, `biz_find_customers`, `biz_service_usage`, `biz_undo_manual_booking`, `biz_today`; Realtime publication for `booking_items` + `bookings` | Part 3 §4.4, Part 5 §4, Part 6 §3.4 |

Writes still go through the M3 booking RPCs (`create_manual_booking`, `biz_reschedule_booking`,
`reassign_booking_item`, `mark_*`, `accept/decline_request`, `biz_cancel_booking`); no new write
paths to bookings were added except Undo.

## Migration created

| File | Contents |
|---|---|
| `20261002100100_m6_booking_timing.sql` | Gate B creation timing (private table, creator-only logging RPC, ops report) |
| `20261002100000_m6_calendar.sql` | Role-projected read models (calendar, bookings list, booking + timeline, customer detail, today), block time, reassign options, affected bookings, smart-field lookup, service usage, Undo, CRM stats fix, Realtime publication |

## Tests executed

| Layer | Result | What it proves |
|---|---|---|
| pgTAP | **561/561** (63 new: 52 in `240_calendar`, 11 in `250_booking_timing`) | Scope: owner sees all columns; selected staff; **staff only their own column whatever is asked**; cancelled hidden unless asked. Projection: reason on time off only for owner/manager and the staff member; reception phone + price; staff no phone/price/staff-hidden note (phone when the business allows). Pinned note, ★ Requested, coarse label. Range cap; other business refused. Block time: blocks online availability, staff can't block colleagues, removal. Reassign options (performs the service, free, in hours; busy marked; staff refused). Affected bookings window. Bookings list tabs, name + ref search, staff filter, staff forced to own. Timeline actor. Customer detail per role (reception no spend; staff name + upcoming only; NOT_FOUND for out-of-scope and other businesses). Smart field with usual staff. Undo (creator only; not counted against the customer). Today: staff without revenue. Realtime publication |
| E2E web (local stack) | **13 passed** (2 new M6 + 11 earlier) | **Speed targets**: existing customer from a slot click in **4** interactions, new customer in **5** (≤ 6). **Keyboard-only** creation (N → phone → Enter → time → Enter) + **Undo**. **Conflict toast** when dragging onto a busy colleague; drag-to-move; **reassign**; **block time → reassign the affected booking**; **walk-in** (with the outside-hours override when run at night); customer detail + pinned note; **Realtime: a booking made in tab A appears in tab B within 2 s**; staff booking history; bookings search. **Role: staff see only their own column** |
| E2E admin | **1 passed** | Unchanged M4/M5 flows |
| Unit | web 13 (6 new: DST day lengths and labels — Beirut skips 00:00 in March and repeats 23:00 in October —, lanes for overlapping blocks, off-shift hatching, week start, free-typed times) + other packages | |
| Booking harness | 11 passed | M3 engine unaffected |
| Lint, typecheck, format, DB lint, builds | ✅ | |

Manual check in the browser: desktop Day · Columns (hatching, blocked time, markers), booking
drawer with timeline, phone agenda, phone overview (fixed a row that hid the customer name next to
the Complete / No-show actions).

## Deviations for your approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | Part 6 §3.4: Realtime on `booking_items` | Also publishes `bookings` | Completing, no-shows, accepting a request only change `bookings`; other tabs must see them. RLS applies; customer names still never travel (they live in `business_customers`, not published) |
| D2 | M3 CRM stats | `cancel_count` counts only the **customer's** cancellations | B7 shows "cancellations at this business" as customer behavior; salon closures, declines or an Undo shouldn't count against them |
| D3 | B4 "Undo = cancel within 10 s" | `biz_undo_manual_booking`: the person who saved it, within **2 minutes** (toast shows 10 s); logged as a cancellation with `undo`, no notification | Network slack; keeps the audit trail |
| D4 | Part 6 RLS: reception reads time off only | Reception can **block / unblock time** via `biz_block_time` / `biz_remove_block` (reasons stay hidden from reception) | B3 "Block time directly in grid" is a reception task |
| D5 | New | `biz_reassign_options`, `biz_affected_bookings`, `biz_find_customers`, `biz_service_usage`, `biz_today` | Read models for the flows above |
| D6 | B4 for staff | Staff creating in their own column type phone + name (no customer search) | Staff privacy (Part 1 §6.3); the server still reuses an existing record with that phone |
| D7 | B3 mobile swipe / long-press, desktop drag-to-resize | Not built: ‹ › buttons, tap → drawer (Reschedule there); resize stays SOON | Scope; drag-to-move works with mouse/pen on desktop and tablet |
| D8 | Notifications | "Notify" choices are recorded on booking events; sending is M7 | M7 owns messaging (as M5 D10) |
| D9 | B3 "Updated by Reception" on stale blocks | Realtime refresh + timeline with actor instead of a per-block badge | Simpler; same accountability |
| D10 | B2 | "Reviews to reply" / "Recent reviews" → M9; "WhatsApp alerts failing" → M7 | Depend on those milestones |
| D11 | Tooling | Local test numbers `70 000 009`/`010`; CI starts Realtime | Role e2e + Realtime test |

## Known gaps / notes

- **Gate B (pilot) is external**: 3–5 salons in one cluster for 2 weeks, ≥ 80% of appointments in
  the calendar, top-10 friction fixes.
- Hosted staging verification of M4 + M5 + M6 is deferred (see the M4 checklist).

## Suggested manual checks

1. Log a phone booking from a slot on a tablet: does 4 taps feel right for a regular customer?
2. Drag a booking to a colleague who was specifically requested: is the mandatory-notify wording right?
3. Block an hour over existing bookings: is Reassign / Cancel & notify / Keep the right set of choices?
4. On a phone, is the Agenda + staff chips enough, or do you want the one-column day grid as default?

## Approval follow-up: Gate B creation timing (added before merge)

Measures the pilot target "median appointment creation < 15 s in real use".

- The drawer measures **opened → saved** on the device's monotonic clock and, after a successful
  save, calls `biz_log_booking_timing(booking, duration_ms, customer_kind, flow)`. "Save & add
  another" restarts the clock.
- Stored in `private.booking_creation_timings` (not readable by business members): booking id,
  business id, actor role, customer kind (`existing` / `new` / `walk_in`), flow (`slot`, `button`,
  `keyboard`, `walk_in`, `customer_page`, `add_another`), booking source, opened/saved timestamps,
  duration. `saved_at` is the booking's server timestamp; `opened_at` is derived from the duration,
  so device clock skew doesn't matter. **No customer name, phone, notes or free text.**
- Only the person who created the manual booking / walk-in can log it, within 10 minutes, once.
- Report for ops (aal2): `admin_booking_timing_stats(from, to, business)` → bookings, median / p75 /
  p90 seconds per business, and per role × customer kind.
- Tests: pgTAP `250_booking_timing` (creator only, first report wins, validation, raw table not
  readable, server-stamped times, column list has no customer data, ops-only report); the calendar
  e2e checks that its real saves record `existing/slot`, `new/slot`, `existing/keyboard` and a
  walk-in, all as reception.

Kept as decided at approval: Agenda default on phones with Day · Single available; reception may
block/unblock time; staff get no broad customer search; customer-caused cancellations only in CRM
stats; mobile swipe / long-press / drag-resize deferred; notification choices recorded now, sending
in M7. Hosted M4–M6 staging verification remains a mandatory pre-real-user gate.
