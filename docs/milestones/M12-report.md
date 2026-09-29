# M12 — Search & discovery: report

Status: **awaiting review** · branch `m12-search` (not merged)

Lean scope per the PO: deterministic, explainable ranking from the documented inputs; no ML, embeddings,
personalization or recommendations. Hosted verification is deferred with M4–M11 (M4 checklist, now
including M12).

## Built

| Area | Contents |
|---|---|
| Search documents | One row per publicly visible location (live, not test, live location): name key, categories (with parents), bookable canonical services (active + ≥1 public staff at the location, or "on consultation"), service/synonym/category terms, area terms, tsvector, audience, price level, **cheapest service per canonical with its next public slot**, rating, quality score, labels, cover. Triggers on businesses, locations, services, staff, hours, bookings, rating summary, media and synonyms enqueue locations; `app_search_refresh` (every minute) rebuilds them; `app_search_availability` (10 min) re-queues stale availability |
| Quality scores | `compute_quality_scores(version)`, set-based and deterministic (Part 5 §3): decayed review weights (counted reviews only), **Verified Visit cap**, Bayesian rating with a root-category × cluster prior (platform mean, then 4.0 as fallback) blended with dimensions, recent quality, volume percentile (completed bookings from counted sources), reliability, completeness (6 items), responsiveness (request acceptance time + reply rate). Components + raw inputs stored; daily history; runs nightly (`app_quality_scores`) and **on ranking publish before the switch** (closes M11 D1) |
| Price levels | Each priced service vs the median of the same canonical service in the cluster → $–$$$$ |
| Labels | Top rated, Spotless (cleanliness), On time (punctuality), Great value, Popular nearby, New — from the active config's rules; Available today computed at query time; max 2 per card by priority |
| Search | `search_businesses`: intent from the text (exact / whole-word service names and EN/AR/FR/Arabizi synonyms, categories, **an area named in the query**, business names); **text is a gate, never a score**. Filters: cluster, area, For women/men, price levels, min rating, distance, available today, date + time window (availability engine for at most the top 40). Sorts: recommended (config query weights: quality, proximity, availability fit, personal = booked here before, new boost), nearest, highest rated, price, soonest. Service queries show that service's price, duration and next slot. "Also nearby" when a cluster has < 3 results. "Not on APP_NAME yet" for hidden categories or unmatched text |
| Suggest | Services (prefix / word / fuzzy, closest term, then places offering it nearby), businesses, areas |
| Discovery | `get_home` (clusters, categories, available today, top rated, new, popular services), `get_landing(area, category)` (area or cluster slug), `get_public_business_slugs` (sitemap) |
| Logging | `private.search_log` (query, key, cluster, service, count, hashed user); admin **zero-result queries** |
| Admin | Overview "Searches with no results" card → catalog; Ranking page **search debugger** (score parts per card, intent); "why this rank" now shows components, labels, price level and documents |
| Web | Home `/` (hero search, cluster picker, categories, rails hidden under 3 items), search box (typed suggestions, recents, keyboard), `/search` results (URL-driven filters/sort/paging, honest empty states, "Near me"), `/explore`, SEO landing `/{area}/{category}` (reserved slugs; indexable, 5-min cache), `sitemap.xml`. The M0 foundation page moved to `/foundation` |

## Ranking decisions

- **Text relevance is a gate**; the recommended score is `quality × w_q + proximity × w_p + availability × w_a
  + personal × w_pers + new boost`, weights from the active ranking config. Ties broken by quality, name,
  location id → identical inputs always give identical order (tested).
- **Bayesian prior:** mean of counted, decayed ratings in the business's root category × cluster; platform
  mean, then 4.0, when a scope has no reviews yet. "3 × 5★ doesn't outrank 100 × 4.8★" holds against a normal
  market prior (tested).
- **Verified Visit cap** applied literally (visit weight ≤ 40 % of the total). A business with only
  business-logged visits and no online bookings therefore rests on the prior until it gets online bookings —
  as the locked decision intends.
- **Personal** = the signed-in customer completed a booking here before (0.7). Favorites (1.0) arrive with
  favorites. Server-rendered web results use the anon key, so web search is not personalized.
- **Displayed rating ≠ ranking score**: cards show the plain verified mean; the Bayesian value stays internal.
- "Highest rated" sorts by displayed rating (review count breaks ties), so a 5.0 with few reviews can lead
  that sort; Recommended is the default.

## Performance (generated launch-like dataset, local stack)

`scripts/search-review.sql` builds a deterministic marketplace (3 clusters × their areas × 7 categories,
EN/AR/FR names, 2–5 priced services, staff, hours, completed bookings, reviews with dimension ratings),
runs the 32 review queries and times every public entry point (10 runs each). All in one rolled-back
transaction.

| Scale | Documents | search p50 / p95 | suggest p95 | home p95 | search + date window p95 |
|---|---|---|---|---|---|
| Launch (~100 businesses) | 111 | 17.9 / **33.5 ms** | 7.3 ms | 11.3 ms | 35.5 ms |
| Headroom (~1,000) | 1,044 | 20.1 / **27.3 ms** | 10.2 ms | 20.0 ms | 193.4 ms |

Target: search p95 < 300 ms — met at both scales, including the worst case (date + time window).

**Bottleneck found and fixed:** the refresh trigger's enqueue used `location = X or business = Y` in one
`WHERE`, which defeated both indexes, so every booking/review/staff insert scanned all locations (the
1,000-business dataset took > 30 min to generate). Split into two indexed branches + an index on
`business_locations(business_id)` → 65 s. Next slots are precomputed per location and service in the refresh job, so
cards never run the availability engine; only an explicit date/time filter does, bounded to 40 candidates.

## Query review (32 representative queries, launch scale)

Top results were sensible for all 32: EN / AR / FR / Arabizi service names ("7ala2", "حلاق", "coiffeur homme",
"بالياج", "manucure"), areas inside queries ("balayage hamra", "pedicure achrafieh", "beard trim verdun"),
business names in Latin and Arabic script, category words, filters (available today, rating 4.5+), price and
soonest sorts. "dentist" → "Not on APP_NAME yet" (logged as zero-result). Observations: the new-business boost
can lift a recently published business slightly above a higher-quality one (by design, visible in the
debugger); "available today" is empty after closing time in the dataset (correct).

## Tests

| Layer | Result | Covers |
|---|---|---|
| pgTAP | **899/899** (46 new in `310_search`) | Visibility (paused/test excluded, private-staff service not searchable, refresh drops paused), next slot precomputed, no direct table access; intent (Arabizi, Arabic with tatweel/shadda, French synonym, Arabic service name, text gate, area in query, EN/AR business names, not offered incl. hidden category); filters (audience, cluster, distance, available today, min rating), deterministic order, sort fallback, invalid sort; ranking (Bayesian vs volume, quarantined review excluded, Verified Visit cap, determinism, history, price level); config integration (publish recomputes with the new version; quality-only vs proximity-only weights change the order); zero-result log, admin zero-results + debug (ops) and moderator forbidden; suggest, landing, 404 landing |
| Web E2E | full suite: 17 passed, 13 skipped (project split); 2 failures on the first gate run, both resolved: the new search spec (race with the per-minute refresh cron → the helper now builds the business's documents synchronously; passes on mobile + desktop) and the M4 lab-booking spec on mobile (unchanged code; passed on rerun — local flake) | Search: suggestion by name → business page; Arabizi search in a cluster → card with service price and Book link; filter removes and restores; SEO landing title + cards; "dentist" → not offered + logged |
| Admin E2E | **1 passed** | Unchanged flows + overview (with the zero-result card) |
| Unit, lint, typecheck, format, web + admin build | ✅ | |

## Known issues / deferred

- Web search is not personalized (server-rendered with the anon key); "booked here before" applies to
  signed-in API calls. Favorites-based personal score and "Book again" rails: with favorites (not M12).
- Impact preview for ranking drafts (A9 Soon), map view, staff-name search, sponsored results: later.
- Label thresholds are the Phase 1 defaults; with 50–70 real businesses some labels will be rare — tune in A9
  after pilot data (the debugger and "why this rank" show the inputs).
- Search p95 must be re-measured on staging hardware (M4 checklist) and with the top 30 real pilot queries.
- Found and fixed during the gate: business suggestions returned the first five matches by id rather than the
  best five (`DISTINCT ON` ordering) → now "name contains the text" first, then similarity; Supabase's
  safe-update guard rejected WHERE-less UPDATE/DELETE in the search core and score recompute via the API
  (pgTAP doesn't go through the API) → explicit `where true`.
