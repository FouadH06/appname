# M9 — Verified reviews, moderation & fraud pre-checks: report

Status: **implemented, awaiting review** · Branch `m9-reviews` (not merged)

Hosted staging verification stays deferred with M4–M8 (M4 report checklist, now including M9) and
is mandatory before any real users. Three decisions are needed from you (end of this report): the
review message copy, the moderation model / cost, and the strictness while no LLM key is set.

## What was implemented

| Area | Contents | Spec |
|---|---|---|
| Reviews core | One review per completed booking, only by its customer (never a member, staff or anyone with a member's phone), within 30 days; **tier frozen at creation** (`verified_booking` 1.0 for online bookings, `verified_visit` 0.5 for business-logged visits); overall stars + optional category dimensions + optional comment (20–2000); one edit within 7 days; author delete; idempotent submit; 5 reviews/day per account | Part 4 §1 |
| Independent moderation | **Stars are published at once** (after the in-transaction fraud pre-check); the **comment waits** for the text pipeline; business replies go through the same pipeline. One predicate decides what counts (`rating_is_counted`: published + active + weight > 0) for the list, the summary and staff stats | Part 4 §1.1, §3 |
| Fraud pre-check | In the submit transaction: new account without earlier visits (0.3), device shared with another reviewer of the business (0.5 + 0.1 per author, max 0.9); ≥ 0.5 → **quarantined** (not counted, fraud case opened). Nightly job: near-duplicate text across reviewers (pg_trgm > 0.8 → later copy quarantined), weekly review bursts (business signal) | Part 4 §6 |
| Text pipeline (`moderate` Edge Function) | pgmq queue → rules (phones in Latin/Arabic digits incl. Lebanese formats, emails, handles, links, spam phrases; lira amounts aren't phones) → normalisation + language detection (ar / en / fr / Arabizi / mixed, rough Arabizi→Arabic reading) → classifier → decision matrix: threat / hate / sexual harassment / spam → **reject** (author gets "edit your comment" and may edit within 7 days); insults aimed at a person or classifier unsure (< 0.70) / refused → **human**; personal data only → **published with it removed**; otherwise approve. Every stage recorded; a result is applied only if the text is still exactly what was classified | Part 4 §3 |
| Classifier | `ClaudeClassifier` on the official Anthropic SDK: model from `LLM_MODEL` (default `claude-opus-5`), structured JSON output, cached system prompt, the review passed as data, server-side `fallbacks: "default"`, refusal/unusable answer → human, network errors → retried by the queue. `HeuristicClassifier` (keywords EN/AR/FR/Arabizi) for local/CI and when no key is set (**strict on hosted**: never publishes a comment on its own) | — |
| Translations | "See translation" on public reviews/replies (English-first UI): cached per text + language, queued to the worker (Claude), polled by the page; edits drop the cache; at most one job per text + language every 10 min | Part 4 §6 |
| Review request | WhatsApp 2 h after a completed visit, **moved out of quiet hours**; link = review token, or a claim link for a visit the business logged for someone without an account (verify phone → claim → review). "Your comment couldn't be published" message on rejection (pipeline or moderator). Team alert "New review" to owners/managers | Part 4 §2, M7 |
| C15 review page | `/review/{token}` (phone verification, claim if needed) and `/bookings/{id}/review` ("Leave a review" on completed bookings): visit summary with tier badge, 5 large stars, optional dimensions, optional comment (any language, phone-number hint), post → "Your rating is live. Your comment will appear after a quick check."; status, one edit, delete | Phase 2 C15 |
| C1 business page | "★ 4.6 · 23 verified reviews" (average only from 5 counted reviews; "New on APP_NAME · N verified reviews so far" before that); Reviews section with dimension averages, newest-first list (author first name + initial, tier badge, month of visit, service · staff, comment, business response), Show more, See translation | Phase 2 C1 |
| B10 dashboard reviews | Summary (rating, count, response rate, needs reply); tabs Needs reply / All / Reported; reply (moderated; state shown), edit/delete reply; **report** (reason sheet → moderation case, or attendance dispute for "never came"; max 10 open reports); notice that businesses can't hide or remove reviews; no reviewer phone, no CRM link | Phase 2 B10 |
| A2/A3 admin | Moderation queue (open / escalated / decided; source, priority, SLA), case detail (content, checks per stage, report, author signals), claim (15 min), decide with reason code (approve / approve redacted with edited text / reject / remove text / remove review / escalate; fraud cases: dismiss / confirm), warn or (support) suspend the author; every decision audited | Phase 2 A2–A3 |

## Migrations created

| File | Contents |
|---|---|
| `20261005100000_m9_reviews.sql` | Config, tables, eligibility, fraud pre-check + nightly job, submit/edit/delete, read models, replies, reports, admin cases/decisions, pgmq queues |
| `20261005100100_m9_review_notifications.sql` | Routes, review link, review request scheduling (quiet hours), reception/management alert split, completion hook |
| `20261005100200_m9_review_templates.sql` | EN/AR WhatsApp (+ SMS rows) for the 3 new messages — generated by `scripts/notification-templates.py` |
| `20261005100300_m9_moderation_worker.sql` | `moderation_claim` / `moderation_record`, human hand-off, rejected-comment message trigger, translations (request / claim / record), `app_moderate` cron via Vault |
| `20261005100400_m9_business_page_rating.sql` | `get_business_page` returns the rating summary (same function otherwise) |

## Tests executed

| Layer | Result | What it proves |
|---|---|---|
| pgTAP | **713/713** (71 new in `280_reviews`) | Eligibility (not before completion, 30-day window, someone else's visit, members, anonymous sessions); tier + weights frozen; idempotent submit; one per booking; **stars published while the comment is pending, hidden text**; average hidden under 5; worker RPCs service-role only; stale results ignored; approve / reject / human / redacted applied; stage audit; private classifier data; pipeline case; rejected comment → message with edit link, stars still counted; **phone never public**; shared device → quarantine + fraud case; summary counts only counted reviews; page rating; admin needs MFA; dismiss restores, confirm removes, audited; reception can't reply/report; reply moderated then shown; no reviewer phone for the business; report → case / "never came" → dispute; remove text resolves the report; translations only for public text, cached; one edit; delete recomputes; **review request queued after completion**; nightly duplicate detector |
| Edge unit | **69** (+1 opt-in LLM eval) | Digits, language detection, Arabizi; phones in all formats (not lira amounts), emails/handles/links/spam; redaction; decision matrix; heuristic; **Claude request type-checked against the SDK's own types** (cached system prompt, structured output, `fallbacks: "default"`); refusal → human, bad output → human, network error → retry; config (model default, strict on hosted, no echo translations on hosted); worker records stages, retries temporary errors |
| Moderation eval | 206 labelled + 30 held out (EN 80 · AR 58 · FR 33 · Arabizi 34 · mixed 31) | See below |
| E2E web (local stack) | **16 passed** (1 new) | **Review link** (claim a business-logged visit) → verify phone → 5 stars + dimension + comment with a phone number (hint shown) → "rating is live" → worker publishes the comment **with the number removed** → business page shows it (tier badge, no number) → manager replies (moderated, appears after the worker) and reports ("under review") |
| E2E admin | **1 passed** (extended) | Moderator opens the queue → case → claim → approve with reason → text approved, decision audited |
| Unit, lint, typecheck, format, DB lint, builds | ✅ | |

### Moderation quality (eval)

| Classifier | Items | Accuracy | Held back: precision / recall | Harmful published | Benign held back |
|---|---|---|---|---|---|
| Heuristic, tuned set | 206 | 100 % | 100 % / 100 % | 0 | 0 |
| **Heuristic, held out** | 30 | 56.7 % | 100 % / **18.8 %** | **13 of 16** | 0 |
| Claude (`claude-opus-5`) | 236 | not run — needs an API key | | | |

The keyword lists were tuned on the 206 items (the first run found 19 harmful texts published:
French threats/hate, group generalisations, Arabic sexual comments without a Latin name, French spam
links), so that row is a regression floor, not a quality claim. The held-out row is the honest
number: keywords miss insults and threats they don't contain. Hence the **strict mode** on hosted
projects without a key, and the LLM run is a pre-launch step.

## Found while implementing (fixed)

- `app_owner` (owner of the definer functions) could not use pgmq or read `auth.users` → queue grants
  limited to the two queues; account age read from `profiles`.
- Decision → state mapping (`approve` → `approved`) caught by pgTAP.
- **Existing time-of-day test failures** (diagnosed, not assumed): `240_calendar` (M6) fails between
  09:00 and 10:00 Beirut — a "block my own time" step at `now() + 3 days` collided with a 10:00
  booking on day 3 → fixed times. `public-booking` e2e (M8) fails during working hours — the first
  free slot is minutes away, inside the 120-min cancellation window, so Reschedule is correctly
  hidden → that test business uses a 0-minute window. Both passed before only at other hours.
- The local edge runtime container exited after the machine restart (503s in two specs); a clean
  stack restart fixed it — environment, not code.

## Deviations for your approval

| # | Spec | Change | Why |
|---|---|---|---|
| D1 | Part 4 §3 LLM | Claude via the official SDK, default **`claude-opus-5`**, configurable with `LLM_MODEL`; one call per comment/reply, one per translation | Most capable default; **the model/cost choice is yours** (a cheaper model can be set without code changes — run the eval first) |
| D2 | Part 4 §3 | Without `ANTHROPIC_API_KEY`: keyword classifier; on hosted projects **strict** (it may reject/redact, every other comment waits for a moderator); no translations on hosted | Held-out recall 18.8 % — not safe to auto-publish |
| D3 | Part 4 §2 | Review request 2 h after the visit **respects quiet hours** (22:00 → sent 08:00) | Same rule as reminders (M7 decision) |
| D4 | Part 4 §1.2 | Business-logged visits without an account get a **claim link** in the review request (verify phone → claim → review, tier `verified_visit`) | Reviews need an account; reuses the M4 claim flow |
| D5 | C1 / M8 D10 | **Staff ratings still not shown** (computed in `staff_stats`); business average from 5 counted reviews | Keeps the M8 deferral; staff rating rules need their own review |
| D6 | Part 4 §6 | Device signal = random id stored on the device (not a fingerprint); IP clusters not implemented | Privacy-light; IP hashing needs `IP_HASH_SECRET` (later) |
| D7 | Part 4 §4 | "Never came" reports open a `review_attendance` dispute; outcomes (remove review, no-show upheld) are applied in the **M11** disputes admin | Disputes UI is M11 |
| D8 | Part 4 §6 | UI translates into **English** only (RPC supports ar/fr) | English-first customer UI (M8 decision) |
| D9 | A2/A3 | Minimal admin: no bulk actions, no appeals screen, no image cases | Images M10; appeals with M11 |
| D10 | M7 routes | Review messages are WhatsApp-only, non-critical: SMS rows exist but aren't sent | Review requests don't justify SMS cost |
| D11 | Tooling | Test numbers `70 000 013` / `014`; `@anthropic-ai/sdk` 0.129.0 pinned (dev dependency for type checks; `npm:` import in the function) | Review e2e; reproducible builds |

## Known gaps / notes

- **Not run yet**: the LLM eval and hosted moderation (need an Anthropic key on staging, which you
  set yourself with `supabase secrets set ANTHROPIC_API_KEY=…` — never share it in chat).
- Review photos are M10 (image pipeline); reports on photos/staff/users exist in the schema only.
- The 3 new WhatsApp templates must be submitted to Meta with the others.
- Reviews on the business page follow its 1-minute cache (a new review can take a minute to appear).

## Decisions needed

1. **Copy** of the 3 new messages (EN + AR, rendered in `docs/notifications/templates.md`):
   review request, "your comment couldn't be published", team alert "New review".
2. **Model / cost**: keep `claude-opus-5` or choose another model — ideally after the LLM eval run.
3. **Until a key is set**: keep strict mode (moderators read every comment on staging), or allow
   the heuristic to auto-publish?

## Suggested manual checks

1. Complete a visit in the dashboard, open the review link on a phone: is rating in under 30 s realistic?
2. B10: are the report reasons and the "can't remove reviews" notice clear to a salon owner?
3. Admin queue: is the case screen enough to decide quickly?
