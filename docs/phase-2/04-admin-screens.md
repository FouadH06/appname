# Phase 2 · Part 4 — Admin Console

Separate origin (`admin.platform.com`), desktop-only (≥1280), 2FA required. Admin roles: **Moderator** (queues, reviews, media), **Support** (customers, businesses read + limited actions, disputes), **Ops** (onboarding, businesses, catalog), **Superadmin** (ranking, roles, everything).

Every mutating action requires a **reason code** (+ optional note) and writes an `AdminAction` (actor, role, action, subject, reason, before/after). There are no silent admin edits.

Legend: **[MUST]** · **[SOON]** · **[LATER]**.

---

## A1. Overview — **[MUST]** (lean)

1. **Purpose:** Operational heartbeat: queues, marketplace health per launch cluster, system alerts.
2. **User goal:** "What needs a human now, and is supply dense enough where we're marketing?"
3. **Hierarchy:** queues with SLA → cluster health → alerts → daily totals.
4. **Sections:**
   1. **Queue tiles:** Images awaiting review (n, oldest age) · Text awaiting review · Reports open · Disputes open (no-show / review / legal) · Fraud flags [SOON]. Tile turns warning when oldest item breaches SLA (target: moderation <2h daytime, disputes <48h).
   2. **Cluster health table** (Achrafieh/Mar Mikhael · Hamra/Verdun · Hazmieh/Baabda): live businesses by category vs target (15–25), bookings today / 7d, completion rate, no-show rate, % bookings from marketplace vs business link, searches with zero results (top queries).
   3. **Alerts:** WhatsApp delivery failure rate, OTP failure spike, moderation pipeline errors, booking commit error rate.
   4. **Daily totals:** new customers, new bookings, reviews posted, results posted.
5. **Components:** `QueueTile`, `DataTable`, `AlertList`, `KpiTile`.
6. **Main CTA:** click queue tile → A2 filtered.
7. **Secondary:** click cluster row → Businesses filtered; click zero-result query → Catalog synonyms.
8. **Empty:** queues at zero show "All clear" per tile.
9. **Loading:** tiles independent skeletons; auto-refresh 60s.
10. **Errors:** per widget.
11. **Mobile:** unsupported (message). *(Moderator mobile quick-review [LATER].)*
12. **Desktop:** 3-row grid.
13. **Edge cases:** cluster targets configurable; counts exclude test businesses (flag `is_test`).
14. **Scope:** MUST: queues, cluster health, basic alerts. SOON: fraud tile, SLA trends. LATER: revenue/billing metrics.

---

## A2. Moderation Queue — **[MUST]**

1. **Purpose:** Fast, consistent triage of content automation couldn't decide on.
2. **User goal (moderator):** Clear the queue accurately with minimal clicks.
3. **Hierarchy:** type tabs → priority-sorted list → preview → quick decision.
4. **Sections:** tabs **Images · Review text · Business replies · Business media** [SOON]; filters (reason flagged: safety / relevance / PII / abuse / spam / minor / duplicate; confidence band; cluster; age); sort default = **priority** (severity × age; reported items boosted); list rows: thumbnail (**blurred by default** if safety-flagged), snippet with flagged spans highlighted, AI decision + reason + confidence, booked service, business, age.
5. **Components:** `QueueTabs`, `FilterBar`, `QueueItem`, `BlurredMedia` (click to reveal), `KeyboardHint`.
6. **Main CTA:** open item → A3 (or quick-approve/reject from row with keyboard for obvious cases).
7. **Secondary:** bulk select for spam clusters (reject all from same account); claim item (prevents two moderators working the same item); skip.
8. **Empty:** "Queue clear" + last cleared time.
9. **Loading:** skeleton rows; realtime inserts new items at correct priority position (without shifting the row under the cursor).
10. **Errors:** item already decided by someone else → row greys "Handled by {name}".
11. **Mobile:** unsupported.
12. **Desktop:** list left (40%), preview pane right (60%) — selecting a row loads A3 in the pane (no page change); `J/K` navigate, `A` approve, `R` reject (reason picker), `M` more, `E` escalate.
13. **Edge cases:** moderator wellbeing — gore/sexual content stays blurred with reveal-on-hold, daily exposure counter [SOON]; items older than 24h escalate; CSAM-suspected content → special protocol: never displayed, auto-escalate to superadmin, preserved per legal requirements, account locked.
14. **Scope:** MUST: images + text + replies tabs, priority, filters, claim, keyboard. SOON: business media tab, wellbeing counters. LATER: moderator QA sampling, performance stats.

---

## A3. Moderation Detail — **[MUST]**

1. **Purpose:** Make a well-informed, explainable decision with full context.
2. **User goal:** Understand what it is, where it came from, who posted it, what the machine thought — then decide.
3. **Hierarchy:** content → booking context → machine assessment → author history → decision panel.
4. **Sections:**
   1. **Content:** image(s) at full size (blur toggle) or text — **original** (as written, `dir=auto`) + **normalized** (Arabizi → Arabic, internal) + **English translation**; PII spans highlighted.
   2. **Booking context:** business, service booked (canonical), staff, visit date, trust tier, booking source, review ratings.
   3. **Machine assessment:** per pipeline stage — validation, hash match (with matched image shown), safety scores, OCR text, relevance score + expected subjects ("hands/nails"), minors/faces flags, text classifier JSON (categories, target, severity, confidence), model versions.
   4. **Author:** account age, reviews count, prior moderation outcomes, warnings, fraud signals, device/IP cluster size (no raw IPs shown to Moderator role).
   5. **Report context** (if reported): reporter (business/customer), reason, their note.
   6. **Decision panel:** **Approve** · **Reject** (reason code required) · **Approve with redaction** (select spans) · **Remove image only** · **Remove text, keep ratings** · **Warn user** · **Suspend user** (Support/Superadmin) · **Escalate**; message preview to author (templated, localized); internal note.
5. **Components:** `MediaViewer`, `TextTriptych` (original/normalized/translated), `StageResultList`, `AuthorPanel`, `DecisionPanel`, `TemplatePreview`.
6. **Main CTA:** **Approve** or **Reject**.
7. **Secondary:** redact, partial remove, warn, suspend, escalate, view full review, open business, open author.
8. **Empty:** n/a.
9. **Loading:** content first, assessment panels stream.
10. **Errors:** decision conflict (already decided) → show final decision, disable panel; storage fetch failure for private image → retry (signed URL regenerated).
11. **Mobile:** unsupported.
12. **Desktop:** content left, context/assessment/decision right.
13. **Edge cases:** profanity about the service vs abuse of a person (matrix from Phase 1 §10 shown as a hint next to the classifier output); review text in dialect the classifier misread → moderator overrides and flags "model error" for later evaluation; redaction preserves original privately; decisions on business replies follow the same flow but notify the business member.
14. **Scope:** MUST all. SOON: "model error" feedback dataset export. LATER: second-opinion workflow.

---

## A4. Businesses — **[MUST]**

1. **Purpose:** Onboard, oversee, verify and (if needed) suspend businesses.
2. **User goal (ops):** Create and launch businesses quickly; find any business and its issues.
3. **Hierarchy:** list with filters → business detail tabs.
4. **Sections:**
   - **List:** search; filters (cluster, category, status: Draft / Live / Paused / Suspended, verified, onboarding stage, owner claimed?); columns: name, area, category, status, live since, bookings 30d, rating, open reports.
   - **+ Create business (assisted onboarding):** runs the B1 wizard *on behalf of* the business, then **Send owner invite** (WhatsApp).
   - **Detail tabs:** **Profile** (read + edit-as-ops, all edits audited) · **Onboarding checklist** · **Members** (roles, invites, reset owner) · **Bookings** (stats + list) · **Reviews & results** · **Reports/disputes** involving the business · **Quality score** (components + "why this rank") · **Audit** (all changes by business members and admins).
   - **Actions:** publish/unpublish, pause online booking, verify [SOON], suspend (reason; public page shows neutral unavailable), mark as test.
5. **Components:** `DataTable`, `FilterBar`, `Tabs`, `WizardEmbed`, `ActionMenu`, `ScoreBreakdown`.
6. **Main CTA:** **+ Create business**.
7. **Secondary:** send invite, publish, suspend, open public page, view as business (read-only impersonation) [SOON].
8. **Empty:** "No businesses yet" + Create.
9. **Loading:** standard; server pagination.
10. **Errors:** duplicate detection on create (phone / name + area) → warning with link; suspend blocked when upcoming bookings exist → choose notify & cancel vs keep bookings valid.
11. **Mobile:** unsupported. *(Ops onboarding on-site uses the business dashboard on a phone/tablet with an ops account, not admin.)*
12. **Desktop:** list + detail page.
13. **Edge cases:** ownership disputes (two people claim) → Support flow with document proof [SOON]; business requests deletion → closes profile, retains bookings/reviews per retention policy, reviews stay as historical? **Decision:** closed business page shows "Permanently closed" with reviews hidden from discovery; data retained for legal period.
14. **Scope:** MUST: list, create/assisted onboarding, detail tabs (profile, checklist, members, bookings, reviews, audit), publish/pause/suspend. SOON: verification, impersonation, ownership transfer. LATER: subscription controls.

---

## A5. Customers — **[MUST]**

1. **Purpose:** Support customers and act on abusive or fraudulent accounts.
2. **User goal (support):** Find a person by phone, understand their history, fix or sanction.
3. **Hierarchy:** search → profile summary → tabs.
4. **Sections:** search (phone, name, booking ref); **profile:** name, phone, joined, status (active/warned/suspended), **reliability internals** (score, contributing events with dates and businesses — visible to admin only; the business sees just the coarse label), trust/fraud score; tabs: **Bookings** · **Reviews & results** · **Disputes** · **Devices & signals** [SOON] · **Notifications log** (delivery status per channel) · **Audit**.
5. **Components:** `SearchInput`, `ProfileHeader`, `ReliabilityBreakdown`, `Tabs`, `ActionMenu`.
6. **Main CTA:** search.
7. **Secondary:** warn, suspend/unsuspend, **forgive a no-show** (reliability adjustment with reason), resend booking confirmation, force logout.
8. **Empty:** no match → "No customer with that phone".
9. **Loading:** standard.
10. **Errors:** standard.
11. **Mobile:** unsupported.
12. **Desktop:** header + tabs.
13. **Edge cases:** customer asks for account deletion via support → trigger same flow as C18; phone number recycled by carrier (new owner of old number) → support can detach old history [SOON]; shadow customers (no account) are searchable by phone but only show aggregated booking counts (their records belong to businesses).
14. **Scope:** MUST: search, profile, bookings/reviews tabs, reliability view + forgive, warn/suspend, notification log. SOON: device signals, number recycling. LATER: account merge.

---

## A6. Reviews — **[MUST]** (search + detail)

1. **Purpose:** Platform-wide view of reviews with trust metadata; the place to adjust weight or remove after investigation.
2. **User goal:** Investigate suspected manipulation or a specific complaint.
3. **Hierarchy:** filters → table → review detail.
4. **Sections:** filters (business, cluster, stars, trust tier, status: live/held/removed, flagged by fraud, date); table: date, business, author, stars, tier, weight, fraud multiplier, status; **detail:** full review (all parts with per-part moderation status), booking record + event timeline, author panel, fraud signals, weight explanation (tier × decay × fraud multiplier), history (edits, moderation decisions, reports).
5. **Components:** `DataTable`, `ReviewDetail`, `WeightExplainer`, `Timeline`.
6. **Main CTA:** open review.
7. **Secondary:** remove part / all (reason), **quarantine weight** (set fraud multiplier to 0 pending investigation — reversible) [SOON], restore.
8. **Empty:** "No reviews match."
9. **Loading:** standard.
10. **Errors:** standard.
11. **Mobile:** unsupported.
12. **Desktop:** table + side drawer detail.
13. **Edge cases:** review whose business got a no-show dispute resolved in business's favor → auto-removed with audit entry "dispute outcome"; bulk quarantine of a suspicious cluster [SOON].
14. **Scope:** MUST: search, detail, remove parts. SOON: weight quarantine, cluster actions. LATER: weight override UI beyond quarantine.

---

## A7. Reports & Disputes — **[MUST]**

1. **Purpose:** Resolve conflicts between customers and businesses fairly, with evidence and an audit trail.
2. **User goal (support):** Decide quickly with full context; notify both sides.
3. **Hierarchy:** type tabs → SLA-sorted list → case detail.
4. **Sections:**
   - **Tabs:** **Content reports** (business→review/result, customer→business) · **No-show disputes** · **Review disputes** ("customer never attended") · **Legal requests** (defamation claims, lawyer letters, law-enforcement — restricted to Superadmin) · **Business reports** (customers reporting a business: fake listing, harassment) [SOON].
   - **Case detail:** parties; claim + statements from each side; **booking event log** (created by whom, source, reminders delivered/read, confirmations tapped, status changes with actor and time — the key evidence); customer reliability history (admin view); business's dispute history (win/loss pattern, e.g., many no-show marks later contested); attachments; resolution options:
     - No-show dispute → **Uphold no-show** / **Overturn** (booking → completed; reliability restored; review eligibility kept) / **Void** (neither side penalized).
     - Review dispute → **Keep** / **Remove text** / **Remove image** / **Remove review** / **Warn** / **Suspend**.
     - Legal → **Keep with note** / **Geo-restrict** [LATER] / **Remove** (reason + legal reference) — always recorded.
   - Templated messages to both parties (localized).
5. **Components:** `CaseList`, `CaseDetail`, `EvidenceTimeline`, `ResolutionPanel`, `MessagePreview`.
6. **Main CTA:** **Resolve**.
7. **Secondary:** request more info (message to party, case → Waiting), assign, escalate, internal notes.
8. **Empty:** "No open cases."
9. **Loading:** standard.
10. **Errors:** case changed by another agent → refresh with notice.
11. **Mobile:** unsupported.
12. **Desktop:** list left, case right.
13. **Edge cases:** both sides unresponsive past 7 days → default rules (no-show dispute with reminder-confirmed evidence → overturn; otherwise void); business abusing reports (high rejection rate) → reporting limited + flagged; the same customer disputing repeatedly → lower weight to their claims; legal holds prevent deletion of related content even if the customer deletes their account (content hidden, retained).
14. **Scope:** MUST: content reports, no-show disputes, review disputes, legal requests tab (manual process). SOON: business reports, default-rule automation. LATER: appeals workflow.

---

## A8. Catalog Management — **[MUST]**

1. **Purpose:** Own the taxonomy that powers search, relevance moderation, rating dimensions and future categories.
2. **User goal (ops):** Add services/synonyms, fix zero-result searches, prepare new categories without code.
3. **Hierarchy:** categories tree → canonical services → synonyms / config.
4. **Sections:**
   1. **Categories:** tree (Beauty & Grooming › Barber, Hair salon, Nails, Lashes & Brows, Makeup, Spa, Beauty center, Aesthetics [hidden]); per category: **rating dimensions** (ordered list, labels EN/AR), `allows_before_after`, `requires_consultation` default, live flag.
   2. **Canonical services:** name EN/AR, category, typical duration, **synonyms** (EN / AR / FR / Arabizi; e.g., Barber: "7ala2", "حلاق", "coiffeur homme"), **relevance hints** for image moderation ("hair", "hairstyle", "hair color"), before/after allowed, usage count (businesses mapping to it).
   3. **Suggestions inbox:** "Other" mappings from businesses (B8) → map to existing or create new.
   4. **Search tester:** type a query in any script → see how it's normalized, which canonical services/businesses match, and in which cluster. Linked from zero-result queries (A1).
   5. **Locations:** governorate › district › area; cluster membership; live flag per area; area aliases ("Achrafieh / Ashrafieh / الأشرفية").
5. **Components:** `TreeView`, `DataTable`, `SynonymEditor` (chips by language), `SearchTester`, `SuggestionInbox`.
6. **Main CTA:** **+ Canonical service** / **+ Synonym**.
7. **Secondary:** merge canonical services (remaps business services, audited), deactivate, reorder dimensions.
8. **Empty:** seeded at launch (catalog + Lebanese areas are migration seed data), so never empty in practice.
9. **Loading:** standard.
10. **Errors:** duplicate synonym across services → warning (allowed but flagged ambiguous); deactivating a service in use → blocked until remapped.
11. **Mobile:** unsupported.
12. **Desktop:** tree left, editor right.
13. **Edge cases:** changing rating dimensions for a category with existing reviews → old dimension data retained, hidden from display; synonyms changes trigger search document refresh (background job); new category (e.g., Dentists) prepared hidden and launched by flag.
14. **Scope:** MUST: categories, dimensions, canonical services, synonyms, locations, suggestions inbox. SOON: search tester, merge. LATER: per-category booking rule templates.

---

## A9. Ranking Configuration — **[MUST]** (versioned config + publish) · **[SOON]** (simulation)

1. **Purpose:** Tune how organic ranking and discovery labels work — transparently, reversibly.
2. **User goal (superadmin):** Adjust weights safely and understand consequences before publishing.
3. **Hierarchy:** active version → draft editor → impact preview → publish/rollback → inspector.
4. **Sections:**
   1. **Versions list:** version, author, published at, reason, active flag.
   2. **Draft editor:**
      - **Quality score weights** (must sum to 100): rating quality 35 · verified volume 20 · recent quality 15 · reliability 10 · completeness 10 · responsiveness 10.
      - **Bayesian parameters:** prior strength C (default 10), prior mean source (category × cluster mean), time-decay half-life (180 days), recent window (60 days).
      - **Trust weights:** Verified Booking 1.0 · Verified Visit 0.5 · Verified Visit cap 40%.
      - **Query-time weights:** quality 0.55 · proximity 0.20 · availability fit 0.15 · personal 0.10; new-business boost amount + decay (60 days).
      - **Discovery label rules:** thresholds per label (e.g., Top Rated: display mean ≥4.7 AND ≥25 verified reviews AND top 20% quality in category×cluster; Highly Rated for Cleanliness: cleanliness ≥4.7 with ≥20 ratings; Great Punctuality: punctuality ≥4.7 with ≥20; Popular Near You: top 15% completed bookings in 30d in cluster; Best Value: value-for-money ≥4.6 AND price level ≤ category median; Available Today: has slot today; New on APP_NAME: live <60 days) + label priority order (max 2 per card).
   3. **Impact preview** [SOON]: pick cluster + category/query → current vs draft top 20 side-by-side with movement arrows; label gains/losses count.
   4. **Publish** (reason required) → recompute job; **Rollback** to any version (one click, reason required).
   5. **"Why this rank" inspector:** pick business (+ optional query) → component values, raw inputs, applied version.
   - Sponsored placement settings [LATER] live on a separate page and cannot modify organic weights (enforced in code).
5. **Components:** `VersionList`, `WeightEditor` (numeric inputs + sum indicator), `RuleEditor`, `DiffViewer` (draft vs active), `ComparisonTable` (Soon), `ScoreBreakdown`.
6. **Main CTA:** **Publish version**.
7. **Secondary:** save draft, rollback, inspect.
8. **Empty:** version 1 seeded with Phase 1 defaults.
9. **Loading:** recompute progress indicator after publish (scores update in background; previous version stays active until recompute completes, then atomic switch).
10. **Errors:** weights ≠ 100 → can't publish; invalid thresholds → inline; recompute failure → stays on previous version + alert.
11. **Mobile:** unsupported.
12. **Desktop:** editor left, diff/preview right.
13. **Edge cases:** at launch (50–70 businesses), labels with too-high thresholds produce no labels → preview shows label counts so thresholds can be set for small-market reality; changing weights never changes displayed ratings (display mean ≠ ranking score by design).
14. **Scope:** MUST: versions, editor, publish/rollback, inspector. SOON: impact simulation. LATER: A/B testing of configs.

---

## A10. Audit Log — **[MUST]**

1. **Purpose:** Immutable record of who changed what — for accountability, disputes and security.
2. **User goal:** Answer "who did this, when, and why?"
3. **Hierarchy:** filters → chronological list → diff detail.
4. **Sections:** filters (actor, actor type: admin / business member / system, action type, subject type + ID, business, date range); rows: time, actor (+role), action, subject, reason; **detail:** before/after `DiffViewer`, request metadata (admin only: IP, user agent), linked case/report.
   - Sources unified in the view: `admin_actions` (all admin mutations), business-side sensitive events (role changes, settings changes, service price changes, staff archive, booking status changes via `booking_events`), system actions (auto-complete, auto-expire, moderation automated decisions).
5. **Components:** `FilterBar`, `DataTable`, `DiffViewer`.
6. **Main CTA:** filter/search.
7. **Secondary:** open subject, export [SOON].
8. **Empty:** "No events match these filters."
9. **Loading:** standard; cursor pagination.
10. **Errors:** standard.
11. **Mobile:** unsupported.
12. **Desktop:** table + drawer.
13. **Edge cases:** append-only (no update/delete grants even for superadmin at DB level); PII in diffs masked for non-superadmin roles; retention per policy (e.g., 2 years) with legal-hold exceptions.
14. **Scope:** MUST: unified view, filters, diffs. SOON: export, saved filters. LATER: anomaly alerts on admin behavior.

---

## Admin scope summary

**Must Launch:** Overview (queues + cluster health), Moderation Queue + Detail, Businesses (with assisted onboarding), Customers (with reliability forgive), Reviews (search/remove parts), Reports & Disputes (incl. legal tab), Catalog (incl. synonyms & locations), Ranking config (versioned publish/rollback + inspector), Audit Log.

**Soon:** fraud dashboard, impact simulation, search tester, verification, impersonation, weight quarantine, exports.

**Later:** subscriptions/billing, sponsored placements, A/B ranking tests, moderator QA.
