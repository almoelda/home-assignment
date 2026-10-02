# DECISIONS.md

Living log of every non-obvious choice not already pinned down by `IMPLEMENTATION_PLAN.md`,
plus anything that required deviating from it. Newest at the bottom. Each entry: what, why,
alternatives considered.

---

## 2026-10-01 — Repo location

Lives at `WePush - Fullstack Platform Engineer/creator-marketplace/`, alongside this
application's other material. The parent folder's own `CLAUDE.md` governs that directory
only and doesn't constrain this repo's code or git history.

## 2026-10-01 — Toolchain: pnpm via corepack

**What:** Use `corepack enable pnpm` rather than a global `npm install -g pnpm`.
**Why:** pnpm is not installed globally; corepack (0.31.0) ships with Node and is the
standard way to pin a package-manager version per-repo without polluting global state.

## 2026-10-01 — Node version mismatch

**What:** `.nvmrc` pins Node 22 LTS (per `IMPLEMENTATION_PLAN.md` §1 and Docker base image).
Local machine runs Node 23.9 system-wide.
**Why:** Docker Compose is the environment that must match production intent; local Node
version is irrelevant as long as `pnpm` scripts and CI both target 22. No action needed
unless a 22-specific runtime behavior surfaces — if so, record it here.

## 2026-10-01 — Infrastructure scope: Compose + GitHub Actions, K8s described only

**What:** Build Docker Compose and GitHub Actions CI. Do **not** build Kubernetes manifests,
a Helm chart, or GitLab CI — describe the production shape (Deployments, a CronJob or
replicated Deployment for the worker, managed Postgres, secrets, observability) in the
README only, per `IMPLEMENTATION_PLAN.md` §11.
**Why:** The brief explicitly grades "did you choose well what to build and what to skip."
A reviewer should be able to run the full loop in minutes with one command; a K8s layer
would cost them a cluster spin-up for a demo that doesn't need one. The worker runs a plain
poll loop (plan §6.3: "the worker loops until nothing is due, then sleeps"), not a `--once`
mode — the README describes, rather than demonstrates in code, how that loop maps to a
CronJob or a replicated Deployment in production (see README "Running this in production").
**Alternative considered:** Ship a Helm chart + CronJob manifest alongside Compose, clearly
marked optional. Rejected: adds surface area to defend in the follow-up interview without
changing the grade on the axis the brief actually asks about (judgment on what's worth
doing), and risks reading as padding rather than judgment.

## 2026-10-01 — Prior research into other public submissions of this assignment

Before `CLAUDE.md`'s "do not research or consult other candidates' submissions" rule existed
in this repo, two public repos solving the same take-home were read to sanity-check
differentiation. Recorded for transparency: that research is not reflected in any design
decision here (`IMPLEMENTATION_PLAN.md` was generated independently and rejects the central
design choice both made), and the rule has been honored from that point forward.

## 2026-10-01 — Seed data: 18 creators / 5 campaigns, not ~14 / 4

**What:** `packages/db/src/seed.ts` seeds 18 creators (not "~14") and 5 campaigns (not "4").
**Why:** The extra 4 creators are a purpose-built, clearly-labeled fixture ("Demo Creator
B/E/A/D (greedy fixture)") reproducing the exact greedy-vs-optimal numbers from plan §4.7
(budget €1,000; B 20k views/€150, E 60k/€540, A 50k/€500, D 30k/€330). The 5th campaign hosts
that fixture live — deadline already past, so the worker closes it for real on first tick
rather than the result being hand-written. This means the README's documented example is
reproducible by running the app, not just asserted in prose. The original 14 creators and 4
campaigns from plan §9 are seeded exactly as specified otherwise.
**Also:** Seed is idempotent via `TRUNCATE ... RESTART IDENTITY CASCADE` on every run (full
reset, not an existence check) — simplest correct approach for demo data where a clean slate
is actually desirable on every `docker compose up --build`.
**IDs:** Chose `bigint` identity columns (not UUID v7) for every table's primary key — plan
§3 allows either "pick one and be consistent." Bigint identity sorts naturally for ascending
tiebreaks (plan §4.4, §4.6) without an explicit sort key, and keeps JSON payloads smaller
during manual API testing.

## 2026-10-01 — No unit-test script for apps/web

**What:** `apps/web/package.json` has no `test`/`test:run` script.
**Why:** `IMPLEMENTATION_PLAN.md` §10 requires unit tests for `packages/domain` and
integration + E2E tests for the backend/closing path, but specifies no web unit-test
requirement — the UI is verified by the Playwright E2E (Slice 6) and by walking the loop.
Declaring an empty test script would make `pnpm -r run test` either fail on "no test files
found" or silently report false coverage; omitting it is more honest than either.

## 2026-10-01 — apps/api depends on @marketplace/application and @marketplace/domain

**What:** Added `@marketplace/application` and `@marketplace/domain` as dependencies of
`apps/api` (Slice 3), plus matching `tsconfig.json` project references.
**Why:** CLAUDE.md requires business logic to live only in `packages/domain` (pure) and
`packages/application` (transactions) — the API stays thin. `apps/api/src/routes/campaigns.ts`
calls `createCampaign`/`listCampaignsForAdvertiser`/`getCampaignDetail`/
`listOpportunitiesForCreator` from `@marketplace/application` and only needs `@marketplace/domain`
for the `Platform`/`Genre` literal types used in its zod request schemas — no domain logic is
duplicated in the route handlers themselves.

## 2026-10-01 — Campaign creation's 1-minute-ahead deadline check uses app-server time

**What:** `createCampaign` (packages/application/src/campaigns.ts) validates `deadlineAt` is
at least 1 minute in the future using `Date.now()`, not a `SELECT clock_timestamp()` round trip.
**Why:** Plan §6.1's DB-clock rule governs *decisions made under a row lock* where a race
actually exists and money is on the line (accepting a bid, closing a campaign). This is a
one-time sanity check on a brand-new row nothing else can race against — there is no lock to
evaluate the clock after, and the skew between app-server and DB clocks (milliseconds, same
Docker network) is irrelevant at 1-minute granularity. Recorded here because it could look
like an inconsistency with §6.1 at a glance; it isn't the same category of check.

## 2026-10-01 — Bug found and fixed: `clock_timestamp()` returns a string via `db.execute`, not a `Date`

**What:** `placeBid`/`withdrawBid` read `clock_timestamp()` via `tx.execute<{ now: Date }>(sql...)`
and compared it directly against `campaign.deadlineAt` with `<=`. An integration test
("rejects bidding past the deadline with BIDDING_ENDED") caught this returning the bid as
successful instead of rejecting.
**Root cause:** `db.execute(sql...)` returns raw node-postgres driver rows, not Drizzle's
schema-mapped types. For a raw query, `timestamptz` comes back as a STRING (e.g.
`"2026-10-01 19:27:54.586+00"`), not a `Date` — the `<Date>` type parameter was a lie TypeScript
had no way to catch. Comparing `Date <= string` with `<=` coerces both to numbers; `Number()`
on that string is `NaN`, and any comparison against `NaN` is `false` — so the deadline check
could **never fire**, silently. Confirmed by direct reproduction (`rows[0].now` logged as a
string; `deadlineAt <= now` logged `false` even though `now` was later).
**Fix:** Added `readClockTimestamp(tx)` in `packages/application/src/mappers.ts` — types the
raw result as `string` and wraps it in `new Date(...)` before returning. Both `placeBid` and
`withdrawBid` use it; `apps/api/src/routes/health.ts`'s `/time` endpoint was refactored to use
the same helper (it already happened to wrap in `new Date()` correctly, so no bug there, but
now there is exactly one place this pattern lives).
**Why this matters beyond this slice:** Slice 5's closing job reads `clock_timestamp()` the
same way to decide which campaigns are due. Catching this now, before Slice 5 is written,
means the closer is built on the already-fixed, tested helper rather than repeating the bug.

## 2026-10-01 — packages/application test files run sequentially, not in parallel

**What:** `packages/application/vitest.config.ts` sets `fileParallelism: false`.
**Why:** Vitest runs test files in parallel worker threads by default. These are integration
tests against one real, shared Postgres instance (no per-file isolation, no mocks). Running
`closing.test.ts` and `closing-race.test.ts` concurrently caused real failures: both assume
they're the only source of "due" campaigns at a given moment, since `closeNextDueCampaign`
claims whichever campaign is next-due *globally*, not a specific one. In parallel, one file's
fixture campaign could be claimed and closed by the other file's closer call mid-test. This
is a test-isolation bug, not a product bug — the closing job's own concurrency tests
(`closing-race.test.ts`) proved the locking is correct; the flakiness was two *test files*
racing each other, which only `fileParallelism: false` fixes without weakening what's tested.
**Tradeoff:** Slower test runs for this package. Acceptable at this suite's size (~40 tests).

## 2026-10-01 — Bug found and fixed: `apiFetch` dropped `Content-Type` on every actor-scoped request

**What:** `apps/web/src/api/client.ts`'s `apiFetch` built its `fetch()` options as
`{ headers: {...merged}, ...init }` — spreading `...init` AFTER the `headers` key meant
`init`'s own (unmerged) `headers` object completely overwrote the carefully merged one,
since object spread lets later keys win. Every call that passed custom headers — which is
every actor-scoped call: `createCampaign`, `placeBid`, `withdrawBid`, `listCampaignBids`,
`getCampaignDetail`, `getCampaignResult` — silently lost `Content-Type: application/json`.
**Symptom:** Fastify couldn't parse the request body as JSON without that header, so
`req.body` arrived as a raw string. Zod's validation then failed at the schema root with
`"Expected object, received string"`, which `sendApplicationError` surfaced as a generic
400 — a confusing error with no obvious connection to a header ordering bug.
**How it was found:** The Playwright E2E test (`apps/web/e2e/marketplace.spec.ts`) — the
*first* automated test to exercise the real browser `fetch` client. Every other test
(`packages/application`, `apps/api` route tests) calls either the application layer directly
or Fastify's `app.inject()`, bypassing `apiFetch` entirely. This is a direct demonstration of
why the E2E test is required, not optional: it is structurally the only test that could have
caught this class of bug.
**Fix:** Spread `...init` first, then set `headers` afterward so it's the one that wins,
merging `init?.headers` on top of the `Content-Type` default.

## 2026-10-02 — UI redesign: shadcn/ui on Tailwind CSS v4

**What:** Replaced `apps/web`'s hand-written `styles.css` and custom CSS classes with
shadcn/ui components (`src/components/ui/*` — Button, Card, Input, Label, Textarea, Select,
Checkbox, RadioGroup, Table, Badge, Alert, Separator, Skeleton, all hand-authored from
shadcn's stable published source, not generated via its interactive CLI) on Tailwind CSS v4
(`@tailwindcss/vite`, no `tailwind.config.js` needed). New dependencies: `tailwindcss`,
`@tailwindcss/vite`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, and
the Radix UI primitives each component wraps (`@radix-ui/react-{select,checkbox,radio-group,
label,slot,separator}`). Added a `@` → `./src` import alias (Vite + tsconfig) — shadcn's
standard convention.
**Why:** User request: "improve the UI to be more elegant... use a popular frontend component
library... more modern." Presentation-layer only — no route, API, or business-logic changes.
**Scope decision — native inputs kept for deadline/platform/genre selectors:** Radix's
`RadioGroup`/`Checkbox` render as `role="radio"`/`"checkbox"` `<button>`s, not native
`<input>` elements. Rather than risk the existing Playwright E2E test's `.check()` calls
(designed for native checkbox/radio inputs) without being able to verify Radix-role support
on the installed Playwright version, `CreateCampaign.tsx`'s deadline/platform/genre selectors
stay as native `<input type="radio"/"checkbox">`, styled with Tailwind's `accent-primary`
utility. The shadcn `Checkbox`/`RadioGroup` components are still added to `components/ui/`
for consistency/future use, just not used at this one call site. Verified safe: the full E2E
suite passed unchanged on these interactions.
**One real interaction-model change:** the identity switcher became shadcn's `Select`
(Radix-based), which is not a native `<select>` and doesn't support Playwright's
`selectOption()`. Updated `apps/web/e2e/marketplace.spec.ts`'s `actAs()` helper to the Radix
combobox pattern (`getByRole("combobox").click()` → `getByRole("option", {name}).click()`).
This is the only E2E file change; every other label, button name, and status string the test
asserts on was preserved verbatim across the redesign.
**Verified:** `pnpm install`, `pnpm lint && pnpm typecheck && pnpm build` (whole workspace,
all green), `pnpm test:run` (117 backend tests, unaffected — confirms this touched `apps/web`
only), Docker web image rebuilt, and the full Playwright E2E suite re-run against the live
stack with the updated `actAs()` helper — passed end to end (~2.2 min, same as before the
redesign).

## 2026-10-02 — Closer: second `clock_timestamp()` read after the lock (F2)

**What:** `closeNextDueCampaign` (`packages/application/src/closing.ts`) now reads
`clock_timestamp()` twice: once before the claim query (predicate input only — picks
candidates for `FOR UPDATE SKIP LOCKED`), and again immediately after the row is locked,
re-asserting `claimed.status === "open" && claimed.deadlineAt <= now` before doing any writes.
`closedAt` and every bid's `updatedAt` now use this second, authoritative read.
**Why:** Plan §6.1 and the README both state the close decision is made from a clock read
taken *after* the lock. The code previously read the clock only once, before the lock — safe
in practice (`SKIP LOCKED` never blocks, so a pre-lock read can't go stale the way a blocking
reader's `now()` could), but false of what the plan and README claimed. Chose Option A from
the review (make the claim true) over Option B (rewrite the docs to describe the one-read
behavior), since the two-read version is a few lines and keeps the stronger, more obviously
correct invariant instead of arguing why a weaker one is still safe.
**Verified:** `closing.test.ts` green; existing tests cover the claim/close path.

## 2026-10-02 — Closer: per-campaign failure isolation + cross-tick backoff (F3)

**What:** `closeDueCampaigns` now catches a failure closing one campaign (via a new
`CampaignCloseError` carrying the campaign id), records it, excludes that id from the rest of
the current tick's claim queries, and continues closing other due campaigns instead of
aborting the tick. `closeNextDueCampaign` takes an `excludeIds` option for this. The worker
(`apps/worker/src/main.ts`) adds a cross-tick `Map<campaignId, {consecutiveFailures,
skipUntil}>` with exponential backoff (5s base, 5min cap) so a campaign that keeps failing is
retried on a slowing cadence rather than reclaimed — and starved by nothing else getting a
turn — on every single tick forever.
**Why:** Plan §6.3 explicitly requires "the loop logs it and continues ... with a bounded
retry/backoff so one poison campaign cannot starve others." The code previously let one
failure abort the whole tick, and the claim query's `ORDER BY deadline_at, id` meant the same
failing campaign would be reclaimed first on every subsequent tick, blocking every other due
campaign indefinitely.
**Known trigger documented, not fixed by widening the schema:** `campaign_closings`'
`bidsConsidered`/`winnersCount`/`spendCents`/`estimatedViewsTotal`/`unusedBudgetCents` columns
are `integer` (int4, max ~2.147 billion). A winner-set summing past that would fail the insert
on every retry. Left as `integer` rather than widened to `bigint` — no campaign in this
marketplace's data model approaches that scale, and backoff means such a campaign would now
degrade gracefully (retried slowly, everything else unaffected) rather than wedge the worker.
**Verified:** new test in `closing.test.ts` — a poisoned due campaign's failure doesn't block
a second due campaign in the same tick, and the failure recurs (not silently dropped) on a
later tick.

## 2026-10-02 — Crash-safety test now exercises the real closer (F5)

**What:** Added a new test in `closing.test.ts` that pre-inserts a colliding
`campaign_closings` row (PK collision) for a due campaign, then calls the real
`closeNextDueCampaign` and asserts it rejects, the campaign stays `open`, and bids stay
`active` — i.e. the actual closer's crash-mid-transaction behavior, not a hand-rolled
transaction standing in for it. The old test (which only proved Postgres rolls back an
aborted transaction in general, never calling the closer) is kept, renamed to describe what
it actually shows.
**Why:** The previous test never called `closeNextDueCampaign`, so it asserted a Postgres
property, not the closer's L3 guarantee the README cites it as proof of. Used the review's
"cheapest honest version with no production seam" option (pre-insert the PK-colliding row)
over adding a test-only hook parameter to production code.
**Verified:** both tests green; the new one also asserts a subsequent retry (after removing
the collision row) closes normally.

## 2026-10-02 — Sealed-bid actor check on `GET /creators/:id/bids` (F4)

**What:** `apps/api/src/routes/bids.ts` now requires `X-Actor-Role: creator` with
`actor.id === params.id` on `GET /creators/:id/bids`, returning 403 `FORBIDDEN_ACTOR`
otherwise — the same gate already used on the advertiser route.
**Why:** Plan §5 states bids are sealed between creators; this route had no actor check at
all and, verified live, returned another creator's active bid amount with zero headers. Every
other route touching another actor's bid data already enforces this; this was the one gap.
**Verified:** new route test for the cross-creator 403 case, plus the existing happy path
updated to send the now-required actor headers. `apps/web`'s `listCreatorBids` call sites
updated to pass identity headers.

## 2026-10-02 — Money range validation + global error handler (F6)

**What:** Added `MAX_MONEY_CENTS = 2_000_000_000` with `.max()` on `budgetCents`,
`targetCpmCents`, `maxCpmCents` (campaigns) and `amountCents` (bids) in the zod request
schemas. Added `app.setErrorHandler()` in `apps/api/src/app.ts` mapping any error that isn't
an `ApplicationError` to `{ error: { code: "INTERNAL", message: "internal error" } }` with
500, logging the real error server-side only.
**Why:** An out-of-range `budgetCents` previously reached Postgres and came back as a raw
SQLSTATE 500 with the driver's error text, and `errorMapping.ts`'s `sendApplicationError`
already rethrew anything not an `ApplicationError` with nowhere to land — so the documented
`INTERNAL` error code was never actually emitted by the API. The int4 ceiling (~2.147 billion)
is the real constraint being enforced early instead of surfaced from the DB.
**Verified:** new test asserting an oversized budget yields 400 `VALIDATION_ERROR`; new
`errorHandler.test.ts` asserting an arbitrary thrown error maps to the exact `INTERNAL`
envelope with no sensitive detail (e.g. connection/column info) in the response body.

## 2026-10-02 — README accuracy: bid privacy and ranking-dependence claims (F7)

**What:** Corrected two README claims. "other creators' amounts are never revealed" →
describes the actual, deliberate design: losing bids are never revealed, winning amounts are
published to everyone post-close so both sides can audit the outcome. "your position depends
on your own numbers" → restored to match `IMPLEMENTATION_PLAN.md`'s own wording: rank depends
on other bids' value ratios and winning depends on budget consumed above you; what's simple
and auditable is the *rule*, not that outcomes are independent of other bidders. Also added
two entries to the "Honest limits" section: greedy outcomes depend on the whole bid set, and
published winning prices invite undercutting in a repeated first-price auction.
**Why:** Both claims were directly contradicted by either the code (`results.ts` publishes
winner amounts by design) or the plan's own stated wording (`IMPLEMENTATION_PLAN.md:187`:
"Greedy does NOT make outcomes independent of other bids"). No behavior changed — only the
README's description of existing, intentional behavior.

## 2026-10-02 — Race test drives the real closer via a test-only pause hook (F8)

**What:** Added `CloseNextOptions.onLockAcquired` to `closeNextDueCampaign` — an optional
hook invoked after the row lock is acquired and re-asserted, before any writes. Test-only;
never set in production code. Rewrote the "closer holds the lock first" test in
`closing-race.test.ts` to drive the real `closeNextDueCampaign` through this hook instead of
hand-copying its claim query into the test body, and to actually observe the concurrent
`placeBid` call blocking (`Promise.race` against a 300ms timer, asserting it does NOT settle
early) rather than only asserting the end state.
**Why:** The previous version reimplemented the closer's exact claim query inside the test —
if `closing.ts` ever lost `.for("update", { skipLocked: true })`, that test would keep
passing, because it was testing its own copy of the query, not the real one. It also never
observed blocking directly; it just asserted the bid was rejected after the fact, which is
consistent with blocking but doesn't rule out a race where the bid simply ran after the
closer committed for unrelated timing reasons.
**Verified:** the rewritten test passes and took ~340ms (past the 300ms "did it settle
early" window), consistent with the bid genuinely blocking on the row lock rather than
racing past it.

## 2026-10-02 — Price guidance carries estimatedViews (F9)

**What:** `PriceGuidance` (`packages/domain/src/pricing.ts`) gained `estimatedViews: number`
(the creator's `medianViews`, the same number that produces `targetPaymentCents`/
`maxPaymentCents`). Surfaced in the creator's price panel (`CampaignDetail.tsx`) with the
arithmetic spelled out ("≈42,000 expected views × €15 CPM ÷ 1,000 = €630") and as a column in
`Opportunities.tsx`.
**Why:** Plan §8.2 lists expected views as part of the price panel; the UI previously showed
only the resulting euro figures with no way to see the views behind them, which was the main
gap in the pricing model being explainable from the UI alone.

## 2026-10-02 — Active bid count exposed to creators (F10)

**What:** Added `activeBidCount: number` to `EligibleOpportunity`
(`packages/application/src/opportunities.ts`) and to `CampaignDetail`
(`packages/application/src/campaigns.ts`), computed the same way
`listCampaignsForAdvertiser` already does (`count(*) filter (where status = 'active')`).
Rendered as a column in `Opportunities.tsx` and a line in `CampaignDetail.tsx`'s price panel.
**Why:** Plan §4.4 and §5 both promise creators "the count of active bids" as their one
competition signal, since individual bid amounts stay sealed between creators. Nothing in the
API or UI exposed it before this.

## 2026-10-02 — Bid form defaults to the clamped suggestion, not raw target (F11)

**What:** `BidForm.tsx` now seeds its amount input from `suggestedDefaultBidCents(guidance)`
(`clamp(max(minFee, targetPayment), minFee, maxPayment)`) instead of the raw
`targetPaymentCents`.
**Why:** `suggestedDefaultBidCents` already existed, was unit-tested, and implements plan
§4.3's clamp — but was never called. A tier-2 creator (target below their minimum fee) was
opening the form pre-filled with an amount the UI itself immediately flagged as "would be
rejected."

## 2026-10-02 — Dropped the unused `/time` endpoint (F12)

**What:** Removed `GET /time` (`apps/api/src/routes/health.ts`), its test, and its mention in
the README's endpoint list.
**Why:** Plan §8 described server-time-synced countdowns using `/time`, but nothing in
`apps/web` ever called it — every page polls every 5 seconds (`main.tsx`'s
`refetchInterval: 5000`) and renders the server-derived `displayState` (open/settling/closed)
directly, which already keeps the UI honest about campaign state without needing a
client-side ticking countdown or clock-offset math. Chose to drop the endpoint over building
the countdown feature it was added for: the 5-second poll of `displayState` already delivers
the thing a countdown is for (knowing when a campaign stops being biddable) with less code and
no clock-sync edge cases, and the endpoint had sat unused since whichever slice added it.

## 2026-10-02 — Test isolation: scratch database and live-worker hazard documented (F13)

**What:** `README.md`'s Testing section now explicitly says to point `DATABASE_URL` at a
scratch Postgres instance (with a one-line `docker run` to create one), not the
`docker compose up`-seeded database, and to make sure no worker is closing campaigns against
it concurrently while the suite runs.
**Why:** The integration suites create fixture advertisers/creators/campaigns and don't clean
them up — fine against a disposable scratch database, but running them against the seeded
demo database pollutes `GET /identities` with test fixtures, and a live `docker compose`
worker racing the same database as the closing/race tests can non-deterministically claim
their fixture campaigns. `DECISIONS.md`'s existing cross-file test-isolation entry (sequential
file execution within `packages/application`) covers the intra-suite version of this hazard;
this is the live-external-worker version of the same root cause (shared mutable database
state), addressed by keeping test runs on an isolated database rather than by code changes.

## 2026-10-02 — Seeded live-demo deadline moved from 3 to 20 minutes (F14)

**What:** `packages/db/src/seed.ts`'s "Weekend Flash — Beauty Try-On" campaign now has a
20-minute deadline instead of 3. The README's quick-start step 4 now leads with Create
Campaign's "2 minutes (demo)" preset (timing the reviewer controls directly) and mentions the
seeded campaign as a fallback for bidding on an existing one, rather than leading with it.
**Why:** A 3-minute window was usually already closed by the worker before a reviewer
finished the earlier quick-start steps and got here, making the documented demo
unreproducible by the time they tried it.

## 2026-10-02 — "Why not" eligibility copy no longer prints raw JSON (F15)

**What:** `formatEligibilityReason` (`apps/web/src/shared/format.ts`) now renders
`reason.required` as a human-joined, capitalized list ("Tiktok or Instagram") instead of
`JSON.stringify`/`String()` output (`["tiktok"]`).
**Why:** This copy is one of the showcase features of the matching story (plan §4.4's "why
not" UI); printing a raw JSON array undercut it.

## 2026-10-02 — Container hygiene: non-root nginx, frozen lockfile installs, api healthcheck (F16)

**What:** Three independent fixes:
- `apps/web/Dockerfile`'s runtime stage switched from `nginx:1.27-alpine` to
  `nginxinc/nginx-unprivileged:1.27-alpine`, which runs as a non-root user out of the box
  (listens on 8080, writable pid/cache paths already configured). `nginx.conf` and the
  compose `web` port mapping updated to 8080 accordingly.
- All four Dockerfiles (`packages/db`, `apps/api`, `apps/worker`, `apps/web`) now `COPY
  pnpm-lock.yaml` into their deps stage and run `pnpm install --frozen-lockfile` instead of
  `--no-frozen-lockfile`, so a Docker image's dependency resolution can no longer silently
  diverge from the lockfile the test suite ran against.
- `docker-compose.yml`'s `api` service gained a healthcheck hitting `/health`; `web` now
  depends on `api` being healthy (`condition: service_healthy`) instead of a bare
  `depends_on`, so `web` doesn't start serving a UI pointed at an API that isn't up yet.
**Why:** `IMPLEMENTATION_PLAN.md` §14 says "non-root containers" — api/worker/migrate already
ran as a non-root `app` user, but `web`'s nginx master process ran as root. The frozen
lockfile matters because only a subset of `package.json` manifests is copied into each
image's deps stage (by design, for layer caching); without `--frozen-lockfile`, a dependency
bump could resolve differently at image-build time than it did under `pnpm install` on the
host the test suite ran on.
**Verified:** `docker compose down -v && docker compose build` from scratch, then
`docker compose up` — all services start, migrate (now also building `@marketplace/domain`,
see the next entry) completes successfully, api reports healthy, and web serves behind the
non-root nginx image.

## 2026-10-02 — seed.ts imports PRICING_POLICY_VERSION from @marketplace/domain (F20)

**What:** `packages/db/src/seed.ts` previously hardcoded a local
`PRICING_POLICY_VERSION = "median-views-v1"` constant with a comment saying it "matches the
version string packages/domain will export once built (Slice 2)" — a sequencing note from
when `db` was built before `domain` existed. Now imports the real constant from
`@marketplace/domain`, which `packages/db` depends on as a real (not dev) dependency.
`packages/db/tsconfig.json` gained a project reference to `../domain`, and
`packages/db/Dockerfile` (the one-shot `migrate` service image) now also copies and builds
`packages/domain` before building `packages/db`, since `seed.js` needs its compiled output
at runtime.
**Why:** `packages/domain` has existed, built, and been the single source of truth for this
constant since partway through this project — the hardcoded duplicate could silently drift
from it with no test catching the mismatch. Importing the real constant removes the
duplication entirely rather than adding a test that only checks the two stay in sync.
**Verified:** `pnpm typecheck`/`pnpm test:run` green; `docker compose build` confirms the
`migrate` image still builds and runs `migrate.js && seed.js` successfully with the added
`@marketplace/domain` build step.

## 2026-10-02 — react-hooks lint rules added for apps/web (F20)

**What:** Added `eslint-plugin-react-hooks` (pinned to the stable `^5.2.0` line — the newer
v7 major is a React-Compiler-oriented rewrite with an incompatible flat-config shape and a
much larger, not-applicable ruleset) to `eslint.config.js`, scoped to `apps/web/src/**/*.tsx`
with `rules-of-hooks` (error) and `exhaustive-deps` (warn).
**Why:** The base config was `@eslint/js` + `typescript-eslint` `recommended` only — no
React-specific linting at all, so a whole class of UI bug (stale closures from missing
effect dependencies, hooks called conditionally) went unlinted in the one package that uses
React.
**Verified:** `pnpm lint` passes clean with the new rules active (confirmed the plugin is
genuinely wired — not just silently absent — since ESLint errors loudly on a misregistered
plugin/rule reference, and it didn't).

## 2026-10-02 — Closer no longer clobbers bids.updated_at (F18)

**What:** Added a nullable `decided_at timestamptz` column to `bids`
(`packages/db/drizzle/0001_supreme_firestar.sql`). `closeNextDueCampaign` now sets
`decidedAt` on win/loss instead of `updatedAt`.
**Why:** `updatedAt` is both the creator-facing last-edit audit trail and the exact tiebreak
input `selectWinners` reads (plan §4.6: "earlier updated_at first"). The closer overwriting
it with the close timestamp corrupted both: a creator's real last-edit time became
unrecoverable, and (more subtly) it meant the tiebreak field's meaning silently changed from
"when did the creator last act" to "when did this bid get decided" the moment a campaign
closed — two different orderings wearing one column.
**Verified:** existing `closing.test.ts` assertions on `resultReason` still pass unchanged
(nothing asserted on `updatedAt`'s value, so nothing to update); migration applied cleanly to
the scratch database via `pnpm db:migrate`.

## 2026-10-02 — Advertiser bid table stays visible after close, with result reasons (F19)

**What:** `CampaignDetail.tsx` no longer hides the advertiser's bid table once
`displayState === "closed"` — it now renders both before and after close.
`AdvertiserBidView` (`packages/application/src/bids.ts`) and `AdvertiserBidsTable.tsx` gained
a `resultReason` column, reusing the same per-bid explanation text the closer already writes
and that creators already see in `MyBids.tsx`.
**Why:** Post-close, an advertiser could see winners and aggregate spend
(`CampaignResultPanel`) but not who lost or why — losing that visibility right when it
becomes most informative (the outcome is now known) for no reason tied to the data actually
being unavailable.

## 2026-10-02 — Error-code logging, 404 route, error boundary, retry buttons (F17 / F22)

**What:** Four small, independent additions:
- `apps/api/src/errorMapping.ts`'s `sendApplicationError` now logs `{ code, message }` for
  every `ApplicationError` response (`reply.log.info`), which is what makes the README's
  "stable codes designed to be dashboarded directly" claim actually true — previously nothing
  logged the code, so a log-based dashboard would have had nothing to aggregate.
- The Playwright E2E test's `getByText("Marta Fit (@fit_marta)")` became ambiguous once F19
  (above) made the advertiser's bid table render post-close too — the same name now appears
  both in that table's `<td>` and in the results panel's winners `<li>`. Fixed by scoping the
  assertion to `getByRole("listitem").filter({ hasText: ... })`, which only matches the
  winners list, not the bid table row — found and fixed during this review pass's own final
  verification run, not a pre-existing bug.
- `App.tsx` gained a catch-all `path="*"` route ("Page not found") and a top-level
  `ErrorBoundary` class component wrapping `<Routes>`, so an unknown path or a render throw
  no longer blanks the page silently.
- The four pages with a query error state (`Opportunities`, `CampaignDetail`, `MyCampaigns`,
  `MyBids`) now render a shared `ErrorRetry` component (an `Alert` plus a "Try again" button
  calling the query's own `refetch()`) instead of a dead-end error message.
**Why:** All four were small, cheap "F17/F22, independent review" gaps — logging making an
existing doc claim true rather than aspirational, and the UI edges being one-line-per-page
additions once a shared `ErrorRetry`/`ErrorBoundary` component existed.

---

<!-- New entries go below this line. -->
