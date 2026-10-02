import { bids, campaignClosings, campaigns, type Database } from "@marketplace/db";
import { SELECTION_ALGORITHM_VERSION, selectWinners, type BidCandidate } from "@marketplace/domain";
import { and, asc, eq, lte, notInArray } from "drizzle-orm";
import { readClockTimestamp } from "./mappers.js";

function eur(cents: number): string {
  return `EUR ${(cents / 100).toFixed(2)}`;
}

/**
 * Thrown (and caught) only inside this module, so a failure closing one specific campaign can
 * carry its id back out of a transaction that otherwise has no return value on the error path
 * (plan §6.3: "the loop logs it and continues ... so one poison campaign cannot starve
 * others"). `cause` preserves the original error for logging.
 */
export class CampaignCloseError extends Error {
  constructor(
    public readonly campaignId: number,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "CampaignCloseError";
    this.cause = cause;
  }
}

export type CloseResult =
  | { closed: false }
  | {
      closed: true;
      campaignId: number;
      bidsConsidered: number;
      winnersCount: number;
      spendCents: number;
      estimatedViewsTotal: number;
      unusedBudgetCents: number;
    };

/**
 * Plan §6.3 — claims and closes AT MOST ONE due campaign, atomically. Returns
 * `{ closed: false }` when nothing is due.
 *
 * Five correctness layers, none of which depend on the others being right (plan §6):
 *
 *   L1  `FOR UPDATE SKIP LOCKED`, inside the SAME transaction that closes the campaign.
 *       `LIMIT 1` is load-bearing: a row lock lives exactly as long as the transaction that
 *       took it. Claiming a batch in one transaction and closing each in a separate one would
 *       release every lock before any work happened. Claim one, close it, commit, repeat.
 *   L2  `status = 'open'` evaluated UNDER the lock is the idempotency guard itself — a
 *       campaign another worker already closed is simply not in the result set. Not a
 *       separate check bolted on afterward.
 *   L3  One transaction per campaign. A crash anywhere in this function rolls back
 *       everything: the campaign is still 'open' with 'active' bids for the next run to
 *       redo cleanly from scratch. A partially-closed auction is never observable.
 *   L4  `campaign_closings.campaign_id` is the PRIMARY KEY. Even if every line of the
 *       locking logic above were wrong, a second close attempt dies on a unique-violation
 *       and the transaction aborts — a backstop that doesn't depend on this code being
 *       correct.
 *   L5  The budget invariant is asserted before anything commits; violating it throws and
 *       rolls back the whole transaction rather than persisting an overspend.
 *
 * The clock rule (plan §6.1): the timestamp that decides a campaign's fate is read AFTER the
 * row lock is acquired, inside this transaction — never application-server time. The read
 * below the `FOR UPDATE SKIP LOCKED` call is a predicate input only (it picks *candidates* to
 * attempt to claim); `SKIP LOCKED` never blocks waiting for a lock, so that pre-lock read
 * cannot go stale the way a blocking reader's `now()` could. The read immediately AFTER the
 * lock (`now`, below) is the authoritative one: it is what's used for `closed_at` and every
 * bid's decision timestamp, and it's re-checked against the claimed row before any write,
 * so the actual close decision is always made from a timestamp taken while holding the lock.
 * Combined with `placeBid`'s own `FOR UPDATE` on the campaign row
 * (packages/application/src/bids.ts), a bid either commits before this transaction's lock, or
 * blocks until this transaction commits and then sees `status = 'closed'` and is rejected.
 * Never half-included, never silently orphaned.
 */
export interface CloseNextOptions {
  /** Campaigns to skip even if due — the current tick's already-failed ids (plan §6.3: a
   * failing campaign must not be reclaimed ahead of every other due campaign on every tick). */
  excludeIds?: number[];
  /** Test-only seam: invoked after the row lock is acquired and re-asserted, before any
   * writes — lets a test pause the real transaction mid-flight to observe a concurrent
   * writer actually block on the lock, rather than replaying the claim query in the test body
   * (see closing-race.test.ts). Never set outside tests. */
  onLockAcquired?: () => Promise<void> | void;
}

export async function closeNextDueCampaign(db: Database, options: CloseNextOptions = {}): Promise<CloseResult> {
  const excludeIds = options.excludeIds ?? [];

  return db.transaction(async (tx) => {
    const claimTime = await readClockTimestamp(tx);

    const conditions = [eq(campaigns.status, "open"), lte(campaigns.deadlineAt, claimTime)];
    if (excludeIds.length > 0) {
      conditions.push(notInArray(campaigns.id, excludeIds));
    }

    const [claimed] = await tx
      .select()
      .from(campaigns)
      .where(and(...conditions))
      .orderBy(asc(campaigns.deadlineAt), asc(campaigns.id))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!claimed) {
      return { closed: false };
    }

    // Authoritative: taken AFTER the lock. Re-asserted against the claimed row rather than
    // trusted implicitly — while nothing in this codebase mutates deadline_at or status once
    // claimed (the lock alone would prevent it), this is what makes the clock rule true of the
    // code rather than merely true in practice.
    const now = await readClockTimestamp(tx);
    if (claimed.status !== "open" || claimed.deadlineAt > now) {
      return { closed: false };
    }

    if (options.onLockAcquired) {
      await options.onLockAcquired();
    }

    // Everything past this point is specific to THIS campaign. Any failure here — a bug, a
    // constraint violation, a value genuinely out of range — must not take down the whole
    // tick: wrapped so the caller (closeDueCampaigns) can isolate it to this one campaign,
    // exclude it, and keep closing everything else that's due.
    try {
      const activeBidRows = await tx
        .select()
        .from(bids)
        .where(and(eq(bids.campaignId, claimed.id), eq(bids.status, "active")));

      const candidates: BidCandidate[] = activeBidRows.map((b) => ({
        id: b.id,
        amountCents: b.amountCents,
        estimatedViews: b.estimatedViews,
        updatedAt: b.updatedAt,
      }));

      const selection = selectWinners(candidates, claimed.budgetCents);

      // L5. Refuse to commit rather than overspend — throwing here rolls the whole
      // transaction back and leaves the campaign open for the next run to retry.
      if (selection.spendCents > claimed.budgetCents) {
        throw new Error(
          `budget invariant violated for campaign ${claimed.id}: spend ${selection.spendCents} > budget ${claimed.budgetCents}`,
        );
      }

      // decidedAt (not updatedAt) carries the close timestamp — updatedAt stays the
      // creator's own last-edit time, both because selectWinners' tiebreak reads it (plan
      // §4.6: "earlier updated_at first") and because it's the creator-facing audit trail;
      // the close must not overwrite either.
      for (const won of selection.selected) {
        await tx
          .update(bids)
          .set({
            status: "won",
            resultReason: `Selected — ranked #${won.rank} by value (views per cent), awarded your full bid.`,
            decidedAt: now,
          })
          .where(eq(bids.id, won.id));
      }

      for (const lost of selection.skipped) {
        await tx
          .update(bids)
          .set({
            status: "lost",
            resultReason:
              `Insufficient remaining budget (needed ${eur(lost.reason.neededCents)}, remaining ` +
              `${eur(lost.reason.remainingCents)}) when your bid was considered at rank #${lost.rank}.`,
            decidedAt: now,
          })
          .where(eq(bids.id, lost.id));
      }

      await tx.update(campaigns).set({ status: "closed", closedAt: now }).where(eq(campaigns.id, claimed.id));

      // L4. Structural backstop: campaign_id is PRIMARY KEY, so a concurrent double-close
      // (however it happened) dies here on a unique-violation rather than committing twice.
      // Also the practical ceiling on this slice's scale: bidsConsidered/winnersCount/
      // spendCents/estimatedViewsTotal/unusedBudgetCents are `integer` (int4, max ~2.147
      // billion) — a single campaign's winning views would need to sum past that to fail this
      // insert. Documented here rather than widened to bigint: no campaign in this
      // marketplace's data model approaches that scale (DECISIONS.md).
      await tx.insert(campaignClosings).values({
        campaignId: claimed.id,
        algorithmVersion: SELECTION_ALGORITHM_VERSION,
        bidsConsidered: candidates.length,
        winnersCount: selection.selected.length,
        spendCents: selection.spendCents,
        estimatedViewsTotal: selection.estimatedViewsTotal,
        unusedBudgetCents: selection.unusedCents,
      });

      return {
        closed: true,
        campaignId: claimed.id,
        bidsConsidered: candidates.length,
        winnersCount: selection.selected.length,
        spendCents: selection.spendCents,
        estimatedViewsTotal: selection.estimatedViewsTotal,
        unusedBudgetCents: selection.unusedCents,
      };
    } catch (err) {
      throw new CampaignCloseError(claimed.id, err);
    }
  });
}

export interface CloseFailure {
  campaignId: number;
  error: string;
}

export interface CloseTickSummary {
  results: CloseResult[];
  failures: CloseFailure[];
}

/**
 * Closes every campaign that is currently due, one transaction each (plan §6.3: "the worker
 * loops until nothing is due, then sleeps ... with a bounded retry/backoff so one poison
 * campaign cannot starve others").
 *
 * Failure isolation: if closing one campaign throws, that transaction alone rolls back (the
 * campaign stays `open`, nothing partial persists) and this loop records the failure and
 * CONTINUES to the next due campaign — it does not stop the tick. Without excluding the
 * failed id, the claim query's `ORDER BY deadline_at, id` would simply reclaim the same
 * failing campaign first on every subsequent iteration of this same loop, since nothing about
 * the row changed; `excludeIds` is what lets the rest of the tick's due campaigns actually get
 * a turn. A genuinely unexpected error (e.g. the database connection itself is gone, not a
 * per-campaign problem) is not a `CampaignCloseError` and is left to propagate — isolating a
 * bad campaign is not the same as pretending the whole process is healthy.
 */
export async function closeDueCampaigns(
  db: Database,
  maxPerTick = 100,
  initiallyExcludedIds: number[] = [],
): Promise<CloseTickSummary> {
  const results: CloseResult[] = [];
  const failures: CloseFailure[] = [];
  // Seeded with the caller's own backed-off ids (e.g. the worker's cross-tick backoff map, so
  // a campaign that failed on a previous tick isn't retried every single tick forever) plus
  // whatever fails within this call.
  const excludeIds: number[] = [...initiallyExcludedIds];

  for (let i = 0; i < maxPerTick; i++) {
    try {
      const result = await closeNextDueCampaign(db, { excludeIds });
      results.push(result);
      if (!result.closed) break;
    } catch (err) {
      if (err instanceof CampaignCloseError) {
        failures.push({ campaignId: err.campaignId, error: err.message });
        excludeIds.push(err.campaignId);
        continue;
      }
      throw err;
    }
  }

  return { results, failures };
}
