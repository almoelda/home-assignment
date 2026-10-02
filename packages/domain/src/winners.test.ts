import { describe, expect, it } from "vitest";
import { selectWinners, type BidCandidate } from "./winners.js";

const t = (iso: string) => new Date(iso);

function bid(id: number, amountCents: number, estimatedViews: number, updatedAt = t("2030-01-01T00:00:00Z")): BidCandidate {
  return { id, amountCents, estimatedViews, updatedAt };
}

describe("selectWinners", () => {
  it("selects nothing and spends nothing for zero bids", () => {
    const result = selectWinners([], 100_000);
    expect(result).toEqual({
      selected: [],
      skipped: [],
      spendCents: 0,
      estimatedViewsTotal: 0,
      unusedCents: 100_000,
    });
  });

  it("selects all bids that fit, in value-ratio order, when budget is ample", () => {
    const bids = [bid(1, 10_000, 50_000), bid(2, 5_000, 10_000)]; // ratios: 5.0, 2.0
    const result = selectWinners(bids, 100_000);
    expect(result.selected.map((w) => w.id)).toEqual([1, 2]);
    expect(result.skipped).toEqual([]);
    expect(result.spendCents).toBe(15_000);
    expect(result.estimatedViewsTotal).toBe(60_000);
    expect(result.unusedCents).toBe(85_000);
  });

  it("skips an unaffordable bid and CONTINUES past it to a cheaper one that still fits", () => {
    // ratio order: id 1 (5.0) > id 2 (2.0) > id 3 (1.0). Budget 100: id 1 is taken first
    // (remaining 80), id 2 needs 100 and doesn't fit (skipped, NOT a stopping point), id 3
    // needs only 50 and fits in what's left — proving the algorithm continues past a miss.
    const bids = [
      bid(1, 20, 100), // ratio 5.0 -> taken, remaining 80
      bid(2, 100, 200), // ratio 2.0 -> doesn't fit in 80, skipped
      bid(3, 50, 50), // ratio 1.0 -> fits in remaining 80, taken
    ];
    const result = selectWinners(bids, 100);
    expect(result.selected.map((w) => w.id)).toEqual([1, 3]);
    expect(result.skipped.map((s) => s.id)).toEqual([2]);
    expect(result.skipped[0]?.reason).toEqual({ code: "LOST_BUDGET", neededCents: 100, remainingCents: 80 });
    expect(result.spendCents).toBe(70);
    expect(result.unusedCents).toBe(30);
  });

  it("breaks a value-ratio tie by earlier updatedAt, then by smaller id", () => {
    const sameRatioLaterUpdate = bid(2, 100, 100, t("2030-02-01T00:00:00Z"));
    const sameRatioEarlierUpdate = bid(1, 100, 100, t("2030-01-01T00:00:00Z"));
    const result = selectWinners([sameRatioLaterUpdate, sameRatioEarlierUpdate], 1000);
    expect(result.selected.map((w) => w.rank)).toEqual([1, 2]);
    expect(result.selected.map((w) => w.id)).toEqual([1, 2]);
  });

  it("breaks a ratio-and-time tie by smaller id", () => {
    const sameEverything = t("2030-01-01T00:00:00Z");
    const higherId = bid(99, 100, 100, sameEverything);
    const lowerId = bid(5, 100, 100, sameEverything);
    const result = selectWinners([higherId, lowerId], 1000);
    expect(result.selected.map((w) => w.id)).toEqual([5, 99]);
  });

  it("loses a single bid that exceeds the entire budget", () => {
    const result = selectWinners([bid(1, 200, 1000)], 100);
    expect(result.selected).toEqual([]);
    expect(result.skipped).toEqual([{ id: 1, rank: 1, reason: { code: "LOST_BUDGET", neededCents: 200, remainingCents: 100 } }]);
    expect(result.unusedCents).toBe(100);
  });

  it("wins a bid that fits exactly, leaving zero unused budget", () => {
    const result = selectWinners([bid(1, 100, 500)], 100);
    expect(result.selected).toEqual([{ id: 1, rank: 1 }]);
    expect(result.unusedCents).toBe(0);
  });

  it("does not mutate the input array", () => {
    const bids = [bid(2, 100, 100), bid(1, 50, 400)];
    const original = [...bids];
    selectWinners(bids, 1000);
    expect(bids).toEqual(original);
  });

  it("produces the same result regardless of input order (determinism)", () => {
    const bids = [bid(1, 10_000, 50_000), bid(2, 5_000, 10_000), bid(3, 30_000, 20_000)];
    const forward = selectWinners(bids, 40_000);
    const shuffled = selectWinners([bids[2]!, bids[0]!, bids[1]!], 40_000);
    expect(shuffled.selected).toEqual(forward.selected);
    expect(shuffled.skipped).toEqual(forward.skipped);
  });

  /**
   * The documented greedy-vs-optimal example from IMPLEMENTATION_PLAN.md §4.7, reproduced
   * exactly (and also live in packages/db/src/seed.ts as "Demo: Greedy vs Optimal Selection").
   * Budget €1,000. Greedy (this function) takes B+E = 80k views, leaving €310 unused, even
   * though B+A+D = 100k views for €980 fits the same budget. This is the honest limit the
   * README documents: greedy is a heuristic, not an optimal knapsack solve.
   */
  it("greedy-suboptimal: documents a real case where greedy leaves more views on the table than the optimum", () => {
    const B = bid(1, 15_000, 20_000); // ratio 1.333 - EUR 150 / 20k views
    const E = bid(2, 54_000, 60_000); // ratio 1.111 - EUR 540 / 60k views
    const A = bid(3, 50_000, 50_000); // ratio 1.000 - EUR 500 / 50k views
    const D = bid(4, 33_000, 30_000); // ratio 0.909 - EUR 330 / 30k views
    const budgetCents = 100_000; // EUR 1,000

    const result = selectWinners([B, E, A, D], budgetCents);

    // Greedy's actual result: B + E.
    expect(result.selected.map((w) => w.id)).toEqual([1, 2]);
    expect(result.spendCents).toBe(69_000);
    expect(result.estimatedViewsTotal).toBe(80_000);
    expect(result.unusedCents).toBe(31_000);

    // The optimum it misses: B + A + D fits the same budget for more total views.
    const optimalSpend = B.amountCents + A.amountCents + D.amountCents;
    const optimalViews = B.estimatedViews + A.estimatedViews + D.estimatedViews;
    expect(optimalSpend).toBeLessThanOrEqual(budgetCents);
    expect(optimalViews).toBeGreaterThan(result.estimatedViewsTotal);
    expect(optimalSpend).toBe(98_000);
    expect(optimalViews).toBe(100_000);
  });
});
