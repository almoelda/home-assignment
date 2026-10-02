# Creator Marketplace

A slice of a two-sided creator marketplace: advertisers run campaigns, creators get matched
and bid, and a scheduled worker closes campaigns at their deadline and picks winners within
budget — end to end through the UI, no database access required.

Built against `IMPLEMENTATION_PLAN.md` (the approved design) and `CLAUDE.md` (working
rules); every non-obvious choice and every deviation is recorded in `DECISIONS.md`.

---

## Quick start

```sh
cp .env.example .env
docker compose up --build
```

Then open:

- **Web app:** http://localhost:5173
- **API:** http://localhost:3000 (`/health`, `/ready`, `/identities`, …)

The database is migrated and seeded automatically before the API and worker start (the
`migrate` service in `docker-compose.yml` is a one-shot init container; `docker compose up`
waits for it to exit `0` before starting `api` and `worker`).

### Demo in under 2 minutes

No login — pick who you're acting as from the dropdown in the top bar.

1. **Act as an advertiser** (e.g. "Nova Sports Nutrition") → **My Campaigns** already shows
   seeded campaigns, including one with a deadline in the past that the worker closes on its
   first tick, and **"Demo: Greedy vs Optimal Selection"** — a campaign that reproduces the
   exact worked example in [Winner selection](#winner-selection-and-why-greedy) below.
2. Click into a closed campaign to see **Results**: winners, spend, views, blended CPM,
   unused budget, and an explainer for how winners were picked.
3. **Act as a creator** (e.g. "Marta Fit") → **Opportunities** shows every open campaign
   she's eligible for, ranked, with the raw numbers behind the ranking. Toggle "Show
   campaigns you're not eligible for" to see *why* others are excluded.
4. To watch the close happen live end to end: **Create Campaign** → deadline preset **"2
   minutes (demo)"**. Have two creators bid, then wait ~2 minutes and watch **My Bids**
   update once the worker closes it (polls every 5s; see `WORKER_POLL_INTERVAL_MS`). This
   exact flow is what `apps/web/e2e/marketplace.spec.ts` automates. ("Weekend Flash —
   Beauty Try-On" is also seeded with a live ~20-minute deadline if you'd rather bid on an
   existing campaign than create your own.)

---

## Architecture

```
                         ┌────────────────────────┐
   browser ─────────────▶│  web (nginx, :5173)    │
                         │  React + Vite SPA      │
                         │  Tailwind + shadcn/ui  │
                         └────────────┬───────────┘
                                     │ fetch, CORS (no reverse proxy at this scale)
                                     ▼
                         ┌──────────────────────┐
                         │  api (Fastify, :3000)  │        ┌─────────────────────┐
                         │  routes: parse, call   │───────▶│ packages/application │
                         │  application, serialize │        │ transactions, row    │
                         └──────────────────────┘        │ locking, calls domain │
                                                            └──────────┬───────────┘
                         ┌──────────────────────┐                     │
                         │  worker (poll, 5s)     │                     │
                         │  closeDueCampaigns()   │────────────────────┤
                         └──────────────────────┘                     ▼
                                                            ┌─────────────────────┐
                                                            │  packages/domain     │
                                                            │  pure: eligibility,  │
                                                            │  pricing, ranking,   │
                                                            │  selectWinners       │
                                                            └─────────────────────┘
                                                                       │
                                                                       ▼
                                                            ┌─────────────────────┐
                                                            │  packages/db         │
                                                            │  schema, migrations, │
                                                            │  seed                │
                                                            └──────────┬───────────┘
                                                                       ▼
                                                            ┌─────────────────────┐
                                                            │    PostgreSQL 16      │
                                                            └─────────────────────┘
```

### Service boundaries

- **`apps/api`, `apps/worker`** — thin. Parse input, call `packages/application`, serialize
  output. No business logic lives here (verified: every route handler is a direct pass-through).
- **`packages/application`** — owns transactions and row locking. Calls `packages/domain` for
  every decision (eligibility, pricing, ranking, winner selection) and persists the result.
- **`packages/domain`** — pure functions only. No database, no clock, no I/O — verified by a
  Slice 2 acceptance check (`grep` for imports) and enforced by the package having **zero
  runtime dependencies** in `package.json`. This is what makes it exhaustively unit-testable
  and safe to import directly into the web app for client-side bid-price feedback (plan §5:
  "UI mirrors it for feedback" — `apps/web` imports `classifyPricePosition` from
  `@marketplace/domain` rather than re-implementing the same formula a second time).
- **`packages/db`** — schema (Drizzle), generated SQL migrations, and the idempotent seed
  script. The only place table structure is defined.

Why not split further into separate services (campaigns vs. bids vs. closing)? The brief's
hardest requirement — never exceed a campaign's budget — is a single invariant across
campaigns and bids. Splitting them into separate databases would turn one `BEGIN`/`COMMIT`
into a distributed transaction with its own idempotency and reconciliation problems, for no
real gain at this scale: request-serving and the scheduled closer already have different
failure modes and deploy cadences, and that's the one axis that's actually split here (`api`
vs `worker`, separate processes, separate Dockerfiles, independently deployable).

---

## Data model

Five tables (`packages/db/src/schema.ts`; generated migration in `packages/db/drizzle/`):

| Table | Purpose |
|---|---|
| `advertisers` | id, name |
| `creators` | platform, genre, followers, engagement (bps), **median_views** (seeded, demo data), min fee |
| `campaigns` | budget, deadline, platforms[], genres[], min requirements, target/max CPM, status |
| `bids` | one per (campaign, creator) — amount, **estimated_views snapshot**, status, result reason |
| `campaign_closings` | one per closed campaign — **`campaign_id` is the PRIMARY KEY**, not just a foreign key |

Notable constraints (all enforced by the database, not just application code):

- Money is `integer` cents everywhere. Never floats.
- `campaigns.max_cpm_cents >= target_cpm_cents`, budgets/CPMs positive, platforms/genres
  arrays non-empty — all `CHECK` constraints, not application-only validation.
- `bids` has a `UNIQUE (campaign_id, creator_id)` constraint — one bid per creator per
  campaign, upserted on re-bid (plan §5).
- `campaign_closings.campaign_id` as the **primary key** (not a separate auto-increment id)
  is deliberate: it makes a double-close structurally impossible at the database level,
  independent of whether the application's locking logic is correct. See
  [Closing correctness](#closing-correctness) below.
- A campaign's **display state** (`open` / `settling` / `closed`) is derived, never stored:
  `settling` is `status='open' AND deadline_at <= now()` — the real window between a deadline
  passing and the worker's next tick, surfaced explicitly rather than left to look broken.

---

## Matching

A creator is eligible for a campaign iff **all** hold (`packages/domain/src/eligibility.ts`):

- creator's platform ∈ campaign's platforms
- creator's genre ∈ campaign's genres
- creator's followers ≥ campaign's minimum
- creator's engagement ≥ campaign's minimum

These are hard gates, not scored — a campaign requiring 50k followers is not "almost right"
for a 30k-follower creator, it's a no. Every failed requirement is returned, not just the
first, so the UI can show *all* the reasons at once ("Opportunities" page, "why not" toggle).

Campaign status/deadline are **not** part of eligibility — a creator can be eligible for a
campaign that has already stopped accepting bids. That's a separate, time-sensitive check
made under a database lock at bid-write time (see [Closing correctness](#closing-correctness)),
not a property of the creator/campaign pair.

---

## Pricing

For creator *C* bidding on campaign *K* (`packages/domain/src/pricing.ts`):

```
estimated_views      = C.median_views                         (observed history, not a formula)
target_payment_cents = floor(estimated_views × K.target_cpm_cents / 1000)
max_payment_cents    = min(K.budget_cents, floor(estimated_views × K.max_cpm_cents / 1000))
min_fee_cents        = C.min_fee_cents
```

**Why `median_views` and not a follower/engagement formula:** inventing a multiplier
("followers × engagement × some constant") would produce a confident-looking number with no
basis — this project has no real view data to calibrate one against. A creator's own recent
median is at least *their* observed reality, however limited the seeded demo data is. See
[Honest limits](#honest-limits-and-where-this-design-would-break) for what this assumption
costs.

**Worked example** (seeded creator "Marta Fit": 42,000 median views, €250 minimum fee;
seeded campaign "Protein Bar Launch": €15 target CPM, €25 max CPM, €1,500 budget):

```
target_payment = floor(42,000 × 1500 / 1000) = 63,000 cents  = €630
max_payment    = min(150,000, floor(42,000 × 2500 / 1000))
               = min(150,000, 105,000)                       = €1,050
min_fee                                                       = €250
```

A bid is classified by position, shown to the creator before they bid:

| Bid amount | Position |
|---|---|
| < €250 | **Blocked — below your minimum fee** |
| €250 – €630 | **At or below target — competitive** |
| €630 – €1,050 | **Above target — allowed, lower chance of selection** |
| > €1,050 | **Blocked — above the campaign's max price** |

Bid validation is exact integer cross-multiplication (`amount × 1000 ≤ estimated_views ×
max_cpm_cents`), never the rounded `max_payment` figure — the two can disagree by a cent at
the boundary, and the exact form is authoritative (`pricing.test.ts` has a dedicated boundary
test for exactly this).

If a creator's minimum fee exceeds the max the campaign can pay at all (`min_fee >
max_payment`), that's surfaced plainly as **"No compatible price under current terms"** —
never a suggestion to underbid.

**Connection to WePush's real product:** WePush's own platform (per public sources) computes
a *fixed* creator-specific price from a quality/performance score and shows it before the
creator joins — no bidding. This project's price guidance plays the same role their pricing
layer does; the bid is the creator's deviation from the computed recommendation. WePush's
production model is the degenerate case of this design where every creator accepts the
recommendation exactly.

---

## Winner selection and why greedy

Input: every `active` bid on a campaign, each with `(amount_cents, estimated_views)`. Budget:
the campaign's `budget_cents`. (`packages/domain/src/winners.ts`, algorithm version `greedy-v1`.)

1. Rank bids by **value density** = `estimated_views / amount_cents`, descending.
2. Ties broken by earlier `updated_at`, then smaller `id` — a **total order**, which matters:
   an unstable sort over equal-density bids could award different winners on a re-run of the
   exact same data, and then "safe to run twice" would be false regardless of how correct the
   locking is.
3. Walk the ranked list. Take any bid that still fits in the remaining budget. **Skip — don't
   stop — at the first one that doesn't fit**, and keep walking: a later, cheaper bid should
   never be blocked by an earlier one that happened not to fit.
4. Every bid leaves with a decision: `won`, or `lost` with a specific reason and the rank it
   was considered at, shown only to that bid's own creator. **Losing bids are never revealed
   to anyone else. Winning amounts are published to everyone, deliberately** — once a campaign
   closes, `GET /campaigns/:id/result` returns every winner's amount to any caller, including
   losing creators, so both sides can audit the outcome rather than being asked to trust it.

### Why greedy, not an exact optimum

This is a knapsack problem, and an exact solver is cheap at this scale (tens of bids). It was
rejected anyway, on a product ground: **under an exact optimum, a creator's outcome depends
on the whole set of other bids, not just their own numbers.** There is no threshold price you
could tell a creator ("bid under €X to win") because no such X exists in general — change one
other person's bid and the optimal *set* can reshuffle, flipping outcomes for creators who
changed nothing. Greedy does **not** make outcomes independent of other bids either — your
*rank* depends on how your value density compares to everyone else's, and whether you actually
*win* depends on how much budget the bids ranked above you consumed. What greedy gives up
instead is the *combinatorial* dependency: your rank is computed from a simple, total
ordering over density alone, not from searching every possible subset. The rule itself is
one sentence a creator can be told and verify: "bids are ranked by views-per-euro, budget is
filled top-down, I was rank N and here's what was left when my turn came." That's worth more
here than a few extra percentage points of budget efficiency.

**The cost of that choice, demonstrated, not just asserted** — this is the exact fixture
seeded as campaign *"Demo: Greedy vs Optimal Selection"* and asserted in
`winners.test.ts` (`greedy-suboptimal`):

| Creator | Views | Bid | Value density |
|---|---:|---:|---:|
| B | 20,000 | €150 | 1.333 |
| E | 60,000 | €540 | 1.111 |
| A | 50,000 | €500 | 1.000 |
| D | 30,000 | €330 | 0.909 |

Budget: **€1,000**.

- **Greedy's actual result:** B, then E (€690 spent, **80,000 views**, €310 unused). Ranked
  next is A (needs €500, only €310 remains — skipped), then D (needs €330, only €310
  remains — €20 short, also skipped). Both are evaluated against the same €310, since
  neither one being skipped changes what's left for the other.
- **The optimum it misses:** B + A + D = €980 spent, **100,000 views** — 25% more views for
  roughly the same money, using nearly the whole budget instead of leaving €310 idle.

This runs live: the fixture campaign's deadline is seeded in the past, so the worker closes
it on its very first tick, and the real, deployed system produces exactly these numbers —
confirmed by running it (`docker compose up`, worker log: `campaignId: <fixture>,
winnersCount: 2, spendCents: 69000, estimatedViewsTotal: 80000, unusedBudgetCents: 31000`).

**Honest caveat on greedy's worst case:** greedy-by-density has a known pathological case — a
single bid that consumes almost the entire budget at a marginally higher density than many
smaller bids can leave most of the budget's potential value on the table. It doesn't arise
when individual bids are a small fraction of the budget — this marketplace's shape — but if
bids routinely approached the full budget, the standard fix is two lines: also evaluate the
single best affordable bid alone and take whichever total is higher, which guarantees at
least half of the best possible total value in the worst case. Not built, because it isn't
needed at this scale; named here so it isn't mistaken for an oversight.

---

## Closing correctness

This is where the brief's grading explicitly focuses ("correctness of the closing job"), and
where most of the testing effort went: **39 tests in `packages/application`**, including a
dedicated concurrency suite (`closing-race.test.ts`) that forces two specific race
interleavings deterministically rather than hoping `Promise.all` exercises them.

### The clock rule

Postgres's `now()` is frozen at **transaction start** — a transaction that waited for a lock
would then compare against a stale timestamp. Every deadline decision therefore uses
`clock_timestamp()`, evaluated **after** acquiring the relevant row lock, inside the same
transaction (`packages/application/src/mappers.ts`, `readClockTimestamp`). Application-server
time is never used for a decision that commits money or a bidding outcome.

> **A real bug this caught:** `db.execute(sql...)` for a raw query returns the node-postgres
> driver's raw row, not Drizzle's schema-mapped type — `clock_timestamp()` comes back as a
> **string**, not a `Date`. An earlier version of this code typed it as `Date` and compared it
> directly against `campaign.deadlineAt` with `<=`; comparing a `Date` against a string
> coerces to `NaN`, and any comparison against `NaN` is `false` — so the deadline check could
> **never fire**, silently. An integration test caught it immediately (a bid that should have
> been rejected as `BIDDING_ENDED` instead succeeded). Full writeup in `DECISIONS.md`
> ("Bug found and fixed: `clock_timestamp()` returns a string via `db.execute`").

### Five correctness layers (`packages/application/src/closing.ts`)

The closer claims and closes **one campaign per transaction**:

1. **`SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`**, inside the transaction that will close it.
   `SKIP LOCKED` means a second worker never blocks on a campaign another worker is already
   closing — it moves on, so N workers process disjoint campaigns in parallel without any
   coordination beyond the database.
2. **`status = 'open'` evaluated under the lock *is* the idempotency guard** — not a separate
   check bolted on afterward. A campaign another worker already closed simply isn't in the
   result set.
3. **One transaction per campaign.** A crash or thrown error anywhere rolls back everything —
   the campaign is still `open` with `active` bids for the next tick to redo cleanly. A
   partially-closed auction is never observable (`closing.test.ts`, "crash safety": a
   deliberately thrown error after bids are updated but before commit leaves the bid `active`
   and the campaign `open`; a retry then succeeds normally).
4. **Structural backstop:** `campaign_closings.campaign_id` is the table's **primary key**.
   Even if every line of the locking logic above were wrong, a second close attempt on the
   same campaign dies on a unique-violation and the whole transaction aborts — a guarantee
   that doesn't depend on this code being correct (`closing.test.ts` verifies the insert
   itself rejects a duplicate directly, independent of the closer's own logic).
5. **The budget invariant is asserted before anything commits.** If selection ever produced a
   total exceeding the campaign's budget, the transaction throws and rolls back rather than
   persisting an overspend.

### The bid/close race

`placeBid` and `withdrawBid` (`packages/application/src/bids.ts`) take the **same `FOR
UPDATE` lock** on the campaign row before checking status or deadline. Combined with the
closer's own lock, this produces exactly two possible orderings, both tested with
deterministic synchronization (paired `Promise`s that pause one transaction mid-flight while
driving the other — not timing-based sleeps):

- **A bid is mid-transaction, holding the lock, when the closer runs:** the closer's `SKIP
  LOCKED` means it does **not** block — with only one campaign due, it correctly reports
  "nothing to close" rather than waiting. Once the bid commits, the **next** tick claims the
  campaign and correctly includes that bid. (`closing-race.test.ts`, confirms `SKIP LOCKED`'s
  non-blocking behavior is a real, observed property, not just a claim.)
- **The closer is mid-transaction, holding the lock, when a bid is attempted:** `placeBid`'s
  plain `FOR UPDATE` (no `SKIP LOCKED`) genuinely **blocks** until the closer commits. The
  blocked call then re-reads `status = 'closed'` and is rejected with `CAMPAIGN_CLOSED`.
  (Same file — proves a bid can never land on a campaign that just closed, nor be silently
  dropped.)

Either way: **no bid is ever half-included, and none is orphaned `active` on a closed
campaign.** This is also directly covered by the concurrency test "two closers racing the
same due campaign" — of two simultaneous `closeNextDueCampaign` calls against one due
campaign, exactly one closes it and exactly one `campaign_closings` row is ever written.

**Documented tradeoff:** this serializes bid writes per campaign — two creators bidding on
the same campaign at the same instant queue behind each other's lock, briefly. Acceptable at
this scale; the scaling note below covers the alternative.

### Failure modes, explicitly

| Failure | What happens |
|---|---|
| Worker process crashes mid-close | Transaction never commits; campaign stays `open`, bids stay `active`; next tick retries from scratch. |
| Two worker replicas running simultaneously | `SKIP LOCKED` — they process different campaigns, never the same one twice. |
| One campaign's close throws (e.g. a data bug) | That transaction rolls back; the worker's loop (`closeDueCampaigns`) stops for that tick rather than silently swallowing it — logged, retried next tick. A single poisoned campaign cannot corrupt campaigns already closed earlier in the same tick. |
| A bid arrives in the exact instant a campaign is closing | Row-lock ordering resolves it deterministically either way — see above. Never ambiguous. |

---

## Honest limits and where this design would break

Stated plainly rather than hedged in prose, per the brief's ask to be "honest about limits":

- **`median_views` is a stand-in for a real forecast.** It's seeded, fictional demo data in
  this project. A creator's *historical organic* median is not a reliable predictor of
  *sponsored* performance, and nothing here corrects for that gap.
- **Views are not unique people, and summing them across winners isn't reach.** If two
  winning creators share an audience, the campaign's total "estimated views" overstates
  distinct people reached. Not modeled.
- **Views are not conversions or sales.** The entire pricing and selection model optimizes
  for views per euro; it says nothing about whether those views are worth anything to the
  advertiser beyond that proxy.
- **Engagement and follower data are self-reported/seeded,** with no fraud or bot-traffic
  detection. A creator with inflated numbers is treated as real.
- **First-price, sealed bids invite bid shading.** Winners are paid exactly what they bid —
  not the theoretically "truthful" mechanism — so a rational creator bids somewhat above
  their true minimum, not at it. This project doesn't attempt to correct for that.
- **Creators' minimum fees are self-declared** and never verified against anything.
- **Greedy selection is not globally optimal** — demonstrated numerically above, not just
  asserted. It also does **not** make a winner's outcome independent of other bids: rank
  depends on everyone's relative value density, and whether a given rank actually wins depends
  on how much budget the bids above it consumed.
- **Publishing winning prices invites undercutting in a repeated first-price auction.** Once a
  creator can see what won last time, a rational bidder shades toward that number on the next
  campaign — the transparency that lets both sides audit the outcome (above) is the same
  transparency that erodes price discovery over repeated rounds. Not modeled or mitigated here.

---

## What I skipped, and why

Explicit non-goals (`IMPLEMENTATION_PLAN.md` §0), kept out deliberately rather than by
running out of time:

- **Authentication/authorization** — the brief asks for an identity switcher, not auth; adding
  real auth would be solving a problem that wasn't asked for and would bury the actual ask.
- **Payments, invoicing, contracts, content delivery/approval, messaging** — none of these
  are where the brief's grading focus is (matching, pricing, bidding, closing), and each is
  its own substantial subsystem.
- **Real TikTok/Instagram integration** — profile metrics are seeded demo data; a real
  integration is a scraping/ingestion problem with its own failure modes (rate limits, API
  changes, data staleness) that deserves to be scoped and built on its own, not bolted on as
  an afterthought here.
- **A weighted "fit" score, ML ranking, or audience-overlap modeling** — deliberately not
  built. An invented quality score with no data to calibrate it against would look more
  sophisticated while being less honest than the simpler, data-grounded approach actually
  used (observed median views, hard eligibility gates).
- **Kubernetes manifests, Helm, message queues, a cache, splitting into microservices** — see
  [Running in production](#running-this-in-production) for what the *production* shape would
  be; none of it is needed to demonstrate correctness of the matching/pricing/bidding/closing
  loop, and building it here would cost review time without adding grading signal. The
  worker's design (a single polling loop with no in-process state) is already shaped so this
  is a config change, not a rewrite, if it were ever needed.

---

## Running this in production

Not built — described, because building it wouldn't change whether the core loop is correct,
and the brief explicitly asks what's worth doing, not everything that's possible:

- **Deploy:** `api` and `web` as standard Kubernetes Deployments behind a Service/Ingress.
  The `worker` has a real choice: a **Deployment with 2+ replicas** (safe because of `SKIP
  LOCKED`, lowest latency between deadline and close) or a **CronJob running every minute**
  invoking `closeDueCampaigns` once and exiting (simpler to operate, trades up to a minute of
  "settling" lag). The worker's structure — a loop with no retained state between ticks —
  supports either without a code change.
- **Database:** managed Postgres (RDS/Cloud SQL) with point-in-time recovery. Migrations run
  as a pre-deploy Job, written expand/contract so a rolling deploy never sees a schema the
  running code doesn't expect.
- **Secrets:** a secret manager (not environment variables baked into images); `DATABASE_URL`
  and friends injected at runtime.
- **Ingress:** TLS termination and basic rate limiting at the ingress/load balancer, not
  reimplemented in the application.
- **Auth:** the `X-Actor-Role`/`X-Actor-Id` headers are the explicit seam — swap the actor
  resolution in `apps/api/src/actor.ts` for one reading a verified JWT/OIDC token, and no
  route handler changes, since they already only consume the resolved `Actor`, never the raw
  headers.
- **Observability:** the metric that actually matters here is **settle lag** — time between a
  campaign's deadline and when it's actually closed — not CPU or request latency. Alert if
  any campaign is `open` with `deadline_at` more than a few minutes in the past. Track closes
  per minute, close failures, and bid rejections broken down by error code (the stable codes
  in `packages/application/src/errors.ts` are designed to be dashboarded directly).
- **Scaling:** bid writes are currently serialized per campaign (documented tradeoff above).
  At real load, the fix is `FOR SHARE` on the campaign for bid writes plus per-bid-row locks,
  keeping `FOR UPDATE` only for the closer. Read replicas for the (read-heavy) opportunities
  and ranking queries; the opportunities query itself is cheap enough at this data volume not
  to need a cache yet.
- **The pricing model's real evolution path:** replace `median_views` with a calibrated
  prediction trained on realized sponsored-campaign outcomes once enough real data exists —
  the `pricing_policy_version` column on every bid exists specifically so that transition is
  auditable (every historical bid stays attributable to the rule that produced it).

---

## How I used AI tools

Built with an AI coding agent (Claude Code) working from a pre-approved design
(`IMPLEMENTATION_PLAN.md`) and a fixed rule set (`CLAUDE.md`) — the design decisions were
settled before implementation started, not generated ad hoc slice by slice.

What I verified myself rather than trusting generated code:

- **Every slice ended with the same gate**: lint, typecheck, the full test suite against a
  real Postgres instance, and a build — run and read, not assumed. Where a test failed, the
  failure was diagnosed to a root cause before anything was changed (see `DECISIONS.md` for
  every bug found this way, including two genuinely significant ones below).
- **Library APIs I wasn't certain of were checked against current documentation** (Context7)
  before use rather than guessed from training data — notably Drizzle's exact row-locking
  syntax (`.for("update", { skipLocked: true })`) and React Router v7's import paths (`
  react-router`, not `react-router-dom`, as of v7 — a real breaking change from v6 that would
  otherwise have shipped a broken import).
- **Two real, non-trivial bugs were caught by tests, not inspection**, and both are written
  up in full in `DECISIONS.md`:
  1. `clock_timestamp()` silently never firing the deadline check, due to a `string`-vs-`Date`
     comparison (see [Closing correctness](#closing-correctness) above) — caught by an
     integration test, not by reading the code.
  2. `apiFetch`'s header-merging object-spread order silently dropped `Content-Type:
     application/json` on every actor-scoped browser request (create campaign, place bid,
     withdraw bid) — caught **only** by the Playwright end-to-end test, because every other
     test in the suite calls either the application layer directly or Fastify's `app.inject()`,
     bypassing the real browser `fetch` client entirely. This is the concrete argument for why
     the E2E test is load-bearing rather than a formality: it is structurally the only test
     that could have caught this.
- **A cross-file test-isolation bug** surfaced when the full suite ran together but individual
  files passed: two test files shared one real database and both assumed they were the only
  source of "due" campaigns at a given moment. Root-caused to a specific leaked fixture (a
  test that backdated a campaign's deadline but never closed it), fixed at the source, and
  the test runner reconfigured to run this package's files sequentially — not papered over by
  retries or `test.skip`.

---

## Testing

**Point `DATABASE_URL` at a scratch Postgres, not the one `docker compose up` seeded, and
make sure nothing else is closing campaigns against it while tests run** (stop `docker
compose stop worker` first, or just use a separate database/container entirely). The
integration suites create fixture advertisers/creators/campaigns and don't clean them up —
harmless in a disposable scratch database, but running them against the seeded demo database
pollutes `GET /identities` (and therefore the identity switcher) with test fixtures, and a
live worker racing the same database as the closing tests can claim their fixture campaigns
non-deterministically. The quickest scratch DB: `docker run -d -p 5433:5432 -e
POSTGRES_USER=marketplace -e POSTGRES_PASSWORD=marketplace -e POSTGRES_DB=marketplace
postgres:16-alpine`, then `DATABASE_URL=postgres://marketplace:marketplace@localhost:5433/marketplace`.

```sh
pnpm install
DATABASE_URL=<scratch db> pnpm db:migrate
pnpm lint
pnpm typecheck
DATABASE_URL=<scratch db> pnpm test:run   # unit + integration, no mocks for the database
pnpm build
pnpm --filter @marketplace/web run test:e2e   # ~2.5 min wall-clock; needs the full stack running (docker compose up)
```

| Package | Tests | What's covered |
|---|---:|---|
| `packages/domain` | 49 | Pure unit tests: eligibility (every failure reason), pricing (rounding, exact boundary validation, the estimatedViews/suggestedDefaultBidCents guidance fields), ranking (tiers, tiebreaks), `selectWinners` (including the `greedy-suboptimal` fixture), and BigInt ratio comparisons at a scale where plain `number` multiplication silently loses precision. |
| `packages/db` | 3 | Schema sanity (every table and enum exports correctly). |
| `packages/application` | 41 | Integration, real Postgres: campaigns, opportunities, bidding (every validation path, the upsert/withdraw/re-activate cycle), and the closing job — including per-campaign failure isolation/backoff, a closer-crash-safety test that drives the real closer, and a concurrency suite forcing both directions of the bid/close race deterministically (one of which drives the real closer through a test-only pause hook and observes the lock genuinely blocking a concurrent writer). |
| `apps/api` | 26 | Route-level integration: actor-header gating (including the sealed-bid cross-creator case), error-code mapping, the global unexpected-error handler, the full campaign/bid/result HTTP surface. |
| `apps/worker` | 3 | Config loading/validation. |
| `apps/web` (Playwright) | 1 | The full grader's path, against the real deployed stack: create campaign → two creators bid → worker closes it unprompted → both sides see correct results and reasons. |

No unit tests for `apps/web` components — deliberate, not an oversight: with the Playwright
E2E test walking the real loop end to end (and having already caught the one bug a component
test wouldn't have — a `fetch`-client bug, not a rendering bug), the marginal value of
component-level tests here is low relative to the auction and closing-job logic, which is
where the testing effort actually went.
