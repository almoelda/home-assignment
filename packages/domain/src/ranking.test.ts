import { describe, expect, it } from "vitest";
import { classifyTier, rankOpportunities, type RankedOpportunity } from "./ranking.js";
import type { PriceGuidance } from "./pricing.js";

function guidance(minFeeCents: number, targetPaymentCents: number, maxPaymentCents: number): PriceGuidance {
  return {
    minFeeCents,
    targetPaymentCents,
    maxPaymentCents,
    estimatedViews: 0,
    hasCompatiblePrice: minFeeCents <= maxPaymentCents,
  };
}

function opportunity(
  campaignId: number,
  g: PriceGuidance,
  deadlineAt = new Date("2030-01-01T00:00:00Z"),
): RankedOpportunity {
  return { campaignId, guidance: g, deadlineAt };
}

describe("classifyTier", () => {
  it("is tier 1 when target payment meets or exceeds the minimum fee", () => {
    expect(classifyTier(guidance(20, 33, 66))).toBe(1);
    expect(classifyTier(guidance(33, 33, 66))).toBe(1); // exact boundary
  });

  it("is tier 2 when target falls short but a compatible price still exists", () => {
    expect(classifyTier(guidance(40, 33, 66))).toBe(2);
  });

  it("is tier 3 when even the max payment can't reach the minimum fee", () => {
    expect(classifyTier(guidance(100, 33, 66))).toBe(3);
  });
});

describe("compareOpportunities", () => {
  it("always ranks a lower tier before a higher tier, regardless of ratio", () => {
    const t1 = opportunity(10, guidance(20, 33, 66)); // tier 1
    const t2 = opportunity(11, guidance(40, 33, 66)); // tier 2
    const t3 = opportunity(12, guidance(100, 33, 66)); // tier 3
    const ranked = rankOpportunities([t3, t2, t1]);
    expect(ranked.map((o) => o.campaignId)).toEqual([10, 11, 12]);
  });

  it("within a tier, ranks higher target/minFee ratio first", () => {
    const highRatio = opportunity(1, guidance(10, 33, 66)); // ratio 3.3
    const lowRatio = opportunity(2, guidance(30, 33, 66)); // ratio 1.1
    const ranked = rankOpportunities([lowRatio, highRatio]);
    expect(ranked.map((o) => o.campaignId)).toEqual([1, 2]);
  });

  it("breaks a ratio tie by earlier deadline", () => {
    const sameRatioLaterDeadline = opportunity(1, guidance(10, 20, 66), new Date("2030-02-01T00:00:00Z"));
    const sameRatioEarlierDeadline = opportunity(2, guidance(10, 20, 66), new Date("2030-01-01T00:00:00Z"));
    const ranked = rankOpportunities([sameRatioLaterDeadline, sameRatioEarlierDeadline]);
    expect(ranked.map((o) => o.campaignId)).toEqual([2, 1]);
  });

  it("breaks a ratio-and-deadline tie by smaller campaign id", () => {
    const sameDeadline = new Date("2030-01-01T00:00:00Z");
    const higherId = opportunity(99, guidance(10, 20, 66), sameDeadline);
    const lowerId = opportunity(5, guidance(10, 20, 66), sameDeadline);
    const ranked = rankOpportunities([higherId, lowerId]);
    expect(ranked.map((o) => o.campaignId)).toEqual([5, 99]);
  });

  it("does not mutate the input array", () => {
    const list = [opportunity(2, guidance(100, 33, 66)), opportunity(1, guidance(20, 33, 66))];
    const original = [...list];
    rankOpportunities(list);
    expect(list).toEqual(original);
  });
});
