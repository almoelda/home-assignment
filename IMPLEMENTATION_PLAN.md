# IMPLEMENTATION_PLAN.md — Creator Marketplace (WePush take-home)

Status: APPROVED DESIGN. ASSIGNMENT.md is the source of truth for requirements; this file is the source of truth for design decisions.
Do not silently change formulas, bidding rules, transaction semantics, dependencies, or scope. If you find a conflict or ambiguity, record it in DECISIONS.md and ask before deviating.

---------------------------------------------------------------------

## 0. Goals and non-goals

### Goals (in priority order)
1. The full loop works from the UI on a clean `docker compose up`, no DB access needed:
   create campaign -> creator sees ranked match + price guidance -> creator bids -> deadline passes -> worker closes -> both sides see results with reasons.
2. Closing is correct: transactional, idempotent, safe with concurrent workers, safe against bid/deadline races.
3. Matching and pricing are sensible, explainable, and honest about limits.
4. Code is cleanly layered, tested, and easy to explain in an interview.

### Non-goals (explicit; mention in README "What I skipped and why")
- Authentication/authorization (identity switcher only).
- Payments, invoicing, contracts, content delivery/approval, messaging.
- Real TikTok/Instagram API integration (profile metrics are seeded demo data).
- Profile or advertiser CRUD UI (seeded identities only).
- Weighted "fit score", ML ranking, audience-overlap modelling, conversion/ROI modelling.
- Kubernetes manifests/Helm, message queues, caches, microservice splitting.

### Unit of purchase
One sponsored short-form video per winning creator, published on the creator's profile platform. All views/CPM numbers refer to this deliverable.

---------------------------------------------------------------------

## 1. Stack and repo layout

- Language: TypeScript everywhere (strict mode). Node 22 LTS. pnpm workspaces.
- Frontend: React + Vite + React Router + TanStack Query (polling). Plain CSS or a light component lib; do not spend time on design systems.
- API: Fastify + zod for request/response validation.
- DB: PostgreSQL 16. Drizzle ORM + SQL migrations (use raw SQL where the query builder is awkward, notably row locks).
- Worker: separate Node process, same codebase.
- Tests: Vitest (unit + integration against a real Postgres, not mocks), Playwright (one E2E).
- Local runtime: Docker Compose. CI: GitHub Actions (lint, typecheck, test, build).

```
/
  apps/
    web/            # React UI
    api/            # Fastify HTTP server (thin: parse, call application, serialize)
    worker/         # polling loop (thin: calls application.closeDueCampaigns)
  packages/
    domain/         # PURE functions + types. No DB, no clock, no IO.
    application/    # transaction-aware workflows: placeBid, withdrawBid, createCampaign, closeNextDueCampaign
    db/             # schema, migrations, queries, seed
  docs/             # optional diagrams
  ASSIGNMENT.md  IMPLEMENTATION_PLAN.md  DECISIONS.md  CLAUDE.md  README.md
  docker-compose.yml  .github/workflows/ci.yml
```

Layering rules:
- `domain` contains eligibility, pricing, ranking, winner selection. Pure, deterministic, 100% unit-tested.
- `application` owns transactions and locking and calls `domain` for decisions.
- `api` and `worker` contain no business logic.
- The selection ALGORITHM is pure; the closing OPERATION is not (it coordinates transactions). Keep that distinction in code and README.

---------------------------------------------------------------------

## 2. Conventions

- Money: integer cents (EUR). Never floats. CPM expressed as cents per 1,000 views.
- Time: UTC `timestamptz`. The DATABASE clock is the only clock used for deadline decisions (see §6).
- Overflow: ratio comparisons use `BigInt` (views x cents can exceed 2^53).
- Rounding: derived payments use floor to whole cents (see §4); bid validation uses exact integer cross-multiplication, never rounded values.
- IDs: UUID v7 or bigserial; pick one and be consistent. Tiebreaks use ID ascending.
- Errors: `{ "error": { "code": "...", "message": "...", "details": {...} } }` with stable codes (§7).

---------------------------------------------------------------------

## 3. Data model

### advertisers
id, name

### creators
- id, handle, display_name
- platform: enum('tiktok','instagram')
- genre: text (from a fixed list: fitness, beauty, gaming, food, travel, tech, fashion, music)
- followers: int
- engagement_bps: int  (4.2% = 420)
- median_views: int    (historical median views per comparable short-form video; seeded)
- min_fee_cents: int > 0  (creator's stated minimum for one sponsored video)

### campaigns
- id, advertiser_id, title, brief
- budget_cents > 0
- deadline_at timestamptz
- platforms: text[] (non-empty subset of tiktok/instagram)
- genres: text[] (non-empty)
- min_followers int >= 0
- min_engagement_bps int >= 0
- target_cpm_cents > 0
- max_cpm_cents >= target_cpm_cents
- status: enum('open','closed')
- created_at, closed_at nullable
- Derived (never stored) display state: `open` | `settling` (status=open AND deadline passed) | `closed`.
- Index: (status, deadline_at) for the worker's claim query.

### bids
- id, campaign_id, creator_id
- amount_cents > 0
- estimated_views int (SNAPSHOT of creator.median_views at last write)
- pricing_policy_version text
- status: enum('active','withdrawn','won','lost')
- result_reason text nullable (set at close)
- created_at, updated_at (updated_at changes whenever amount changes or a withdrawn bid is re-activated; used for tiebreak)
- UNIQUE (campaign_id, creator_id)
- Indexes: (campaign_id, status), (creator_id)

### campaign_closings
- campaign_id PRIMARY KEY (REFERENCES campaigns)  <- structural backstop against double close
- closed_at, algorithm_version
- bids_considered, winners_count
- spend_cents, estimated_views_total, unused_budget_cents

Computed on read (not stored): eligibility, match ranking, price guidance, effective CPM, display state.
Stored at write: bid amount + estimated_views snapshot + policy version (so results remain explainable if the model later changes).

---------------------------------------------------------------------

## 4. Matching and pricing (domain package)

### 4.1 Eligibility (hard requirements)
Creator C is eligible for campaign K iff ALL hold:
- C.platform in K.platforms
- C.genre in K.genres
- C.followers >= K.min_followers
- C.engagement_bps >= K.min_engagement_bps
Return the list of failed requirements for ineligible pairs (used for UI "why not").
Bidding additionally requires: K.status = open and database time < K.deadline_at.

### 4.2 Expected views
`estimated_views = creator.median_views`.
Rationale: use observed history rather than invented follower/engagement multipliers. Seeded numbers are fictional and labelled as demo data.

### 4.3 Price guidance (per creator x campaign)
- `target_payment_cents = floor(estimated_views * target_cpm_cents / 1000)`
- `max_payment_cents    = min(budget_cents, floor(estimated_views * max_cpm_cents / 1000))`
- `min_fee_cents       = creator.min_fee_cents`

Price position of a candidate amount `a`:
- BLOCKED_BELOW_MIN: a < min_fee_cents
- BLOCKED_ABOVE_MAX: a > max_payment_cents
- AT_OR_BELOW_TARGET: min_fee <= a <= target_payment  ("competitive")
- ABOVE_TARGET: target_payment < a <= max_payment  ("allowed, lower chance of selection")

Exact validation for a bid (no rounded intermediates):
- `a * 1000 <= estimated_views * max_cpm_cents`  AND  `a <= budget_cents`.

If `min_fee_cents > max_payment_cents`: label the campaign "No compatible price under current terms". Never encourage underpricing.

Effective CPM of a bid: `effective_cpm_cents = a * 1000 / estimated_views` (display with 2 decimals).

Suggested default bid in the form: `clamp(max(min_fee, target_payment), min_fee, max_payment)`.

### 4.4 Creator-side ranking of eligible campaigns
Open campaigns that the creator is eligible for, grouped:
1. Tier 1 "Meets your minimum at target rate": target_payment >= min_fee
2. Tier 2 "Needs a bid above target": target_payment < min_fee <= max_payment
3. Tier 3 "No compatible price": min_fee > max_payment (shown collapsed at the bottom)
Within a tier: sort by `target_payment / min_fee` descending (compare via cross-multiplication), then earlier deadline, then campaign id.
Each row shows the raw numbers that produced the order (target payment, min fee, max payment, deadline, number of active bids). No opaque percentage score.
Ineligible open campaigns are available behind a toggle with the failed requirements listed.

### 4.5 Bid judging (advertiser view)
Advertiser sees all bids for their campaign with: creator profile summary, estimated views, amount, effective CPM, position vs target (at/below, above), and rank by value (views per cent). They do not choose winners; the closing job does.

### 4.6 Winner selection (deterministic greedy)
Input: active bids with (id, amount_cents, estimated_views, updated_at), budget_cents.
1. Sort by value ratio `estimated_views / amount_cents` DESCENDING (BigInt cross-multiplication: a before b iff a.views * b.amount > b.views * a.amount).
2. Ties: earlier `updated_at` first, then smaller `id`.
3. Iterate; if `amount <= remaining_budget` select and subtract; else mark skipped and CONTINUE (do not stop).
4. Result per bid: `won` (with reason) or `lost` with a specific reason:
   - lost_budget: "Insufficient remaining budget (needed X, remaining Y) when your bid was considered at rank N."
   - Rank and the remaining-budget figure are shown to that bid's creator only. Do not reveal other creators' amounts.
Algorithm version string: `greedy-v1`.

Pure function signature (guide):
`selectWinners(bids, budgetCents) -> { selected: [...], skipped: [...], spendCents, estimatedViewsTotal, unusedCents }`

### 4.7 Honest limits (copy into README)
- Greedy is a heuristic and can deliver fewer total views than the best possible combination. Documented example (budget EUR 1,000): B (20k views, EUR 150), E (60k, EUR 540), A (50k, EUR 500), D (30k, EUR 330). Greedy takes B+E = 80k views and leaves EUR 310 unused; B+A+D = 100k views for EUR 980. This is a unit-test fixture ("greedy-suboptimal") that asserts the current behaviour AND is referenced in README.
- Why greedy anyway: outcomes follow a visible, simple rule (value ratio and remaining budget) that can be shown to each creator. Greedy does NOT make outcomes independent of other bids and does NOT yield a fixed threshold price; other bids still change ranking and remaining budget. Exact optimization is also explainable in a different way; we chose simplicity and auditability of the rule.
- Also: past organic median views may not predict sponsored performance; views are not unique people; summing views ignores audience overlap; views are not conversions; engagement data is self-reported/seeded; first-price sealed bids invite bid shading; no fraud detection; creators' minimum fees are self-declared.
- What we'd change at scale: exact or swap-improvement solver behind the same interface, calibration from real campaign outcomes, reserve prices, second-price or uniform-price variants.

---------------------------------------------------------------------

## 5. Bidding rules (application layer)

- One bid per creator per campaign (UNIQUE constraint).
- Creator may create, update amount, or withdraw until the deadline. Re-bidding after withdrawing re-activates the same row.
- Bids are sealed from other creators. A creator sees only their own bid plus the count of active bids. The campaign's advertiser sees all bids on their campaign.
- Winners are paid their own submitted amount (first-price).
- Validation (all server-side; UI mirrors it for feedback):
  - campaign exists and status = open
  - database time < deadline (checked after taking the lock, §6)
  - creator eligible (§4.1)
  - amount >= creator.min_fee_cents
  - amount within max (§4.3)
- Soft identity checks: `X-Actor-Role` / `X-Actor-Id` headers; creators can modify only their own bids; advertisers can read only their own campaigns' bids. State clearly in README that this is NOT security.

---------------------------------------------------------------------

## 6. Concurrency and closing protocol (most important section)

### 6.1 Clock rule
`now()` in Postgres is frozen at TRANSACTION START. A transaction that waits for a lock would then use a stale time. Therefore ALL deadline comparisons use `clock_timestamp()` evaluated AFTER the campaign row lock is acquired. Application server time is never used for deadline decisions.

### 6.2 Bid write path (create/update/withdraw)
In one transaction:
1. `SELECT ... FROM campaigns WHERE id = $1 FOR UPDATE`  (exclusive campaign lock)
2. Verify `status = 'open'` AND `clock_timestamp() < deadline_at`; else reject `CAMPAIGN_CLOSED` / `BIDDING_ENDED`.
3. Validate eligibility/price rules; upsert the bid; snapshot estimated_views and policy version.
4. Commit.
Tradeoff (state in README): serializes bid writes per campaign. Fine for this scale; at higher scale use FOR SHARE on the campaign plus per-bid row locks and keep FOR UPDATE for the closer.

### 6.3 Closer (worker) path — one campaign per transaction
Loop body `closeNextDueCampaign()`:
1. BEGIN
2. `SELECT id FROM campaigns WHERE status='open' AND deadline_at <= clock_timestamp() ORDER BY deadline_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`
   - none -> ROLLBACK, return "nothing due".
3. Re-check `status='open'` (defensive) and read all `active` bids for the campaign.
4. `selectWinners(bids, budget)` (pure).
5. Update bids to won/lost with result_reason; insert `campaign_closings` row (PK = campaign_id); set campaign status='closed', closed_at.
6. COMMIT. Return "closed one"; the worker loops until nothing is due, then sleeps (default 5s, configurable via env).
Properties to guarantee and test:
- Because bid writers hold FOR UPDATE on the same row, a bid either commits before the closer's lock (and is included) or runs after the close (and is rejected). No lost or half-included bids.
- SKIP LOCKED: two workers never process the same campaign concurrently; the second moves on.
- Idempotent: status check + `campaign_closings` PK make double-close structurally impossible even if locking were wrong.
- Crash before COMMIT: nothing persisted; campaign stays open and is retried.
- Failure isolation: an error closing campaign X rolls back only X; the loop logs it and continues (with a bounded retry/backoff so one poison campaign cannot starve others).
- Closed campaigns and their bids are immutable (enforced in application; add DB trigger only if time permits).
- No bids -> closes successfully with zero winners.
- Budget never exceeded; verified by an invariant check inside the closer before commit (abort transaction if violated).

---------------------------------------------------------------------

## 7. API contract (all under /api, JSON)

Actor headers: `X-Actor-Role: advertiser|creator`, `X-Actor-Id: <id>`.

| Method & path | Purpose |
|---|---|
| GET /health | liveness (process up) |
| GET /ready | readiness (DB reachable) |
| GET /time | server (DB) time for UI countdowns |
| GET /identities | all advertisers and creators for the switcher |
| POST /campaigns | advertiser creates campaign (validates §3 constraints; deadline must be >= 1 minute ahead) |
| GET /advertisers/:id/campaigns | list own campaigns with display state and bid counts |
| GET /campaigns/:id | detail; includes price guidance if actor is an eligible creator |
| GET /campaigns/:id/bids | advertiser-only: all bids with effective CPM and rank by value |
| GET /campaigns/:id/result | after close: winners, spend, views, unused budget, algorithm_version, per-bid reasons (creator sees only their own reason) |
| GET /creators/:id/campaigns?include=ineligible | ranked matches per §4.4 with guidance numbers |
| PUT /campaigns/:id/bids/me | creator create/update bid `{ amountCents }` |
| DELETE /campaigns/:id/bids/me | creator withdraw bid |
| GET /creators/:id/bids | creator's bids with campaign state and outcome |

Error codes: VALIDATION_ERROR, NOT_FOUND, FORBIDDEN_ACTOR, NOT_ELIGIBLE, BELOW_MIN_FEE, ABOVE_MAX_PRICE, BIDDING_ENDED, CAMPAIGN_CLOSED, INTERNAL.
All money fields suffix `Cents`; all timestamps ISO-8601 UTC.

---------------------------------------------------------------------

## 8. UI

Global: top bar "Acting as: [role+identity switcher]", persisted in localStorage; server-time-synced countdowns; auto-refresh via polling every 5s on list/detail pages.
Campaign state badges: Open (countdown) / Bidding ended - settling / Closed.

Advertiser:
1. My Campaigns: list, state, bids count, budget, spend if closed.
2. Create Campaign: title, brief, budget, deadline (presets: 2 min [demo], 1 hour, 1 day, custom), platforms, genres, min followers, min engagement, target CPM, max CPM. Live helper text: "At 40,000 expected views, EUR 10 CPM = EUR 400."
3. Campaign Detail: terms; bids table sorted by value (creator, estimated views, amount, effective CPM, vs target); after close: winners, total spend, views, blended CPM, unused budget, and a "How winners were picked" explainer using greedy-v1 with the limits.

Creator:
1. Opportunities: ranked list per §4.4 with the numbers visible; collapsed "No compatible price" and ineligible toggle with reasons.
2. Campaign Detail + Bid form: brief, requirements, deadline, and a price panel (min fee, target payment, max payment, expected views). Live feedback as the amount changes (blocked below min / blocked above max / at-or-below target / above target). Submit / update / withdraw.
3. My Bids: status (active / withdrawn / won / lost), price, effective CPM, and after close the specific reason.

Empty/loading/error states required on every page. Show API error messages from the stable codes.

---------------------------------------------------------------------

## 9. Seed data (idempotent, `pnpm db:seed`)
- 3 advertisers.
- ~14 creators across both platforms and 6+ genres, with median_views, followers, engagement, and min fees that make all three tiers appear. Fictional; label "demo data".
- 4 campaigns: one already open for a while with several bids, one with a 3-minute deadline for live demo, one with a past deadline (settles on first worker tick), one deliberately ineligible-heavy to show "why not".
- Include the A/B/D/E greedy-suboptimal scenario as a named demo campaign.

---------------------------------------------------------------------

## 10. Testing (required)

Unit (packages/domain): eligibility (each failure reason), price guidance and rounding, validation boundaries (exactly at max, one cent above), ranking tiers and tiebreaks, BigInt ratio comparison at large values, selectWinners (normal, over-budget skip-and-continue, ties by time then id, zero bids, single bid exceeding budget, exact-budget fit, greedy-suboptimal fixture).

Integration (real Postgres):
- Bid placement: valid/invalid cases, one-bid-per-creator, update, withdraw, re-activate.
- Deadline: bid before deadline accepted; at/after rejected, using DB clock.
- Closer: correct winners; budget invariant; reasons recorded; no-bids campaign; closed campaign immutable.
- Idempotency: run the closer twice; assert all tables identical (snapshot diff) and exactly one campaign_closings row.
- Concurrency: two closers started simultaneously on the same due campaign -> exactly one set of awards.
- Race: hold a bid transaction's campaign lock, start the closer, release; assert the bid is included. And the reverse: start closing, then submit a bid; assert it is rejected. Use deterministic synchronization (pg advisory locks or explicit transaction control), not sleeps.
- Crash safety: inject a failure after awards are written but before commit; assert nothing persisted and a retry succeeds.

E2E (Playwright, against docker compose): advertiser creates a campaign with a 1-2 minute deadline -> two creators bid -> wait for the worker -> both sides see correct results and reasons. This is the grader's path; it must be green.

CI: lint, typecheck, unit, integration (Postgres service container), build; E2E on main or manual trigger.

---------------------------------------------------------------------

## 11. Infrastructure to build vs describe

Build:
- Dockerfiles (multi-stage, non-root) for api, worker, web.
- docker-compose.yml: postgres (healthcheck, volume), migrate+seed one-shot job, api, worker (waits for healthy DB and finished migration), web. One command: `docker compose up --build`.
- Env-based config with defaults; `.env.example`.
- Structured JSON logs (pino) with campaign_id/bid_id fields; request IDs.
- /health, /ready; worker heartbeat log line.
- GitHub Actions CI.

Describe in README only (do not build):
- Deploy: container images to a registry; API and web as Deployments; worker as a separate Deployment with replicas >= 2 (safe because of SKIP LOCKED) OR a CronJob every minute running `closeDueCampaigns` and exiting. Note the tradeoff: Deployment = low latency; CronJob = simpler ops but up to a minute of settle lag.
- Managed Postgres, PITR backups, migrations run as a pre-deploy job and kept backward compatible (expand/contract).
- Secrets via a secret manager; TLS and rate limiting at the ingress; real authentication (OIDC) and server-enforced ownership.
- Observability: metrics for settle lag (now - deadline at close), campaigns closed per minute, close failures, bid rejections by code, API latency/error rate; alerts if any campaign is past deadline by > N minutes or close failures repeat.
- Environments: staging with synthetic campaigns; closer runnable in dry-run mode.
- Scaling: bid writes serialized per campaign today; discuss FOR SHARE variant, read replicas for ranking queries, caching the opportunities query.
- Data/ML evolution: replace median_views with calibrated predictions from realized sponsored-post performance.

---------------------------------------------------------------------

## 12. README requirements
Sections: Quick start (one command, URLs, how to demo in 2 minutes) -> Architecture diagram (ASCII/mermaid) and service boundaries -> Data model -> Matching -> Pricing (with the worked numeric example) -> Winner selection and why greedy (with the greedy-suboptimal example) -> Closing correctness (race analysis, clock rule, idempotency, failure modes) -> Honest limits (§4.7) -> What I skipped and why (§0) -> Running in production (§11) -> How I used AI tools and what I verified myself -> Testing.
Every claim in the README must correspond to code or tests. Use a "Known limitations" list instead of hedging in prose.

---------------------------------------------------------------------

## 13. Implementation slices (execute in order; stop and verify after each)

Each slice ends with: lint, typecheck, relevant tests, build all passing; a brief report of checks actually run and anything not done. Update DECISIONS.md whenever a choice is made that is not already specified here.

Slice 1 — Skeleton + thin loop
- Monorepo, tooling, CI skeleton, Docker Compose with Postgres, migrations for all tables, seed.
- API: /health, /ready, /time, /identities. Web: identity switcher.
- Accept: `docker compose up` works; switcher lists seeded identities.

Slice 2 — Domain
- packages/domain: eligibility, price guidance, validation, ranking, selectWinners; full unit tests incl. fixtures in §4.7 and §9.
- Accept: domain tests green; no IO imports in the package.

Slice 3 — Campaigns and matching
- POST /campaigns, advertiser list/detail, creator opportunities (§4.4), campaign detail with guidance.
- UI: Create Campaign, My Campaigns, Opportunities, Campaign Detail (read-only price panel).
- Accept: advertiser creates a campaign; a matching creator sees it ranked with numbers; an ineligible one sees reasons.

Slice 4 — Bidding
- PUT/DELETE bids with the §6.2 protocol, creator My Bids, advertiser bids table.
- Accept: integration tests for all validation paths and deadline behaviour; live form feedback in the UI.

Slice 5 — Closing worker
- application.closeNextDueCampaign per §6.3, worker loop, result endpoints, result UI and explainer.
- Accept: all closing, idempotency, concurrency, race and crash tests green; the demo campaign closes automatically in Compose and results render for both roles.

Slice 6 — E2E, hardening, docs
- Playwright E2E, structured logging, error states, README per §12, DECISIONS.md complete, CI green.
- Accept: fresh clone -> `docker compose up --build` -> full loop via UI in under 5 minutes; README claims verified against code.

---------------------------------------------------------------------

## 14. Definition of done checklist
- [ ] Full loop via UI on a clean machine with one command; no DB tools needed.
- [ ] Closer: transactional, idempotent, SKIP LOCKED, clock_timestamp after lock, budget invariant, tests for race/crash/concurrency.
- [ ] Matching and pricing explainable in the UI with raw numbers; limits stated.
- [ ] Domain logic pure and unit-tested; API/worker thin.
- [ ] CI green; Playwright E2E green.
- [ ] README complete, includes production plan and AI-usage note; DECISIONS.md lists every non-obvious choice with alternatives.
- [ ] No secrets committed; non-root containers.
