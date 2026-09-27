# Phase 2 · Part 3 — Business Dashboard

Legend: **[MUST]** · **[SOON]** · **[LATER]**. Devices: **D** desktop ≥1024 · **T** reception tablet · **M** owner/staff phone.
Roles: **Owner**, **Manager**, **Reception**, **Staff** (Part 1 §8.4).

**The daily-use test:** every design choice here is judged by "does this make the calendar faster than the notebook?" If reception can't log a phone booking in ~10 seconds, the business goes back to paper and our availability data dies.

---

## B1. Onboarding — **[MUST]** (assisted) · **[SOON]** (fully self-serve)

At launch, APP_NAME ops onboards each business in person (Admin → Create business, A4), then the owner **claims** it. The same wizard serves self-serve later.

1. **Purpose:** Get a business live with a bookable, trustworthy profile in one sitting (≤20 min assisted), and hand them their booking link.
2. **User goal (owner):** "Make this work without eating my day, and show me how customers will book."
3. **Hierarchy:** progress → current step → live preview → go-live checklist.
4. **Sections (wizard steps):**
   1. **Claim / Sign in:** owner opens WhatsApp invite link → phone OTP → sets name → accepts business terms.
   2. **Basics:** business name, slug (auto from name, editable, availability check), primary category + additional, serves (Women / Men / Everyone), short description (optional).
   3. **Location:** area (cluster list), street/building, floor, landmark, map pin (drag), phone, WhatsApp number (default = phone), Instagram handle.
   4. **Hours:** weekly grid with copy-to-all; split shifts (lunch closure); closed days.
   5. **Services:** **start from templates** — choose canonical services for the category (checkbox list: Haircut, Beard trim, Hair + Beard…) → each prefilled with typical duration; enter price (fixed/from/range) → editable name. Target: 10 services in ~3 minutes.
   6. **Team:** add staff (name, role title, photo optional); owner can be a staff member ("I also take appointments"); assign services (default: all); hours default = business hours.
   7. **Photos:** cover (required), up to 10 portfolio (optional; ops can upload from phone on-site).
   8. **Booking rules:** Instant booking (default) vs Approve each request; minimum notice (default 1h); how far ahead (default 30 days); cancellation window (default 2h); who receives new-booking WhatsApp alerts.
   9. **Preview & Go live:** mobile preview of C1; checklist; **Go live**.
   10. **Share kit (after go-live):** booking link (copy), QR poster (PDF A4/A5 for the counter), Instagram bio instructions, story template image, "Add to Google Business Profile" guide, WhatsApp auto-reply text suggestion ("Book directly: platform.com/fade-district").
5. **Components:** `WizardProgress`, `SlugField`, `AreaPicker`, `MapPinPicker`, `HoursGrid`, `ServiceTemplatePicker`, `StaffQuickAdd`, `PhotoUploader`, `ChecklistCard`, `PhonePreviewFrame`, `ShareKit`.
6. **Main CTA:** **Continue** per step → **Go live**.
7. **Secondary:** save & exit (resume later), skip optional steps, preview.
8. **Empty:** each step starts with smart defaults (templates, business hours) — never a blank form.
9. **Loading:** per-step save indicator ("Saved"); preview skeleton.
10. **Errors:** slug taken/reserved → suggestions; map pin outside Lebanon → warning; go-live blocked → checklist shows missing items with jump links.
11. **Mobile (M):** fully usable on phone (owners often do it on phone); one step per screen.
12. **Desktop:** steps left rail, form center, live preview right.
13. **Edge cases:** business already exists (duplicate by phone/name+area) → route to claim/admin; owner is not the one onboarding (manager) → owner invite sent separately; staff who don't want to be listed publicly → "Publicly bookable" OFF (internal-only; still fully usable in the dashboard); business wants only request mode; no photos available → go live allowed with cover only (ops policy: cover required, see checklist).
    - **Go-live minimum:** name, category, area + pin, hours, ≥1 online-bookable service with price, ≥1 staff with hours, cover photo, booking rules accepted.
14. **Scope:** MUST: steps 1–10 (assisted). SOON: self-serve signup from marketing site, import services from a photo of a price list (AI) [LATER], Google Business Profile booking link integration [LATER].

---

## B2. Overview — **[MUST]** (lean) · "Today" on mobile

1. **Purpose:** Morning glance: what's happening today and what needs attention.
2. **User goal:** "What do I need to deal with right now?"
3. **Hierarchy:** needs attention → today's schedule → today's numbers → recent reviews.
4. **Sections:**
   1. **Needs attention** (only shown items with count >0): Pending requests (n) · Reviews to reply (n) · Contested no-shows (n) · Tomorrow unconfirmed (n) [SOON] · WhatsApp alerts failing (config issue).
   2. **Today:** timeline list of today's appointments (time, customer, service, staff, status, source icon); next appointment highlighted; quick actions per row (Complete, No-show, Open).
   3. **KPI tiles (today):** Appointments · Expected revenue (sum of price snapshots, "~" if "from" prices) · Utilization (booked minutes / available staff minutes) · Cancellations. Each with delta vs same weekday last week [SOON].
   4. **Recent reviews:** last 3 with Reply.
   5. **Insights** [LATER]: "Tomorrow afternoon has 7 empty slots".
5. **Components:** `AttentionItem`, `AppointmentRow`, `KpiTile`, `ReviewCard` (compact).
6. **Main CTA:** **+ New appointment** (global) / act on attention items.
7. **Secondary:** open calendar, open bookings, reply review.
8. **Empty:** new business, no bookings → "No appointments today. Share your booking link to get your first online booking" + Copy link + QR poster. Attention empty → section hidden.
9. **Loading:** standard; realtime subscription keeps Today list live.
10. **Errors:** standard per section.
11. **Mobile:** **Today** tab: attention chips → today list → tiles (2×2). Staff role sees "My day" only (their appointments, no revenue).
12. **Desktop:** attention + today list left (2/3), tiles + reviews right (1/3).
13. **Edge cases:** multiple staff with different hours → utilization computed per scheduled minutes; business closed today → "Closed today" + tomorrow preview; Reception role sees no revenue tile (setting).
14. **Scope:** MUST: attention, today list, 4 tiles, recent reviews. SOON: deltas, tomorrow unconfirmed. LATER: insights, AI summary.

---

## B3. Calendar — **[MUST]** (most important business screen)

1. **Purpose:** The live source of truth for who's doing what, when — fast enough to replace the notebook.
2. **User goal:** See the day, add/move bookings instantly, handle walk-ins and changes.
3. **Hierarchy:** date & view controls → staff columns → time grid with appointments → quick actions.
4. **Sections:**
   1. **Toolbar:** Today · ‹ › · date picker · **staff scope** (All staff · pick several · one staff member; remembered per device) · view switch · "Show cancelled" toggle · **+ New appointment** · **Walk-in** button.
      - **Views:**
        - **Day · Columns** (default on desktop/tablet): one column per staff member in scope. All staff together, or only the selected ones.
        - **Day · Single staff:** one staff member's day at full width.
        - **Week · Single staff:** 7 day-columns for one staff member. This is their personal calendar: shifts, breaks, time off, bookings.
        - **Agenda:** chronological list merging all staff in scope, with a staff avatar on each row. Default on phones.
      - Each staff column header shows avatar, name, today's hours ("10:00–7:00 · break 2–3"), booked %, and a menu with Edit schedule for today, Add time off and Open staff.
   2. **Grid:** 15-min rows (configurable 10/15/30 zoom), business hours band, non-working time hatched per staff, breaks/time-off blocks labeled, **NowLine**, appointment blocks (customer name, service, time; status styling; source icon; note indicator 📝; first-visit indicator "New"; reliability icon if "Some missed appointments").
   3. **Appointment popover** (click block): customer (name, phone with Call/WhatsApp), service, staff, time, status, note, source; actions **Complete · No-show · Reschedule · Cancel · Edit · Open customer**.
   4. **Blocked time:** create "Block time" (break, personal, training) directly in grid.
5. **Components:** `CalendarGrid`, `StaffColumnHeader` (avatar, name, today's booked %), `AppointmentBlock`, `AppointmentPopover`, `NowLine`, `BlockTimeDialog`, `DatePicker`.
6. **Main CTA:** click/tap empty slot → **Appointment Creation (B4)** prefilled with staff + time.
7. **Secondary:** drag-to-move (D/T), drag-to-resize duration (D) [SOON], status actions, block time, print day sheet [LATER].
8. **Empty:** day with no bookings shows the empty grid (that's correct) + subtle hint "Click any time to add an appointment". No staff yet → "Add your team to start using the calendar" → Staff.
9. **Loading:** grid frame renders immediately; blocks fade in; switching days prefetches ±1 day; realtime updates stream in (new online booking appears with a brief highlight + toast "New booking from APP_NAME: Moe · 4:30 PM").
10. **Errors:**
    - Move/create conflicts (exclusion constraint) → block snaps back; toast "Karim already has an appointment 4:00–4:30".
    - Stale data (someone else moved it) → refresh block + "Updated by Reception".
    - Offline → banner, grid read-only.
11. **Mobile (M):** default **List/agenda** of the day for one staff (staff switcher chips on top); horizontal swipe between days; tap time gap → create; long-press block → actions. Day grid available but one staff column at a time.
12. **Desktop/Tablet:** Day view with all staff columns side-by-side (horizontal scroll if >6 staff); keyboard: `N` new, `T` today, `←/→` day, `D/W/L` views, `Esc` close.
13. **Edge cases:**
    - **Moving a booking** asks: "Notify {customer} on WhatsApp?" (default ON for online bookings, OFF for manual) → customer gets reschedule message with manage link.
    - Moving an online booking to a different staff member → allowed. If the customer **specifically chose** that person (`selection_mode = specific/rebook`), a warning appears: "Moe chose Karim. They'll be notified of the change." Notification is mandatory. For Any-mode bookings, notification is optional (default OFF).
    - Block badge "★ Requested" on bookings where the customer chose that staff member specifically. Reception can see at a glance who can safely be reassigned.
    - Overlap needed (color processing, two clients at once) → MVP: not allowed except via service processing segments [SOON]; manager override "Allow overlap" [SOON] (partial exclusion constraint excludes flagged bookings; still audited).
    - Appointment outside staff hours → allowed for manual bookings with warning banner in dialog; never offered online.
    - Past appointments not marked → at day end (or next morning) prompt "3 appointments from yesterday aren't marked" → bulk **Mark all completed**; auto-complete runs at end + 6h anyway.
    - Staff-role user sees only own column; can't move others' bookings.
    - DST day shows the missing/repeated hour correctly.
    - Very long services (bridal 3h) render correctly across rows; tiny services (10 min) show compact text with popover.
14. **Scope:** MUST: staff scope (all / several / one), Day · Columns, Day · Single staff, Week · Single staff, Agenda, "★ Requested" marker, create from slot, drag move, status actions, block time, realtime, walk-in. SOON: resize, overlap override, processing segments, per-staff colors. LATER: resources rows (rooms/machines), print, multi-location switcher.

---

## B4. Appointment Creation — **[MUST]** (speed-critical)

Opened from: + button, `N` shortcut, empty calendar slot, customer detail, walk-in button. Desktop: right **drawer** (calendar stays visible). Mobile: full-screen sheet.

1. **Purpose:** Log a phone/WhatsApp/walk-in booking in seconds.
2. **User goal (reception):** Customer on the phone — get it in before they hang up.
3. **Hierarchy (field order = conversation order):** **Customer → Service → Staff → Time → Save.**
4. **Sections:**
   1. **Customer:** single smart field "Phone or name". Typing digits → normalizes +961 and live-matches existing customers of *this business*; typing letters → name search. Pick existing (shows visits count, last visit, reliability label) or "New customer: +961 70 123 456" → name field appears (first name required, last name optional). **Skip → "Walk-in (no details)"** allowed.
   2. **Service:** type-ahead; top 6 most-booked shown as chips for one-tap; duration + price shown; editable price/duration for this booking (overrides snapshot).
   3. **Staff:** prefilled from the clicked column. Otherwise, **Any available** (assigned by the business rule, the same logic as online) or a picker showing only staff who perform the service, with busy ones marked. If the customer has a preferred staff member (most visits), they're suggested: "Usually with Maya". The staff member's duration and price overrides apply automatically. A concrete staff member is always stored.
   4. **Date & time:** prefilled from clicked slot; otherwise today; chips for next free times of chosen staff; free-typing a time allowed ("16:30", "4.30").
   5. **Note** (optional, internal).
   6. **Send confirmation on WhatsApp** toggle (default ON when phone present; message includes manage link which also enables later review/claim).
5. **Components:** `CustomerSmartField`, `ServiceQuickPicker`, `StaffPicker`, `TimeQuickPicker`, `Toggle`, `Drawer`.
6. **Main CTA:** **Save** (Enter key). Button shows summary: "Save · Moe · Haircut · Karim · 4:30 PM".
7. **Secondary:** "Save & add another" (for customer booking two services/people), add note, cancel (Esc).
8. **Empty:** first time → fields with helper text; no services configured → link to Services.
9. **Loading:** customer search results in <200ms (indexed on business_id + phone/name trigram); save inline spinner; drawer closes on success with toast "Saved · Undo" (Undo = cancel within 10s, logs event).
10. **Errors:** conflict → inline under time: "Karim is busy 4:00–4:30 · Next free 4:30, 5:15" (chips); invalid phone → inline; customer blocked from online booking → warning only (manual allowed).
11. **Mobile:** big fields, service chips, numeric keypad for phone, time chips; Save pinned bottom.
12. **Desktop:** drawer 420px; full keyboard flow (Tab moves field to field, Enter selects first match, Enter on last field saves).
13. **Edge cases:**
    - Phone matches a platform user → linked silently; business sees only what's in its own CBP (never platform profile data).
    - Same customer already booked at overlapping time → warning.
    - **Walk-in now:** start = now (rounded), staff = selected/first free, status = Confirmed (becomes Completed later); customer optional.
    - Booking in the past today (logging after the fact) → allowed, status auto "Completed" option.
    - Manual booking for a service not online-bookable → allowed.
    - Business-created bookings count as **Verified Visit** candidates only if the customer later OTP-verifies the phone.
    - Recurring appointments ("every 3 weeks") [LATER].
14. **Scope:** MUST all above. **Speed target (acceptance criterion):** from calendar slot click to saved, existing customer, ≤ 4 interactions / ≤ 10 s; new customer ≤ 6 interactions / ≤ 15 s. SOON: multi-service in one appointment. LATER: recurring, group bookings.

---

## B5. Bookings — **[MUST]**

1. **Purpose:** Searchable, filterable list of all bookings; the place to handle requests and fix history.
2. **User goal:** Find a booking; process pending requests; review cancellations/no-shows.
3. **Hierarchy:** tabs (Pending first when non-zero) → filters → table.
4. **Sections:** tabs **Pending (n) · Upcoming · Past · Cancelled & no-shows**; filters (date range, staff, service, source, status); search (customer name/phone, booking ref); table columns: Date/time · Customer · Service · Staff · Price · Source · Status · Actions. Pending rows: **Accept / Decline** inline with expiry countdown ("expires in 2h 14m").
5. **Components:** `Tabs`, `FilterBar`, `DataTable`, `StatusPill`, `SourceIcon`, `DeclineSheet` (reason + optional suggested time [SOON]).
6. **Main CTA:** **Accept** on pending; row click → booking drawer (same as calendar popover, expanded with event timeline).
7. **Secondary:** bulk mark completed (past), export CSV [SOON], filter by source (useful to see marketplace vs own customers).
8. **Empty:** Pending: "No requests waiting." Upcoming: "No upcoming bookings" + share link.
9. **Loading:** table skeleton rows; server-side pagination (50).
10. **Errors:** accept fails because slot conflicts now (a manual booking was added) → "This time is no longer free" → decline with suggestion.
11. **Mobile:** cards instead of table; Pending as default tab when non-zero; swipe actions Accept/Decline.
12. **Desktop:** table with sticky header, row drawer on right.
13. **Edge cases:** request auto-expired → moved to Cancelled with "Expired (no response)" — counts against responsiveness score; declined requests notify customer with reason; booking event timeline shows all changes with actor (who at the business did what) for accountability.
14. **Scope:** MUST: tabs, filters, table, accept/decline, drawer with timeline. SOON: CSV export, decline-with-suggestion. LATER: bulk messaging.

---

## B6. Customers — **[MUST]** (basic CRM)

1. **Purpose:** The business's own client list — including people who never used the app.
2. **User goal:** Find a customer; see who's loyal, who's gone quiet.
3. **Hierarchy:** search → segments → list.
4. **Sections:** search (name/phone); quick segments [SOON]: All · New (first visit ≤30d) · Regulars (≥4 visits) · Haven't returned 60d+; table: Name · Phone · Visits · Last visit · Lifetime spend · Preferred staff · Reliability label · Acquired via (APP_NAME / Own link / Added manually); **+ Add customer**; **Import** [SOON] (CSV / phone contacts).
5. **Components:** `SearchInput`, `SegmentChips`, `DataTable`, `ReliabilityLabel`, `AcquiredViaTag`.
6. **Main CTA:** row → Customer Detail (B7).
7. **Secondary:** add customer, new appointment for customer (row action), call/WhatsApp.
8. **Empty:** "Customers appear here after their first booking — online or added by you." + Add customer + Import [SOON].
9. **Loading:** skeleton; server-side search and pagination.
10. **Errors:** duplicate phone on add → "Already a customer: Moe Haddad" → open.
11. **Mobile:** list with name, last visit, visits; search at top.
12. **Desktop:** full table with sort by any column.
13. **Edge cases:** merged duplicates (same person, two phones) [LATER]; deleted platform account → shows "Deleted customer" if data was platform-sourced; customer data visible to Staff role limited to name + upcoming visits + notes flagged "visible to staff" (no spend, no phone) — configurable [SOON].
14. **Scope:** MUST: list, search, sort, add. SOON: segments, import, staff visibility settings. LATER: tags, campaigns, merge.

---

## B7. Customer Detail — **[MUST]**

1. **Purpose:** Everything this business knows about one customer, to serve them better.
2. **User goal:** "Who is this, what do they usually get, anything to know?"
3. **Hierarchy:** identity + contact → key stats → upcoming → notes → history.
4. **Sections:** header: name, phone (Call · WhatsApp buttons), reliability label (**New Customer · Reliable · Some Missed Appointments** — cross-platform coarse only; tooltip "Based on recent booking behavior on APP_NAME"), customer since, acquired via; **stats:** visits · lifetime spend · average spend · last visit (days ago) · favorite service · preferred staff · no-shows **at this business** · cancellations **at this business**; **upcoming bookings**; **notes** (private to business; author + date; pin important note, e.g., "Allergic to ammonia dyes" — pinned note shows on calendar popover); **history** (all bookings at this business with service, staff, price, status).
5. **Components:** `CustomerHeader`, `StatGrid`, `ReliabilityLabel`, `NoteList`, `BookingHistoryList`.
6. **Main CTA:** **New appointment** (prefilled customer).
7. **Secondary:** edit name, add note, call/WhatsApp, block from online booking [SOON].
8. **Empty:** no history (added manually, never booked) → "No visits yet".
9. **Loading:** standard.
10. **Errors:** standard; forbidden if customer belongs to another business (never reveal existence).
11. **Mobile:** stacked sections; Call/WhatsApp sticky at bottom.
12. **Desktop:** two columns — stats + notes left, history right.
13. **Edge cases:** **no reviews shown here** (anti-retaliation, locked decision); customer's platform name differs from what reception typed → business sees its own entered name (CBP-owned) with no platform override; phone changed by customer on platform → CBP keeps old phone (business-owned record) unless customer rebooks.
14. **Scope:** MUST all above. SOON: block from online booking, staff-visible notes. LATER: tags, birthday, formula/color history templates, consent forms.

---

## B8. Services — **[MUST]**

1. **Purpose:** Manage the menu customers book from, mapped to canonical services for search.
2. **User goal:** Add/edit services, prices, durations quickly.
3. **Hierarchy:** groups → services → edit drawer.
4. **Sections:** grouped list (drag to reorder groups and services); each row: name, duration, price display, staff count, online bookable toggle, "Popular" auto-tag; **+ Add service** → drawer: **What service is this?** (canonical search: "Balayage" — required mapping, explains "Helps customers find you"), display name, description, price type (Fixed / From / Range / On consultation) + amount(s), duration, buffer before/after (advanced), who performs it (staff checklist with optional per-staff price/duration override), online bookable, for (Women/Men/Everyone), photo [SOON]; combos: "This is a combo" → pick included canonical services.
5. **Components:** `SortableList`, `ServiceDrawer`, `CanonicalServicePicker`, `PriceInput`, `DurationInput`, `StaffChecklist`.
6. **Main CTA:** **+ Add service**.
7. **Secondary:** duplicate, archive (never hard delete — history references it), reorder, toggle online.
8. **Empty:** "Add your services — start from common ones" → template picker (same as onboarding).
9. **Loading:** standard.
10. **Errors:** no canonical mapping → can't save ("Pick the closest match; can't find it? Choose 'Other' and we'll review" → creates catalog suggestion for admin); price missing for fixed → inline; no staff assigned + online bookable → warning "Customers won't see times for this service".
11. **Mobile:** list + full-screen edit.
12. **Desktop:** list with right drawer.
13. **Edge cases:** price change doesn't affect existing bookings (snapshots); archiving a service with future bookings → allowed, bookings stay; duration change with future bookings → only affects new bookings; "Other" canonical mapping pending review still bookable but less searchable.
14. **Scope:** MUST all above except photos. SOON: service photos, processing time segments. LATER: add-ons/options, packages, seasonal pricing.

---

## B9. Staff — **[MUST]**

1. **Purpose:** Manage team profiles, what they do, when they work, and their access.
2. **User goal:** Keep schedules accurate so online availability is right.
3. **Hierarchy:** staff list → staff detail tabs.
4. **Sections:**
   - **List:** avatar, name, role title, services count, this week's hours, access level, public/hidden.
   - **Detail tabs:**
     1. **Profile:** photo, name, role/title ("Senior Hair Stylist"), bio (short), gender (optional; used for customer filter [SOON]), **specialties** (pick up to 3 from services they perform), **Publicly bookable** toggle (`publicly_bookable`: ON = customers can see and choose this person online; OFF = internal-only — works normally in calendar, manual booking, schedules and analytics but never appears in any customer-facing response), **Accept automatic assignment** toggle (default ON; OFF = bookable only when a customer chooses them, e.g. the owner or a senior colorist), **assignment priority** (drag order, used by the Priority rule), locations they work at (MVP: the single location; multi-branch [LATER]).
     2. **Services:** checklist of services this person performs + per-service **duration override** and **price override** (fixed/from/range). Unchecked services never show this person as an option or produce availability.
     3. **Schedule (their own calendar):**
        - **Weekly hours:** per weekday, one or more intervals. The gap between intervals is shown and labeled as a **break** ("Lunch 2:00–3:00"). No intervals = **day off**.
        - **Date overrides:** "Sunday 12 Oct: working 10:00–4:00" / "Tuesday 14 Oct: off".
        - **Time off:** date-time ranges (vacation, sick, personal, training) with a private reason.
        - **Visual preview:** the next 2 weeks with shifts, breaks, time off and current bookings, so the owner sees the effect before saving.
        - Shortcut: "Open in calendar" → Week · Single staff view.
     4. **Bookings:** this person's upcoming and past bookings (filterable), with "★ Requested" markers.
     5. **Access:** invite to log in (phone → WhatsApp invite) with role (Staff / Reception / Manager); revoke access. Staff role sees their own calendar and schedule and can request time off (owner approves) [SOON].
     6. **Performance** (Owner/Manager only): bookings, revenue, utilization, rating (from reviews of bookings they performed), % of bookings where they were **specifically requested** (a loyalty indicator), rebook-with-same-staff rate [SOON], number of customers who favorited them [SOON].
5. **Components:** `StaffList`, `Tabs`, `ShiftEditor`, `TimeOffDialog`, `RoleSelect`, `InviteDialog`.
6. **Main CTA:** **+ Add team member**.
7. **Secondary:** add time off, invite, archive staff.
8. **Empty:** "Add your team so customers can pick who they book with" (+ "I work alone — add myself").
9. **Loading:** standard.
10. **Errors:** time off overlapping existing bookings → "Karim has 3 bookings during this time" → options: keep bookings / reassign [SOON] / cancel and notify customers (explicit ConfirmSheet listing them); shift change removing hours with bookings → same handling.
11. **Mobile:** list + tabbed detail; schedule editor as per-day rows.
12. **Desktop:** list left, detail right.
13. **Edge cases:** staff leaves → **Archive** (not delete): future bookings must be reassigned or cancelled first; past reviews and results keep "former team member"; staff without phone/login is fine; one person staff at multiple businesses [LATER].
14. **Scope:** MUST: profile (incl. specialties, auto-assignment toggle, priority), services with duration/price overrides, schedule (weekly hours, breaks, days off, date overrides, time off), bookings tab, access. SOON: performance tab, gender, reassign flow, staff time-off requests. LATER: commissions, payroll reports, multi-location staff schedules, portable staff profiles.

---

## B10. Reviews — **[MUST]**

1. **Purpose:** Read, respond, report — and understand reputation — without the power to delete.
2. **User goal:** Reply fast, flag abuse, feature great results.
3. **Hierarchy:** summary → needs-reply queue → all reviews.
4. **Sections:**
   1. **Summary:** rating (display mean), verified review count, `DimensionBars`, trend last 90 days [SOON], response rate.
   2. **Tabs:** **Needs reply (n) · All · Reported**; filters: stars, service, staff, with photos, trust tier.
   3. **ReviewCard (business variant):** trust mark, customer display name, service, staff, visit date, ratings, text (with Translate), photos (each with **Feature** toggle), actions **Reply**, **Report**.
   4. **Reply composer:** text, guidelines hint ("Replies are public. Be specific and polite."), post; edit reply later; replies are moderated (same text pipeline).
   5. **Report sheet:** reasons (Customer never attended · Abusive language · Personal information · Unrelated image · Spam · Fake review · False information · Other) + detail + which part (text / specific photo / whole review). Status afterward: "Under review" chip; outcome shown when resolved.
   6. **Persistent notice:** "Reviews can't be removed by businesses. If a review breaks our rules, report it and our team will check it."
5. **Components:** `RatingSummary`, `ReviewCard`, `ReplyComposer`, `ReportSheet`, `FeatureToggle`.
6. **Main CTA:** **Reply**.
7. **Secondary:** report, feature photo, translate, filter.
8. **Empty:** "No reviews yet. Customers can review after completed visits — mark appointments as completed to invite reviews."
9. **Loading:** standard.
10. **Errors:** reply rejected by moderation → inline "Your reply couldn't be posted: it includes personal information about the customer." Report limit reached (anti-abuse: e.g., 10 open reports) → message.
11. **Mobile:** cards; reply as full-screen composer.
12. **Desktop:** list with inline reply expansion.
13. **Edge cases:** featuring limited to approved results, max 6 featured; unfeature anytime; customer deleted a featured photo → disappears; review removed by admin → shown in Reported tab outcome only; business cannot see reviewer phone or open CRM from review (anti-retaliation); reply to a review whose text was removed → reply hidden too.
14. **Scope:** MUST all above. SOON: trends, response templates. LATER: AI reply assistant, staff review breakdown page.

---

## B11. Analytics — **[MUST]** (basic) · **[SOON]** (advanced)

1. **Purpose:** Show whether the business is growing and where time is wasted — computed from bookings (not click events).
2. **User goal:** "How did we do this month, who's performing, when are we empty?"
3. **Hierarchy:** period → headline KPIs → trend chart → breakdowns.
4. **Sections:**
   1. **Period selector:** Today · 7 days · 30 days · This month · Custom; compare to previous period.
   2. **KPI tiles:** Revenue (completed, estimated) · Bookings (completed) · Customers (unique) · New vs returning · Average booking value · Cancellation rate · No-show rate · Utilization.
   3. **Trend chart:** bookings & revenue by day.
   4. **Top services** (bookings, revenue) and lowest.
   5. **Staff table:** bookings, revenue, utilization, rating.
   6. **Source mix:** APP_NAME marketplace vs own link vs manual (shows value APP_NAME brings — important for future monetization).
   7. **Busiest hours heatmap** (weekday × hour) [SOON]; retention cohort / "haven't returned in 60 days" count [SOON]; insights [LATER].
   - Every KPI has an ⓘ definition (e.g., "Revenue = sum of completed booking prices. Actual cash may differ.").
5. **Components:** `PeriodPicker`, `KpiTile`, `LineChart`, `BarList`, `DataTable`, `Heatmap` (Soon).
6. **Main CTA:** none (read-only); change period.
7. **Secondary:** export CSV [SOON], drill into bookings list with filter.
8. **Empty:** <7 days of data → "Analytics fill in after your first week of bookings" with what's available so far.
9. **Loading:** tiles skeleton; charts skeleton; queries hit pre-aggregated daily rollups.
10. **Errors:** standard per widget.
11. **Mobile:** tiles 2-col, chart full width, tables collapse to top-5 lists.
12. **Desktop:** grid dashboard.
13. **Edge cases:** "from"/range prices → revenue marked estimated; edited price on booking uses booking value; staff archived still in historical tables; Reception role hidden from revenue by default; timezone boundaries use Beirut days.
14. **Scope:** MUST: period, tiles, trend, top services, staff table, source mix. SOON: heatmap, retention, exports. LATER: insights, benchmarks vs area, AI summaries.

---

## B12. Settings — **[MUST]** (core sections)

1. **Purpose:** Configure profile, booking rules, notifications, team, sharing.
2. **User goal:** Set it once, rarely return.
3. **Hierarchy:** grouped sections list → section page.
4. **Sections:**
   - **Business profile** [MUST]: name, slug, categories, description, serves, amenities, photos (cover, portfolio reorder), contacts, Instagram.
   - **Location & hours** [MUST]: address/pin/landmark, weekly hours, **closures/holidays** (date ranges, with "cancel affected bookings?" flow).
   - **Booking rules** [MUST]: instant vs request; request expiry (default 4h); minimum notice; max advance; slot interval (15/30); cancellation window; **staff choice mode** (Any available or choose [default] · Any only · Choose only); **automatic assignment rule** for Any available: *Least booked that day* [default, MUST] · *Priority order* [MUST] · *Round robin* [SOON] · *Minimize gaps / first available* [SOON]; show staff price differences to customers (on/off); show verified appointment counts on staff cards (on/off); notify customers when their Any-mode booking is reassigned (default off; specific-choice bookings always notify); max active bookings per customer.
   - **Notifications** [MUST]: which members get WhatsApp/push for new booking, cancellation, new review, request pending; daily summary [SOON].
   - **Team & roles** [MUST]: members, roles, invites (mirrors Staff › Access).
   - **Booking link & marketing kit** [MUST]: link, QR poster, story template, WhatsApp auto-reply text.
   - **Verification** [SOON]: submit documents → Verified Business.
   - **Resources** [SOON]: rooms/chairs/machines and service requirements.
   - **Plan & billing** [LATER]: shows "Free during launch" placeholder.
   - **Danger zone** [MUST, Owner only]: pause online bookings, transfer ownership [SOON], close business.
5. **Components:** `SettingsNav`, forms, `HoursGrid`, `ClosureDialog`, `RoleSelect`, `ShareKit`.
6. **Main CTA:** **Save** per section (sticky when dirty).
7. **Secondary:** preview public page, copy link.
8. **Empty:** n/a (defaults everywhere).
9. **Loading:** standard.
10. **Errors:** invalid combos (min notice > max advance) → inline; slug change → warning "Old links will redirect"; closures overlapping bookings → list + choose cancel-and-notify or keep.
11. **Mobile:** section list → page per section.
12. **Desktop:** left section nav, form right.
13. **Edge cases:** switching to request mode affects only new bookings; pausing online bookings keeps profile visible with contact CTAs; changing slot interval doesn't move existing bookings; only Owner can change roles of Managers or close business; every settings change writes an audit event (actor, before/after).
14. **Scope:** as tagged per section.

---

## Business scope summary

**Must Launch:** assisted onboarding + share kit, Overview (lean), Calendar (Day/Week/List, drag, realtime, walk-in), Appointment Creation (speed-tested), Bookings (with requests), Customers + Detail (basic CRM, notes), Services (canonical mapping), Staff (schedules, time off, access), Reviews (reply/report/feature), Analytics (basic + source mix), Settings (core).

**Soon:** self-serve signup, overlap override + processing segments, customer segments/import, heatmap/retention, verification, resources, exports, daily WhatsApp summary.

**Later:** promotions/campaigns, AI insights & reply assistant, multi-location, recurring bookings, payments/deposits, billing.
