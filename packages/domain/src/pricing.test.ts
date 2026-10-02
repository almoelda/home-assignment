import { describe, expect, it } from "vitest";
import {
  classifyPricePosition,
  computePriceGuidance,
  effectiveCpmCents,
  suggestedDefaultBidCents,
  validateBidAmount,
} from "./pricing.js";
import type { CampaignRequirements, CreatorProfile } from "./types.js";

const creator: CreatorProfile = {
  id: 1,
  platform: "tiktok",
  genre: "fitness",
  followers: 50_000,
  engagementBps: 400,
  medianViews: 333,
  minFeeCents: 20,
};

const campaign: CampaignRequirements = {
  id: 1,
  platforms: ["tiktok"],
  genres: ["fitness"],
  minFollowers: 0,
  minEngagementBps: 0,
  budgetCents: 1_000_000,
  targetCpmCents: 100,
  maxCpmCents: 200,
  deadlineAt: new Date("2030-01-01T00:00:00Z"),
};

describe("computePriceGuidance", () => {
  it("floors target and max payment rather than rounding", () => {
    // target = floor(333 * 100 / 1000) = floor(33.3) = 33
    // max    = floor(333 * 200 / 1000) = floor(66.6) = 66
    const guidance = computePriceGuidance(creator, campaign);
    expect(guidance.targetPaymentCents).toBe(33);
    expect(guidance.maxPaymentCents).toBe(66);
    expect(guidance.minFeeCents).toBe(20);
    expect(guidance.estimatedViews).toBe(333);
    expect(guidance.hasCompatiblePrice).toBe(true);
  });

  it("caps max payment at the campaign budget even if the CPM math allows more", () => {
    const tightBudget: CampaignRequirements = { ...campaign, budgetCents: 50 };
    const guidance = computePriceGuidance(creator, tightBudget);
    expect(guidance.maxPaymentCents).toBe(50); // min(66, 50)
  });

  it("flags no compatible price when min fee exceeds max payment", () => {
    const expensiveCreator: CreatorProfile = { ...creator, minFeeCents: 100 };
    const guidance = computePriceGuidance(expensiveCreator, campaign);
    expect(guidance.hasCompatiblePrice).toBe(false);
    expect(guidance.minFeeCents).toBeGreaterThan(guidance.maxPaymentCents);
  });
});

describe("validateBidAmount", () => {
  it("rejects an amount below the creator's minimum fee", () => {
    expect(validateBidAmount(19, creator, campaign)).toEqual({ ok: false, code: "BELOW_MIN_FEE" });
  });

  it("accepts an amount exactly at the minimum fee", () => {
    expect(validateBidAmount(20, creator, campaign)).toEqual({ ok: true });
  });

  it("accepts an amount exactly at the exact-CPM max (66)", () => {
    expect(validateBidAmount(66, creator, campaign)).toEqual({ ok: true });
  });

  it("rejects an amount one cent above the exact-CPM max (67)", () => {
    expect(validateBidAmount(67, creator, campaign)).toEqual({ ok: false, code: "ABOVE_MAX_PRICE" });
  });

  it("rejects an amount that fits the CPM cap but exceeds the campaign budget", () => {
    const tightBudget: CampaignRequirements = { ...campaign, budgetCents: 40 };
    expect(validateBidAmount(50, creator, tightBudget)).toEqual({ ok: false, code: "ABOVE_MAX_PRICE" });
  });

  it("uses exact cross-multiplication, not the floored guidance figure, at the boundary", () => {
    // views=7, maxCpm=301 -> exact ceiling is amount*1000 <= 7*301=2107 -> amount<=2 (2000<=2107 true, 3000<=2107 false)
    // but floor(7*301/1000) = floor(2.107) = 2 as well here, so pick a case where they'd
    // differ if someone mistakenly validated against the rounded figure instead:
    const microCreator: CreatorProfile = { ...creator, medianViews: 7, minFeeCents: 1 };
    const microCampaign: CampaignRequirements = { ...campaign, maxCpmCents: 301, budgetCents: 1000 };
    // exact: amount*1000 <= 7*301 = 2107 -> amount <= 2 (since amount is an integer cents value)
    expect(validateBidAmount(2, microCreator, microCampaign)).toEqual({ ok: true });
    expect(validateBidAmount(3, microCreator, microCampaign)).toEqual({ ok: false, code: "ABOVE_MAX_PRICE" });
  });
});

describe("classifyPricePosition", () => {
  const guidance = computePriceGuidance(creator, campaign); // minFee 20, target 33, max 66

  it("classifies below the minimum fee as BLOCKED_BELOW_MIN", () => {
    expect(classifyPricePosition(19, guidance)).toBe("BLOCKED_BELOW_MIN");
  });

  it("classifies above the max payment as BLOCKED_ABOVE_MAX", () => {
    expect(classifyPricePosition(67, guidance)).toBe("BLOCKED_ABOVE_MAX");
  });

  it("classifies at or below target (inclusive of the boundary) as AT_OR_BELOW_TARGET", () => {
    expect(classifyPricePosition(20, guidance)).toBe("AT_OR_BELOW_TARGET");
    expect(classifyPricePosition(33, guidance)).toBe("AT_OR_BELOW_TARGET");
  });

  it("classifies above target but within max as ABOVE_TARGET", () => {
    expect(classifyPricePosition(34, guidance)).toBe("ABOVE_TARGET");
    expect(classifyPricePosition(66, guidance)).toBe("ABOVE_TARGET");
  });
});

describe("suggestedDefaultBidCents", () => {
  it("suggests the target payment when it already clears the minimum fee", () => {
    const guidance = computePriceGuidance(creator, campaign); // min 20, target 33, max 66
    expect(suggestedDefaultBidCents(guidance)).toBe(33);
  });

  it("suggests the minimum fee when target payment falls short of it", () => {
    const pickyCreator: CreatorProfile = { ...creator, minFeeCents: 40 }; // > target (33), <= max (66)
    const guidance = computePriceGuidance(pickyCreator, campaign);
    expect(guidance.hasCompatiblePrice).toBe(true);
    expect(suggestedDefaultBidCents(guidance)).toBe(40);
  });
});

describe("effectiveCpmCents", () => {
  it("computes amount*1000/views rounded to 2 decimals", () => {
    expect(effectiveCpmCents(150, 1000)).toBe(150);
    expect(effectiveCpmCents(100, 3)).toBeCloseTo(33333.33, 2);
  });
});
