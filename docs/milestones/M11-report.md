# M11 — Admin console: report

Status: **awaiting review** · branch `m11-admin` (not merged)

Lean and operational, per the PO's M11 direction. Hosted verification stays deferred with M4–M10 (M4
checklist, now including M11) and is mandatory before real users.

## Built

| Screen | Contents | Roles |
|---|---|---|
| A1 Overview | Queue tiles (images, text, reports, disputes; oldest age, overdue warning), cluster health (live vs target, by category, bookings today/7d, completion, marketplace share), alerts (message failures, stuck queue, photo processing errors), today's totals; 60 s refresh | all admins |
| A4 Businesses | List (search by name/link/phone; status, cluster filters) → detail: profile, go-live checklist, members, 30-day stats, reports, disputes, ranking inputs, audit link. Actions: publish / pause / suspend / close — **suspend/close with upcoming bookings requires "keep" or "cancel + notify"**; verify (placeholder flag); test flag | read: moderator, support, ops · actions: ops |
| A5 Customers | Search by phone, name or booking ref → detail: status, **reliability internals** (score, tier, events with business), bookings with **forgive** per no-show, reviews, disputes, notification log. Actions: warn / suspend / reactivate (admins only by a superadmin; never yourself) | support |
| A6 Reviews | Filters (business, status, rating state, stars, text) → detail: parts and states, weight = tier × age decay × fraud multiplier, fraud signals, pipeline checks, cases, reports, booking timeline. Actions: quarantine (weight 0, reversible), restore, remove comment, remove review | moderator, support |
| A7 Disputes | Type tabs (no-show, review "never came", legal = superadmin), due-sorted → case: booking event log + messages sent (evidence), customer reliability, business no-show/dispute history, statements; internal note / ask the customer for more info (→ awaiting info, customer messaged); resolve with type-specific outcomes | support (legal: superadmin) |
| A8 Catalog | Services (synonyms with ambiguity flag, relevance hints, in-use guard), categories (live flag, defaults, rating dimensions hide/show), areas (live, aliases, clusters), cluster targets, suggestions inbox (map / create / reject) | ops |
| A9 Ranking | Versions, draft editor (quality weights sum to 100, query weights sum to 1, other params as JSON; validated server-side), publish / rollback (superadmin), "why this rank" inspector | read: ops · write: superadmin |
| A10 Audit log | Unified admin actions + business/system entity changes + booking events; filters (actor type, action prefix, subject, business, actor, dates), before/after drawer, paging; **PII masked for everyone but superadmin**; every detail page links to its trail | all admins |
| Global search | Header box: businesses, customers (support/superadmin), bookings by reference | all admins |

Backend: 4 migrations (`20261007100000_m11_admin`, `…100100_m11_disputes`, `…100200_m11_dispute_templates`,
`…100300_m11_catalog_ranking`). Shared UI kit in `apps/admin/src/components/ui.tsx` (shell, table, reason
dialog, data hook); reason codes in `apps/admin/src/lib/reasons.ts`.

**Dispute effects (Part 7 §7):** overturn → booking completed, penalty reversed exactly + visit credited,
review allowed for 30 days; uphold → unchanged; void → penalty reversed, booking stays as marked; review
outcomes keep / remove comment / remove review (summary recomputed); legal remove → review removed under
legal hold. Customer and business are messaged (no-show and review disputes). **Default rule** (daily
06:15): no admin action for 7 days → overturn if the customer confirmed the reminder, else void.

## Decisions / deviations for approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | A9 publish | Publish switches the active version **immediately**; the "switch after recompute" step arrives with `compute_quality_scores` (M12). "Why this rank" shows inputs until then | Scores are M12 scope |
| D2 | A8 / M1 policies | Catalog tables no longer accept direct writes (even ops); edits go through audited RPCs with a reason | "No silent admin edits" |
| D3 | Audit | Moderation claim / release / escalate and assisted onboarding now audited (earlier gaps) | Every meaningful admin action traceable |
| D4 | A7 | Messages to parties: "request more info" to the customer only; business-side replies stay in the dashboard flows | Keeps M11 lean |
| D5 | A5 | "Resend confirmation", "force logout", device signals, number recycling: not built | Soon/needs Auth admin API |
| D6 | A2 | Existing M9/M10 moderation screens kept (no bulk actions / keyboard shortcuts added) | Lean; they already work |
| D7 | A1 | Zero-result searches tile deferred to M12 (search log) | Search is M12 |
| D8 | Admin roles | Granting admin roles stays a SQL/ops step (no roles screen) | 1–2 operators at pilot |
| D9 | Copy | 2 new WhatsApp messages (`dispute_update`, `biz_report_resolved`, EN + AR) — **copy needs PO approval** ([templates](../notifications/templates.md)) | Dispute outcomes must reach both sides |

## Tests

| Layer | Result | Covers |
|---|---|---|
| pgTAP | **853/853** (81 new in `300_admin`) | **Role matrix**: aal1 admin and non-admins get nothing; moderator can't publish ranking / resolve disputes / change business status / read customers; ops can't work cases, quarantine, sanction or draft ranking; support can't edit the catalog or open legal cases; moderator search never returns customers. **One audit row** per action (status, verify, test flag, forgive, user status, quarantine / restore / remove, dispute resolve / message, catalog, ranking draft / publish / rollback, claim / release); reason required; audit rows immutable. **Dispute effects** (overturn / uphold / void, notifications to both sides, timeline event, re-resolve blocked, outcome-type guard, info request, default rule). Suspend with upcoming bookings (blocked → cancel path, customer notified, admin-attributed event). Quarantine / restore / remove and rating summary. Catalog in-use guard, ambiguous synonyms. Ranking validation, single active version. Audit filters, booking events in the unified log, PII masking |
| Admin E2E | **1 passed** (extended) | Sign-in + TOTP, onboarding, text + image moderation, then **M11**: overview tiles → resolve a no-show dispute in the UI (booking completed, audited) → **audit row reached in 3 clicks** → pause a business with a reason → global search by booking ref → ranking and catalog screens |
| Web E2E | **17 passed** (13 skipped by project) | Regression (booking, reviews, results, notifications, calendar) |
| Unit, lint, typecheck, format | ✅ | incl. dispute message sentences (EN/AR, per audience) |

## Known issues / notes

- Fixed on the way: the M7 notifications test failed between ~21:00–21:30 Beirut (a booking time relative to
  "now" collided with a fixed 23:30 booking) → fixed time.
- Admin UI is English-only and desktop-only (as specified).

## Deferred

Ranking recompute + impact preview (M12), zero-result searches (M12), bulk moderation / keyboard
shortcuts, roles management screen, impersonation, exports, fraud dashboard, business reports tab.
