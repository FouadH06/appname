# Phase 2 · Part 2 — Customer Experience

Legend: **[MUST]** Must Launch · **[SOON]** Soon After Launch · **[LATER]** Later.
Surfaces: **W** = public web (acquisition), **A** = Expo app (retention/discovery).
"Standard loading / error / offline" = patterns in Part 1 §5.

---

## C1. Public Business Booking Page — **[MUST]** · W (A renders it as C5)

`platform.com/{slug}`

1. **Purpose:** Turn a link click from Instagram / TikTok / WhatsApp / Google / QR into a booking in under a minute, while building trust for someone who may never have heard of APP_NAME.
2. **User goal:** "Can I book this place, for this service, at a time that suits me — and is it any good?"
3. **Hierarchy:** (1) Who this is + proof it's real → (2) Book → (3) What it costs → (4) When it's free → (5) What others got (results/reviews) → (6) Where/how to reach it.
4. **Sections (top → bottom):**
   1. **Media header:** cover photo (16:9 mobile), "+12 photos" button → portfolio gallery. No autoplay carousel.
   2. **Identity block:** name, primary category · price level, area + landmark, `RatingInline`, up to 2 `DiscoveryLabel`s, `VerifiedBusiness` mark (Soon), "Open now · until 8:00 PM" / "Closed · opens Tue 9:00 AM", serves (Women / Men / Everyone).
   3. **Quick actions row:** WhatsApp · Call · Directions · Share. (Instagram link lives in About.)
   4. **Next available:** "Earliest: Today 4:30 PM · 5:00 · 6:15" for the most-booked service, with the service name shown ("for Haircut"). Tapping a time → flow with service + time preselected (still passes through staff if needed, then Review).
   5. **Services:** sticky horizontal category tabs (Hair, Beard, Color…); `ServiceRow` list; "Popular" group first (top 3 by bookings). Each row → Book.
   6. **Team:** horizontal staff avatars (photo, name, role, ★ if ≥5 reviews, next available; ♡ in app [SOON]). Tap → `StaffProfileSheet` (C8a) with **Book with {name}**.
   7. **Customer Results:** strip of `ResultTile`s (featured first, labeled "Featured by {Business}", then organic) → "See all results" (C6).
   8. **Reviews:** `RatingSummary` with `DimensionBars` + 3 reviews (most recent verified with text) → "See all {n} reviews".
   9. **About:** description, full address + map (static map image, tap → Google Maps), hours table (today highlighted), amenities (Private room, Parking, Card accepted, Wheelchair access), Instagram / website.
   10. **Footer:** "Bookings powered by APP_NAME" + "Get the app" (small, not a banner), report this business, terms/privacy.
   - **Sticky CTA bar:** "Book appointment" (+ "from $12" left).
5. **Main components:** `BusinessHeader`, `RatingInline`, `DiscoveryLabel`, `NextAvailableChips`, `CategoryTabs`, `ServiceRow`, `StaffCard` (compact), `ResultTile`, `RatingSummary`, `ReviewCard`, `StickyCTA`, `MapPreview`, `HoursTable`.
6. **Main CTA:** **Book appointment** → C7 (or C9 if a time chip was tapped).
7. **Secondary:** WhatsApp, call, directions, share (native share sheet / copy link), view results, view reviews, view photos; (A) favorite.
8. **Empty states:** No reviews → "New on APP_NAME — reviews appear after verified visits." No results → section hidden (not an empty box). No portfolio → hide "+photos". No next availability in 14 days → "Fully booked for the next 2 weeks" + **Join waitlist** (Soon) or WhatsApp.
9. **Loading:** SSR/ISR delivers identity, services, hours, reviews summary in the first HTML (no skeleton for above-the-fold). Next-available chips stream in client-side with a 3-chip skeleton.
10. **Errors:** Availability fetch fails → chips section shows "Couldn't load times · Retry"; Book button still works (flow retries). Page-level failure → cached static version if available.
11. **Mobile:** single column; sticky CTA always visible except when keyboard open or when the Services section is on screen (each row has its own Book). Photos lazy-loaded; LCP image ≤120KB. Target LCP <2.5s on a slow 4G connection.
12. **Desktop:** two columns — content left (max 720px), **sticky booking panel** right (service picker + next times + Book). Gallery as 1 large + 4 small grid.
13. **Edge cases:**
    - **In-app browsers** (Instagram/TikTok webviews): no reliance on third-party cookies, Google sign-in, or pop-ups; OTP session stored first-party; "Open in browser" never required. Test `tel:` and `wa.me` links inside webviews.
    - Business not live / paused online booking → identity + contact visible, banner "Not taking online bookings right now" with WhatsApp/Call; no Book CTA.
    - Suspended/removed → neutral "This page isn't available".
    - Service `on_consultation` → row button "Ask on WhatsApp" (prefilled message) instead of Book.
    - Services for women only when visitor filtered men elsewhere → no effect here (it's the business's own page).
    - Slug renamed → 301. Uppercase/trailing slash normalized.
    - Visitor already has an upcoming booking here → top banner "You're booked Thu 4:30 PM · Manage".
    - Arabic business name/description → `dir=auto`, correct font fallback.
    - **No competitor recommendations** on this page (Part 1 §8.2).
14. **Scope:** MUST: everything above except → SOON: waitlist CTA, Verified Business mark, language switch (Arabic UI). LATER: "Book with {staff}" deep links per staff (`/{slug}/@karim`), embeddable widget.

---

## C2. Customer Home — **[MUST]** · A (W: `/` landing — lean version)

1. **Purpose:** Discovery-first starting point that gets returning users to a booking fast and new users to a trusted choice.
2. **User goal:** "Rebook my usual" or "find somewhere good near me, soon."
3. **Hierarchy:** Search → Book Again (if any) → available soon near me → trusted near me → proof (results).
4. **Sections:**
   1. **Header:** area picker ("Achrafieh ▾" — clusters first, then "Use my location"), bell (notifications, dot if unread).
   2. **Search field:** "What do you need?" with rotating placeholder examples (Haircut · Nails · Balayage · Beard trim). Tap → C3 focused.
   3. **Category chips:** Hair · Barber · Nails · Lashes & Brows · Makeup · Spa · Beauty center (horizontal, icon + label).
   4. **Book Again** (only if history): staff-first cards — "**Book again with Karim** · Haircut · Fade District · 24 days ago · Next: Today 5:00 PM" → one tap opens C9 with business + service + staff preset (customer only picks date/time). Favorited staff [SOON] also appear here ("♥ Maya at Salon X · Next: Thu"). Up to 3 cards horizontal. If the last visit was via Any, the card still names the person who did the service (customers often want the same one next time).
   5. **Upcoming** (only if a booking in next 48h): slim card "Tomorrow 4:30 PM · Fade District" → Booking Detail.
   6. **Available today near you:** `BusinessCardCompact` rail with next slot.
   7. **Top rated near you:** rail (label-driven, not a leaderboard; no numbering).
   8. **Customer results near you** [SOON]: `ResultTile` grid 2×3 → Result Detail.
   9. **New on APP_NAME:** rail.
   - Max 6 sections visible; sections with <3 items are hidden.
5. **Components:** `AreaPicker`, `SearchField`, `CategoryChip`, `RebookCard`, `UpcomingCard`, `BusinessCardCompact`, `ResultTile`.
6. **Main CTA:** Search (and **Book again** when present).
7. **Secondary:** category tap → results pre-filtered; "See all" on rails → C4 with matching filter; bell; change area.
8. **Empty:** Area outside launch clusters → replace rails with "We're live in Achrafieh / Mar Mikhael, Hamra / Verdun and Hazmieh / Baabda" + three area buttons + "Notify me when you launch in {area}" [SOON]. New user: no Book Again/Upcoming sections (no empty placeholders).
9. **Loading:** standard; header/search/categories render instantly (static); rails skeleton independently.
10. **Errors:** per-rail inline retry; location permission denied → silently fall back to last chosen area / cluster picker.
11. **Mobile:** vertical scroll, rails horizontally scrollable with peek of next card; pull-to-refresh.
12. **Desktop (W):** lean landing: hero search + categories + cluster links + "For businesses" link. Rails in 4-column grids.
13. **Edge cases:** Book Again for a business that closed/suspended → hide card; staff no longer there / archived / no longer performs service → card says "Haircut · Fade District" (staff dropped) and flow starts at the Staff Preference step with Any preselected. First open without location → ask for cluster instead of GPS prompt (GPS prompt only on "Use my location").
14. **Scope:** MUST: header, search, categories, Book Again, Upcoming, Available today, Top rated, New. SOON: Customer results section, "notify me" outside clusters, personalization. LATER: promotions rail, "Because you booked…".

---

## C3. Search / Explore — **[MUST]** · A (tab) + W (search overlay)

1. **Purpose:** Translate messy intent ("7ala2", "manucure", "balayage hamra", a business name) into the right results.
2. **User goal:** Type a little, get to the right list or business.
3. **Hierarchy:** Input → live suggestions (typed groups) → recents → popular services → categories.
4. **Sections:**
   1. **Search input** (auto-focus), clear, cancel. Secondary field: area ("Hamra / Verdun ▾").
   2. **Live suggestions** (as you type, debounced 150ms), grouped:
      - **Services** ("Balayage", "Beard trim") — matched via canonical service + synonyms in EN/AR/FR/Arabizi. Shows how many places offer it nearby.
      - **Businesses** (name matches, with area + rating).
      - **Areas** ("Mar Mikhael").
   3. **Recent searches** (local, max 8, clearable).
   4. **Popular near you:** service chips (by bookings in area).
   5. **Browse categories** grid.
   6. **Explore results visually** [LATER]: "See real results" entry → result-photo discovery.
5. **Components:** `SearchInput`, `SuggestionGroup`, `ServiceChip`, `CategoryGrid`, `AreaPicker`.
6. **Main CTA:** select suggestion / submit → C4 (service or free text) or C5 (business).
7. **Secondary:** change area, clear recents, category browse.
8. **Empty:** no matches while typing → "No exact matches for 'xyz'. Try 'haircut', 'nails'…" + closest synonyms; still allow submit (full-text results).
9. **Loading:** suggestions show inline shimmer rows only after 300ms (avoid flicker).
10. **Errors:** suggestion endpoint fails → still allow submit; show recents/categories (static).
11. **Mobile:** full-screen; keyboard "Search" submits; suggestions list scroll dismisses keyboard.
12. **Desktop:** dropdown panel under top-bar search (not full page); keyboard navigation (↑↓ Enter Esc).
13. **Edge cases:** Arabizi input ("7ala2" → barber, "manikir"/"manucure" → manicure); Arabic input with/without diacritics or tatweel; mixed ("balayage حمرا"); area in query ("barber hazmieh" → service=barber + area=Hazmieh); query for a category not launched ("dentist") → "Not on APP_NAME yet" (never zero-result shame); profanity/garbage input → no suggestions, no error.
14. **Scope:** MUST: input, typed suggestions, recents, popular, categories. LATER: visual results entry, voice search.

---

## C4. Search Results — **[MUST]** · A + W

1. **Purpose:** Let the user compare a handful of trustworthy options and pick one.
2. **User goal:** "Which of these is good, nearby, affordable, and free when I am?"
3. **Hierarchy:** result count + applied context → filters → list of cards (proof + next slot) → load more.
4. **Sections:**
   1. **Context bar:** "Balayage · Hamra / Verdun" (tap to edit) + result count.
   2. **Filter chips row:** Available today · Date/time (sheet) · Price · Rating 4.5+ · Distance · For: Women/Men · Staff gender [SOON] · Verified business [SOON] · "All filters".
   3. **Sort:** Recommended (default, with ⓘ "Based on verified reviews, bookings, distance and availability") · Nearest · Highest rated · Price low→high · Soonest available.
   4. **Results list:** `BusinessCard`s. When the query is a service, the card shows **that service's price & duration** and **next slot for that service** ("Balayage from $65 · Next: Thu 11:00 AM").
   5. **Map toggle** [SOON]: split map/list.
   6. **Sponsored** slots [LATER]: fixed positions, `SponsoredTag`.
5. **Components:** `ContextBar`, `FilterBar`, `FilterSheet`, `SortMenu`, `BusinessCard`, `MapView` (Soon).
6. **Main CTA:** tap card → C5 (with service preselected if query was a service).
7. **Secondary:** filters, sort, favorite (A), quick "Book" on card [SOON] → straight into C8/C9 for the matched service.
8. **Empty:** "No places match all your filters" + chips to remove the most restrictive filter ("Remove 'Available today'") + "Show nearby areas". Outside clusters: cluster picker.
9. **Loading:** 4 card skeletons; filters stay interactive; changing filters shows a thin progress bar over the list (keeps old results visible, dimmed).
10. **Errors:** inline retry replacing the list; filters preserved.
11. **Mobile:** filter chips horizontally scroll; "All filters" as full-height sheet with "Show {n} results" live count button; infinite scroll with 20 per page.
12. **Desktop:** filters in a left column, 2-column card grid or list + map right [SOON].
13. **Edge cases:** Service offered only "on consultation" → card shows "Price on consultation"; next slot not computable (business in request mode) → "Requests: usually replies in ~1h" [SOON]; very few results (<3) → append "Also nearby" from adjacent cluster, clearly separated; business with <5 reviews shows "New" (ranking gives exploration boost but label is honest).
14. **Scope:** MUST: list, core filters (Available today, Date/time, Price, Rating, Distance, For), sort. SOON: map, quick-book, staff gender, verified filter. LATER: sponsored, saved searches.

---

## C5. Business Profile — **[MUST]** · A (W equivalent = C1)

1. **Purpose:** Same storefront as C1, inside the marketplace context.
2. **User goal:** Decide and book, or save for later.
3. **Hierarchy:** Identical to C1. Differences only listed below.
4. **Sections:** C1 sections organized as a sticky **tab bar** under the header: **Services · Results · Reviews · About** (Team lives inside Services, above the list). Header collapses to a compact title bar on scroll.
5. **Components:** as C1 + `TabBar`, `FavoriteButton`, `ShareButton`.
6. **Main CTA:** **Book** (sticky).
7. **Secondary:** favorite ♡, share, back to results with scroll position preserved, WhatsApp/call/directions.
8. **Empty / 9. Loading / 10. Errors:** as C1; in app, cached profile shows instantly then revalidates.
11. **Mobile:** tabs sticky under collapsed header; swipe between tabs disabled (conflicts with horizontal rails).
12. **Desktop:** n/a (web uses C1).
13. **Edge cases:** Arrived from a service search → Services tab scrolled to and highlighting that service. Arrived from a Result → Results tab with that result open. "Similar nearby" block allowed only at the very bottom and only when source is marketplace [LATER].
14. **Scope:** MUST as C1. LATER: similar nearby, Q&A.

---

## C6. Customer Results — **[MUST]** (business-level) / **[LATER]** (global discovery) · A + W

Two views: **Results Grid** (per business, `/{slug}/results`) and **Result Detail** (`/r/{id}`).

1. **Purpose:** Show real outcomes from verified visits — the platform's differentiator versus curated Instagram feeds.
2. **User goal:** "What will I actually look like after this, here, with this person?"
3. **Hierarchy (Grid):** Featured by business (labeled) → organic results (platform-ordered) → filter by service/staff. **(Detail):** images → trust mark → service/staff/price-at-time/date → the review → business reply → Book similar.
4. **Sections:**
   - **Grid:** filter chips (All · by service · by staff); "Featured by {Business}" row (max 6, business-selected, labeled); organic grid, ordered by platform (recency × quality × relevance; never by business). Negative results remain in the organic feed.
   - **Result Detail:** image viewer (swipe; before/after pairs shown as `BeforeAfterPair`), `TrustMark`, "{Service} at {Business}", "by {Staff}", "Price at the time: $65", "Visited Sep 2026", business `RatingInline` + area, linked review (stars + text, translate), business reply, report link.
5. **Components:** `ResultTile`, `ResultViewer`, `BeforeAfterPair`, `TrustMark`, `ReviewCard` (compact), `StickyCTA`.
6. **Main CTA:** **Book similar** → booking flow with same service and staff preselected (Staff Preference opens on "Choose someone" with that staff member selected; still changeable; if staff left, falls back to "Any available" with a notice).
7. **Secondary:** view business, share result, report ("Inappropriate", "Not a real result", "My photo — remove it"), next/previous result.
8. **Empty:** business with no results → tab shows "No customer results yet. They appear after verified visits." (on the Results tab only; the profile strip is hidden).
9. **Loading:** grid skeleton squares; detail loads low-res first then full.
10. **Errors:** image failed → neutral placeholder with retry; removed result → "This result was removed" (no reason).
11. **Mobile:** 3-column grid; detail full-screen dark viewer with swipe-down to close; info as a bottom panel over image.
12. **Desktop:** 4–5 column grid; detail as modal with image left, info right.
13. **Edge cases:** Result whose review text was removed but image kept → show image + stars only. Image removed but review kept → result disappears (review stays in Reviews). Customer deleted account → results removed. Price "from" service → show actual snapshot price. Staff anonymized (left business) → "by a former team member". Faces: shown as uploaded (face auto-blur [LATER]). Minor-flagged images never appear here unless manually approved.
14. **Scope:** MUST: business results grid, result detail, featured row, Book similar. SOON: filter by staff, share. LATER: **global visual discovery** (search "balayage" → results feed across businesses, area filter), staff portfolios, face auto-blur.

---

## C7. Service Selection — **[MUST]** · A + W (booking step 1)

1. **Purpose:** Pick what to book, with price and duration clear before commitment.
2. **User goal:** Find my service quickly and know what it costs.
3. **Hierarchy:** step header → search within services (if >12) → category tabs → service rows → selected summary.
4. **Sections:** stepper ("1 of 4 · Service"), business mini-header (name + rating), optional search field, category tabs, `ServiceRow` list (popular first), `ServiceDetailSheet` on row tap (full description, what's included, duration, price explanation for "from", staff who perform it).
5. **Components:** `Stepper`, `ServiceRow`, `CategoryTabs`, `ServiceDetailSheet`, `StickyCTA`.
6. **Main CTA:** **Select** on a row → next step immediately (single-service MVP: no separate Continue).
7. **Secondary:** service details; back to business; (SOON) "+ Add another service" after selecting one.
8. **Empty:** no online-bookable services → "This business takes bookings by WhatsApp" + WhatsApp CTA.
9. **Loading:** row skeletons (usually preloaded from profile, so instant).
10. **Errors:** service became inactive between page load and selection → toast "That service isn't available anymore" + refresh list.
11. **Mobile:** full-screen step; category tabs sticky.
12. **Desktop:** inside the right sticky panel (C1) as a dropdown/list, or full-width step page at `/book`.
13. **Edge cases:** price types (`from`, `range`, `on_consultation` → not bookable online); combos (Hair + Beard) appear as normal services with "Includes: Haircut, Beard trim"; gender-specific services ("Men's haircut") labeled; service requires consultation first [LATER]; arrived with `?service=` preselected → skip this step.
14. **Scope:** MUST: single service + combos. SOON: multi-service in one visit. LATER: service add-ons/options (hair length variants), packages.

---

## C8. Staff Preference — **[MUST]** · A + W (step 2)

Flow position: **Service → Staff Preference → Date → Time → Confirmation.** Date and Time share one screen (C9).

The customer is **never forced to pick a worker**. There are two modes, and **Any Available is the default**.

1. **Purpose:** Let loyal customers book *their* barber or stylist in one tap, and let everyone else get the fastest slot without thinking about staff.
2. **User goal:** "Book with Maya", or "I don't mind who, just soon."
3. **Hierarchy:** (1) personal shortcut (*Book again with Maya* / favorited staff), if any → (2) **Any Available** (preselected, labeled Recommended) → (3) **Choose someone** (expands the staff list).
4. **Sections:**
   1. Stepper ("2 of 4 · Who"), service summary line ("Balayage · from $65").
   2. **Personal shortcuts** (returning customers only; max 2):
      - **"Book again with Maya"**: shown when the customer's last completed booking for this service, or this business, was with Maya. Subline: "Your last visit · 24 days ago · Next: Today 4:30 PM".
      - **Favorited staff** at this business who perform the service: "♥ Karim · Next: Tomorrow 10:00 AM".
   3. **Any Available** (radio card, preselected): "Any available staff" · "**Recommended for fastest booking**" · stacked avatars of the eligible staff · "Earliest: Today 4:30 PM".
   4. **Choose someone** (radio card). Selecting it reveals the staff list inline. On mobile the list pushes the Continue button down; there's no separate screen.
      - `StaffCard` for each staff member who performs the service and is public:
        ```
        [photo]  Maya                         ♡
                 Senior Hair Stylist
                 ★ 4.9 · 58 verified reviews
                 Balayage · Hair Color · Blowdry
                 Next available: Today 4:30 PM
                 $70 · 2h 30m   (only if it differs from the service default)
        ```
      - Order: favorites → last-visited → soonest available → business's display order. Staff with no availability in the horizon sit at the bottom, greyed: "Fully booked for 14 days".
      - Tap photo or name → `StaffProfileSheet` (C8a).
5. **Components:** `StaffPreferenceOption` (radio card), `RebookStaffShortcut`, `StaffCard`, `StaffProfileSheet`, `StickyCTA`.
6. **Main CTA:** **Continue** → C9. It carries `staff=any` or `staff={id}`. Tapping a shortcut goes straight to C9 with that staff member.
7. **Secondary:** favorite a staff member (♡, app, signed in), open staff profile, back.
8. **Empty:** no staff available in the horizon for any mode → skip to C9, which shows the fully-booked fallback (waitlist / WhatsApp).
9. **Loading:** one call returns eligible staff plus the next available time per staff member and for Any. Only the "Next available" lines show skeletons.
10. **Errors:** availability call fails → the list still shows (without next times) and both modes stay selectable.
11. **Mobile:** two large radio cards. The staff list expands under "Choose someone", and the sticky Continue button stays visible.
12. **Desktop:** radio cards side by side. The staff grid (2–3 columns) appears below when "Choose someone" is selected.
13. **Edge cases:**
    - **Auto-skip:** exactly one eligible staff member → skip the step. Summary shows "with Maya".
    - Business setting `staff_choice_mode`:
      - `any_or_choose` (default): both options.
      - `any_only`: step skipped, Any is used.
      - `choose_only`: only the list, e.g. makeup artists where the person is the product.
    - Staff who don't accept automatic assignment (`accepts_any_assignment = false`, e.g. the owner or a senior colorist taking requests only) appear in "Choose someone" but are excluded from Any. The Any avatars reflect that.
    - **Price and duration differ between staff** (overrides): the Any card shows "$60–70 depending on who's assigned". The exact price and duration are confirmed on C10 after assignment.
    - "Book again with Maya", but Maya left the business, no longer performs this service, or is archived → shortcut hidden. If the customer arrived through a rebook deep link, show a notice: "Maya isn't available at {Business} anymore. Showing any available staff."
    - Staff rating only appears at ≥5 verified reviews. Below that: "New" or just the appointment count (see C8a rules).
    - A customer arriving from a Customer Result ("Book similar") → `Choose someone` preselected with that result's staff member.
14. **Scope:** MUST: both modes, the rebook shortcut, staff cards with rating, specialties and next available, auto-skip, business mode setting. SOON: favorite staff (♡) and favorited-staff shortcuts, staff gender indication. LATER: staff tiers (Junior/Senior pricing presets), "Book with {staff}" deep links, portable staff profiles across businesses.

### C8a. Staff Profile (sheet in flow; page `/{slug}/staff/{staff-slug}` [SOON]) — **[MUST]** as a sheet

- **Purpose:** Build trust in an individual worker. Loyalty in Lebanon often follows the barber or stylist, not the salon.
- **Content:** photo, name, role/title, bio (short), rating + verified review count (≥5 rule), **verified appointments** ("120+ verified appointments": rounded, hidden below 20, business can hide counts), **specialties** (max 3, chosen by the business from services this staff member actually performs; fallback = their top 3 services by completed bookings), services they perform with their prices/durations, **their Customer Results** grid (results where `staff_id` = them), recent reviews mentioning them, next available.
- **CTA:** **Book with Maya** → C9 with that staff member. Secondary: ♡ favorite [SOON], share [SOON].
- **Edge cases:** hidden (non-public) staff never get a profile. Archived staff: the profile is gone, and their past results show "by a former team member". Staff with no reviews: "New to APP_NAME" plus services and results only.

---

## C9. Date & Time Selection — **[MUST]** · A + W (step 3)

1. **Purpose:** Show real, bookable times fast; recover gracefully when the day is full.
2. **User goal:** Find a time that fits.
3. **Hierarchy:** selected day → slots → staff switcher → fallback (next available / waitlist).
4. **Sections:**
   1. Stepper ("3 of 4 · Time"), summary line "Haircut · 30 min · with Karim ▾" or "· Any available ▾" (tap = change staff inline).
   2. **Staff chip row** (Any available · Karim · Joe · …) — switch mode/person without going back. The selected chip defines which availability is shown:
      - **Any available:** union of slots across all eligible staff who accept automatic assignment (each staff member's own duration override and schedule applied individually). A time appears if at least one of them can take it.
      - **Specific staff:** only that staff member's slots.
   3. **DateStrip** (14 days from today; dots = availability; disabled = none/closed) + "More dates" → month picker up to business horizon.
   4. **SlotGrid** grouped Morning / Afternoon / Evening. With "Any available", slots don't show staff names. **Assignment happens when the customer taps a time:** the server picks one concrete staff member among those free at that time using the business's assignment rule (least booked that day · round robin · priority order · minimize gaps), creates the hold on that person, and the Review screen shows who was assigned. The booking always stores a concrete `staff_id`. *(Refines Phase 1 §9, which said "assign at commit".)*
   5. **Fallbacks:** if the day has no slots: "No times on Thu. Next available: **Fri 10:00 AM** →" ; if no slots in horizon: **Join waitlist** [SOON] + WhatsApp business.
5. **Components:** `StaffChipRow`, `DateStrip`, `MonthPicker`, `SlotGrid`, `NextAvailableJump`, `WaitlistEntry` (Soon).
6. **Main CTA:** tap a slot → creates hold → C10.
7. **Secondary:** change staff, change date, jump to next available, join waitlist.
8. **Empty:** described in fallbacks (never a blank grid).
9. **Loading:** default day = first day with availability (computed with the strip). Slots for adjacent days prefetched. Skeleton pills during day switch (keep strip interactive).
10. **Errors:** hold creation fails because slot was just taken → stay on screen, remove slot, toast "Someone just booked 4:30. Pick another time." and highlight nearest two. Availability fetch fails → inline retry.
11. **Mobile:** date strip sticky; slot pills ≥44px tall; 4 per row.
12. **Desktop:** calendar month on left, slots on right.
13. **Edge cases:** min notice (e.g., 2h) hides near slots with note "Bookings need 2h notice — call for sooner"; today's past times never shown; DST transition days; device in another timezone → "Times shown in Beirut time"; business closure day shown disabled with tooltip "Closed (holiday)"; request-mode business → slots labeled "Request" and Review CTA says "Send request"; customer already has a booking overlapping → allowed at another business? Yes, but warn "You have another booking at 4:00 PM"; same business overlapping → blocked.
14. **Scope:** MUST: strip, slots, staff switch, next-available jump. SOON: waitlist entry. LATER: "Notify me if earlier opens", time-of-day preference filter.

---

## C10. Booking Review (+ phone verification) — **[MUST]** · A + W (step 4)

1. **Purpose:** Final check, identity verification, policy acknowledgement, commit.
2. **User goal:** Confirm quickly with confidence nothing is hidden.
3. **Hierarchy:** summary → who (phone/name) → policy → note → Confirm.
4. **Sections:**
   1. `HoldTimer` (subtle, top).
   2. `BookingSummaryCard`: business, service, **staff row with photo**, date, 4:30–5:00 PM, price, "Pay at venue · Cash".
      - Specific mode: "with Maya".
      - Any mode: "**You'll be with Karim**" + small "Assigned from available staff · Change" link. *Change* opens the Choose-someone list filtered to staff free at this exact time. Picking one moves the hold to that person, keeping the time. If nobody else is free, it says so.
      - Price/duration shown are the **assigned staff member's** (overrides applied). If they differ from what C8 displayed, a subtle line: "Price for Karim: $15".
   3. **Your details:**
      - Signed in → name + phone shown (edit name only).
      - Not signed in → `PhoneInput` → "Send code" → `OtpInput` sheet (WhatsApp first; "Send by SMS instead" after 30s) → if new user: first name + last name (last name optional) → optional email [LATER].
   4. **Note to business** (optional, 200 chars; "e.g., I'd like to keep the length").
   5. **Policy block:** "Free cancellation until 2h before" (from business settings); request-mode: "{Business} will confirm your request, usually within 1 hour"; "You'll get confirmation and a reminder on WhatsApp."
   6. Terms consent line (implicit by booking, link to terms/privacy).
5. **Components:** `HoldTimer`, `BookingSummaryCard`, `PhoneInput`, `OtpSheet`, `TextArea`, `PolicyBlock`, `StickyCTA`.
6. **Main CTA:** **Confirm booking** (instant) / **Send request** (request mode). Disabled until phone verified.
7. **Secondary:** edit any summary line (returns to that step preserving others), back.
8. **Empty:** n/a.
9. **Loading:** OTP send/verify inline spinners in button; commit = full-screen "Booking…" (max 10s).
10. **Errors (copy mapped from server codes):**
    - `SLOT_TAKEN` → back to C9 with nearest alternatives.
    - `HOLD_EXPIRED` → "Your hold expired" + re-check same slot automatically; if free, continue.
    - `OTP_INVALID` / `OTP_TOO_MANY` → inline; lockout 10 min after 5 attempts; "Use SMS instead".
    - `CUSTOMER_BLOCKED` (reliability or business block) → "Online booking isn't available for this account. Contact the business on WhatsApp." (no blame details).
    - `RELIABILITY_REQUEST_ONLY` → silently switch CTA to "Send request" with explanation line "This will be sent as a request".
    - `OVERLAP_SAME_BUSINESS`, `TOO_MANY_ACTIVE_BOOKINGS` → explain + link to existing booking.
    - Network drop during commit → idempotency key ensures retry never double-books; show "Checking your booking…" then resolve.
11. **Mobile:** single column; OTP sheet with autofill (`autocomplete="one-time-code"`, Android SMS Retriever in app); keyboard doesn't cover CTA.
12. **Desktop:** summary right, details left.
13. **Edge cases:** phone belongs to an existing shadow CBP at this business → silently linked after OTP (no data shown to customer beyond their own bookings); customer is also a staff member of this business → allowed but flagged (their review would be ineligible); foreign number; WhatsApp not installed → SMS path; hold extended to 10 min when OTP requested; user backgrounded the app for >10 min → re-check.
14. **Scope:** MUST all. LATER: deposits/prepayment step, promo codes, guest bookings for someone else ("Booking for a friend") [SOON].

---

## C11. Booking Success — **[MUST]** · A + W

1. **Purpose:** Reassure, give practical next steps, convert web users to app users without pressure.
2. **User goal:** "Am I booked? What now?"
3. **Hierarchy:** status → details → practical actions → app prompt (web only).
4. **Sections:** check animation + "You're booked" / "Request sent"; summary card (with address + landmark); actions: **Add to calendar** (.ics / Google Calendar link), **Directions**, **Share** (WhatsApp prefilled "I'm booked at…"), **Manage booking**; line "Confirmation sent to WhatsApp +961 70 ••• 456"; **App prompt (W only):** "Rebook in one tap, get reminders and save favorites — Get the app" with store buttons (deep link carries session → user lands signed in and sees this booking).
5. **Components:** `SuccessHeader`, `BookingSummaryCard`, `ActionRow`, `AppPromoCard`.
6. **Main CTA:** **Add to calendar** (A: Done).
7. **Secondary:** directions, share, manage, get app.
8. **Empty:** n/a. 9. **Loading:** n/a (rendered from commit response).
10. **Errors:** notification send failure is invisible here (handled by outbox retries); if WhatsApp undeliverable, booking detail later shows "We couldn't reach you on WhatsApp".
11. **Mobile:** app prompt below the fold of actions; never a modal.
12. **Desktop:** centered card.
13. **Edge cases:** Request mode → "We'll notify you when {Business} confirms. If they don't respond in 4 hours, the request is cancelled automatically." Refreshing page shows the same success (idempotent route `/bookings/{id}?new=1`).
14. **Scope:** MUST all. LATER: "Add a note for your stylist with a reference photo".

---

## C12. My Bookings — **[MUST]** · A (tab) + W (`/bookings`)

1. **Purpose:** One place for upcoming visits, history, and pending actions.
2. **User goal:** Check when/where; change plans; rebook; review.
3. **Hierarchy:** action-needed items → upcoming (soonest first) → past (most recent first).
4. **Sections:** segmented control **Upcoming · Past** (+ **Waitlists** [SOON]); in Upcoming: `BookingCard` (date block, business, service, staff, status pill, "Starts in 2h"); pending requests shown with "Waiting for confirmation"; in Past: cards with **Book again**, **Leave review** (if eligible, with days remaining), "Missed" status with "Wasn't a no-show? Tell us" for no-shows.
5. **Components:** `SegmentedControl`, `BookingCard`, `StatusPill`.
6. **Main CTA:** tap card → C13. On past cards: **Book again**.
7. **Secondary:** leave review, contest no-show.
8. **Empty:** Upcoming: "No upcoming bookings" + **Find a place** (→ Explore) and Book Again cards if history exists. Past: "Your past visits will appear here."
9. **Loading:** card skeletons; cached list shown immediately in app.
10. **Errors:** standard.
11. **Mobile:** list; pull to refresh.
12. **Desktop (W):** two columns (Upcoming | Past) or tabs.
13. **Edge cases:** web user not signed in → phone OTP to see bookings; magic-link session from WhatsApp shows only that booking + "Verify your phone to see all bookings"; bookings created manually by a business for this phone appear only **after** the phone is OTP-verified (that's the claim moment) with label "Booked by {Business}".
14. **Scope:** MUST Upcoming/Past, rebook, review prompts. SOON: waitlists tab. LATER: receipts.

---

## C13. Booking Detail — **[MUST]** · A + W

1. **Purpose:** Everything about one booking plus every action allowed in its current state.
2. **User goal:** Get there, change it, or follow up after.
3. **Hierarchy:** status → when/where → actions → details → history.
4. **Sections:** status header (pill + human line: "Confirmed · Thu 3 Oct, 4:30 PM"); business card (name, address + landmark, map); service/staff/duration/price; your note; **actions (by state)**:
   - Pending: Cancel request.
   - Confirmed: **Reschedule** (keeps the same staff by default; "Any available" option offered if that person has no fitting time), **Cancel**, Directions, WhatsApp/Call business, Add to calendar.
   - Completed: **Book again with {staff}** (primary) + "Book again with anyone", **Leave review** / "View your review", **Share your result**, ♡ favorite {staff} [SOON], Report a problem.
   - If the business reassigned the staff member after booking: banner "Your appointment is now with Joe (changed by Fade District)". Customers who **specifically chose** a person are always notified of reassignment; Any-mode customers are notified only if the business opts to.
   - No-show: **"I was there"** (contest) → dispute sheet (short text + optional evidence photo) → status "Under review".
   - Cancelled: Book again; shows who cancelled and reason if business-cancelled.
   - Policy line (cancellation window) and activity timeline (Booked Sep 20 · Confirmed · Reminder sent · Rescheduled…).
5. **Components:** `StatusHeader`, `BusinessMiniCard`, `MapPreview`, `ActionList`, `Timeline`, `ConfirmSheet`, `DisputeSheet`.
6. **Main CTA:** state-dependent (Reschedule for upcoming; Book again for past).
7. **Secondary:** listed above.
8. **Empty:** n/a.
9. **Loading:** standard; opening from notification shows skeleton then content.
10. **Errors:** action rejected by server (e.g., cancel after start) → explain rule; reschedule slot taken → back to time step.
11. **Mobile:** actions as full-width buttons, destructive (Cancel) last and styled secondary-danger.
12. **Desktop:** content left, actions right.
13. **Edge cases:**
    - **Cancel inside policy window** → ConfirmSheet: "This is within 2 hours of your booking. Late cancellations may affect your ability to book instantly." (No shame, no numbers.) Reason picker optional.
    - **Reschedule** reuses C9 in-place with same service/staff; old slot released only when new slot commits (atomic move).
    - Business cancelled → apology copy + "Book another time" + (Soon) "Similar places available".
    - No-show contest window: 7 days. Only one contest per booking.
    - Booking at a business that was later suspended → actions limited to view.
14. **Scope:** MUST all states + contest. SOON: "Running late" quick message to business (WhatsApp prefilled). LATER: check-in on arrival.

---

## C14. Favorites — **[MUST]** (Places) · **[SOON]** (People) · A (W: [SOON])

1. **Purpose:** Short list of the places *and the people* the customer is loyal to; fastest path back to booking.
2. **User goal:** "Book my barber" / "book my salon".
3. **Hierarchy:** segmented **People · Places** (People first once the customer has any favorited staff, because loyalty follows the person) → cards with next availability.
4. **Sections:**
   - **People** [SOON]: `StaffFavoriteCard` — photo, name, role, business + area, "Next: Today 5:00 PM", **Book with Karim** (→ C7 filtered to services Karim performs, or straight to C9 if the customer's last service with Karim is still offered: "Haircut again?").
   - **Places** [MUST]: `BusinessCardCompact` with next availability and **Book**.
   - Sort: Recently saved / Soonest available / Nearest.
5. **Components:** `SegmentedControl`, `StaffFavoriteCard`, `BusinessCardCompact`, `FavoriteButton`.
6. **Main CTA:** **Book with {name}** / **Book**.
7. **Secondary:** unfavorite (swipe or heart, Undo toast), open staff profile / business profile.
8. **Empty:** People: "Tap ♡ on a barber or stylist you love. Book them directly next time." Places: "Tap ♡ on a place you like and it'll show up here." + Explore.
9. **Loading:** skeleton cards; cached list.
10. **Errors:** standard; heart toggle optimistic with rollback toast on failure.
11. **Mobile:** segmented list.
12. **Desktop:** n/a at launch.
13. **Edge cases:** favorited staff archived / left the business → card dimmed "No longer at Fade District" with remove option (portable profiles [LATER] would let the card follow them to a new business); staff made non-public → card dimmed "Not bookable online"; favorited business suspended → dimmed; favoriting prompts: after a 4–5★ review, "Add Karim to your favorites?" [SOON]; favorites sync server-side.
14. **Scope:** MUST: Places. SOON: People (staff favorites), post-review favorite prompt, web favorites. LATER: portable staff profiles, collections.

---

## C15. Leave Review — **[MUST]** · A + W (`/review/{token}`)

1. **Purpose:** Capture honest, structured, verified feedback with minimal effort.
2. **User goal:** Say how it went in under a minute.
3. **Hierarchy:** overall stars → structured ratings → text → photos → submit.
4. **Sections:**
   1. Header: business, service, staff, visit date, TrustMark preview ("Your review will show **Verified Booking**").
   2. **Overall rating** (required, 5 large stars, label under selection: Terrible · Poor · OK · Good · Excellent).
   3. **Rate the details** (optional; category dimensions): each row 1–5 tap scale. Not prefilled (avoids bias). "Skip" link.
   4. **Tell others more** (optional): text area with prompt chips ("Result", "Waiting time", "Staff", "Cleanliness", "Price"); any language; 20–2000 chars if provided; live soft hint if text contains a phone number ("Please don't include phone numbers").
   5. **Share your result** (optional) → C16 inline.
   6. Guidelines link ("What's allowed").
5. **Components:** `StarInput`, `DimensionInput`, `TextArea`, `PromptChips`, `PhotoUploader` (entry), `TrustMark`.
6. **Main CTA:** **Post review**.
7. **Secondary:** add photos, skip details, save draft (auto, local).
8. **Empty:** n/a.
9. **Loading:** submit inline spinner; token validation skeleton on web.
10. **Errors:** `REVIEW_WINDOW_CLOSED` (after 30 days) → "Reviews close 30 days after a visit"; `ALREADY_REVIEWED` → show existing review with Edit (if within 7-day edit window); `NOT_ELIGIBLE` (e.g., cancelled, staff-owned phone) → neutral "This visit can't be reviewed"; network → draft preserved.
11. **Mobile:** single scroll page; stars at top in thumb reach; keyboard pushes CTA.
12. **Desktop:** centered 640px column.
13. **Edge cases:** Verified Visit (manual booking) → web token link requires OTP first (the claim), then form shows "Verified Visit" preview; booking under no-show dispute → review allowed, published after dispute resolution? **Decision:** publish normally (dispute affects reliability, not review eligibility) unless the business wins the dispute, then the review is removed with notice; post-submit status "Being checked" → then published/held; text held but ratings published (independent moderation) → customer notified "Your rating is live; your comment needs changes" with Edit.
14. **Scope:** MUST all. SOON: edit history visible to admin, "helpful" votes. LATER: staff-specific tip/praise, AI writing suggestions (no).

---

## C16. Upload Customer Result — **[MUST]** (single/multiple after-photos) · **[SOON]** before/after · A + W

1. **Purpose:** Collect consented, relevant result photos safely.
2. **User goal:** Show off (or warn about) the result easily.
3. **Hierarchy:** consent → choose photos → (label before/after) → upload → status.
4. **Sections:**
   1. **Consent screen (first time + whenever terms change):** "Share your result" · "Your photos may appear publicly on {Business}'s page and in discovery on APP_NAME, with your first name." · checkbox **"I have permission to share this image"** (required) · "Photos are checked before they appear" · link to guidelines. ("Automatically hide faces" toggle [LATER].)
   2. **Picker:** up to 4 photos; camera or library; client resizes to ≤2048px and strips metadata before upload (server strips again).
   3. **Labeling** [SOON]: for services with `allows_before_after`, mark one photo as Before and one as After.
   4. **Upload progress** per photo, retry per photo.
   5. **Status:** "In review — usually a few minutes" → later notification "Your result is live" or "One photo couldn't be published: it doesn't seem to show your {service}."
5. **Components:** `ConsentSheet`, `PhotoUploader`, `BeforeAfterLabeler` (Soon), `UploadProgress`.
6. **Main CTA:** **Share result** (with review) / **Upload** (when adding later from Booking Detail).
7. **Secondary:** remove photo, retake, skip.
8. **Empty:** n/a.
9. **Loading:** per-file progress bars; whole-form never blocks review submission (photos upload in background after review posts, within app session; on web, submit waits for uploads with progress).
10. **Errors:** file too large/unsupported (HEIC converted client-side where possible) → inline per file; upload failed → retry; rejected after moderation → notification with reason category (safety details never shown verbatim).
11. **Mobile:** native picker; camera access asked only when "Take photo" tapped.
12. **Desktop:** drag-and-drop zone.
13. **Edge cases:** uploading photos later (up to 30 days after visit) attaches them to the existing review (or creates a rating-less "result only" entry? **Decision:** results must attach to a review; if no review exists, require overall rating first); customer deletes a photo anytime → removed from public immediately (featured status cleared); image includes another person → customer confirmed permission; minors → manual review; duplicate of business portfolio image → rejected as "not your result".
14. **Scope:** MUST: consent, after-photos, moderation status. SOON: before/after pairs. LATER: face auto-blur, video clips.

---

## C17. Notifications — **[MUST]** (push + minimal inbox) · A (W: none — WhatsApp is the web channel)

1. **Purpose:** Durable record of booking-related messages; entry point to act on them.
2. **User goal:** See what changed and act.
3. **Hierarchy:** unread actionable → recent → older.
4. **Sections:** grouped **Today / Earlier**; notification rows (icon by type, one-line title, subline, time, unread dot). Types at launch: booking confirmed / request accepted / declined / reminder / cancelled by business / rescheduled by business / review request / review published or needs changes / result published or rejected / no-show dispute update. [SOON]: waitlist slot available (with **Reserve** button and countdown).
5. **Components:** `NotificationRow`, `SectionHeader`.
6. **Main CTA:** tap row → deep-linked screen.
7. **Secondary:** mark all read.
8. **Empty:** "No notifications yet. Booking updates will show up here."
9. **Loading:** skeleton rows.
10. **Errors:** standard.
11. **Mobile:** list; push permission requested **after first booking** ("Want a reminder before your appointment?"), not at first launch.
12. **Desktop:** n/a.
13. **Edge cases:** notification for a booking since cancelled → opens detail showing current state (never stale); push disabled → WhatsApp continues; retention 90 days.
14. **Scope:** MUST: transactional types. SOON: waitlist offers. LATER: promotions (opt-in only, separate category and toggle).

---

## C18. Profile / Settings — **[MUST]** · A (+ W lean `/account`)

1. **Purpose:** Identity, preferences, content ownership, privacy.
2. **User goal:** Update details, control notifications, manage my reviews/photos, delete account.
3. **Hierarchy:** identity → my content → preferences → support/legal → account actions.
4. **Sections:** name + phone (change phone = OTP on new number; warning that bookings made by businesses under the old number won't transfer automatically); **My reviews & results** (list, edit within window, delete); **Notifications** (channels: Push ✓, WhatsApp ✓, SMS fallback ✓; transactional messages can't all be disabled — at least one channel must stay on; marketing toggle default OFF [LATER]); **Language** (English at launch; Arabic [SOON]); **Location** (default area); **Help** (FAQ, contact support via WhatsApp); **Legal** (terms, privacy, review guidelines); **Log out**; **Delete account** (required by app stores).
5. **Components:** `SettingsList`, `ToggleRow`, `ConfirmSheet`.
6. **Main CTA:** none dominant (settings).
7. **Secondary:** all rows.
8. **Empty:** My reviews empty → "Your reviews will appear here after your visits."
9. **Loading:** standard.
10. **Errors:** phone change OTP errors as C10; delete account with upcoming bookings → must cancel them first (or auto-cancel with business notification — **Decision:** auto-cancel after explicit confirmation listing them).
11. **Mobile:** grouped list.
12. **Desktop (W):** simple page.
13. **Edge cases:** delete account → reviews removed, results removed, bookings anonymized for business records (business keeps visit history under "Deleted customer" without phone — business-owned CBP keeps name/phone they entered themselves if created manually; platform-sourced personal data removed); data export [LATER].
14. **Scope:** MUST: identity, my content, notifications, log out, delete account, help. SOON: Arabic UI, email. LATER: data export, marketing preferences, linked Google/Apple.

---

## Customer scope summary

| | Must Launch | Soon | Later |
|---|---|---|---|
| Acquisition (web) | C1, C7–C11, C12/C13 (via OTP/magic link), C15, C16 | Waitlist, Arabic UI, web favorites | Widget, staff links |
| Retention (app) | C2–C6 (business-level results), C12–C18 | Map, results on home, before/after, waitlists | Global visual discovery, face blur, promotions |

Explicitly **cut from MVP:** multi-service visits, add-ons, deposits/payments, promo codes, booking for a friend (Soon), map view (Soon), sponsored, global results discovery, data export, French.
