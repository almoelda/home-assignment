import { compareRatioDescending } from "./money.js";
import { SELECTION_ALGORITHM_VERSION } from "./types.js";

export { SELECTION_ALGORITHM_VERSION };

export interface BidCandidate {
  id: number;
  amountCents: number;
  estimatedViews: number;
  updatedAt: Date;
}

export interface LossReason {
  code: "LOST_BUDGET";
  neededCents: number;
  remainingCents: number;
}

export interface WonBid {
  id: number;
  rank: number;
}

export interface LostBid {
  id: number;
  rank: number;
  reason: LossReason;
}

export interface WinnerSelectionResult {
  selected: WonBid[];
  skipped: LostBid[];
  spendCents: number;
  estimatedViewsTotal: number;
  unusedCents: number;
}

/**
 * Deterministic greedy winner selection (plan §4.6). Honest about its limits: this is a
 * heuristic, not an optimal knapsack solve — see the "greedy-suboptimal" fixture test, which
 * documents a real case where it leaves more views on the table than the best possible
 * combination. We accept that in exchange for a rule a creator can be shown and believe:
 * rank depends only on your own numbers, the budget runs out where it runs out, and a
 * cheaper or better-value bid never gets silently skipped once a worse one has fit.
 *
 * 1. Sort by value ratio (estimatedViews / amountCents) descending.
 * 2. Ties: earlier updatedAt first, then smaller id (a total order — required so the result
 *    is identical on every run, which is what makes the closing job's idempotency
 *    meaningful; an unstable sort would make "safe to run twice" false even with perfect
 *    locking).
 * 3. Walk the ranked list; take anything that still fits; SKIP AND CONTINUE past anything
 *    that doesn't, rather than stopping — a later, cheaper bid should not be blocked by an
 *    earlier one that happened not to fit.
 */
export function selectWinners(
  bids: readonly BidCandidate[],
  budgetCents: number,
): WinnerSelectionResult {
  const ranked = [...bids].sort((a, b) => {
    const byRatio = compareRatioDescending(a.estimatedViews, a.amountCents, b.estimatedViews, b.amountCents);
    if (byRatio !== 0) return byRatio;
    const byTime = a.updatedAt.getTime() - b.updatedAt.getTime();
    if (byTime !== 0) return byTime;
    return a.id - b.id;
  });

  const selected: WonBid[] = [];
  const skipped: LostBid[] = [];
  let remainingCents = budgetCents;
  let spendCents = 0;
  let estimatedViewsTotal = 0;

  ranked.forEach((bid, index) => {
    const rank = index + 1;
    if (bid.amountCents <= remainingCents) {
      selected.push({ id: bid.id, rank });
      remainingCents -= bid.amountCents;
      spendCents += bid.amountCents;
      estimatedViewsTotal += bid.estimatedViews;
    } else {
      skipped.push({
        id: bid.id,
        rank,
        reason: { code: "LOST_BUDGET", neededCents: bid.amountCents, remainingCents },
      });
    }
  });

  return { selected, skipped, spendCents, estimatedViewsTotal, unusedCents: remainingCents };
}
