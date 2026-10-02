import { describe, expect, it } from "vitest";
import { checkEligibility, isEligible } from "./eligibility.js";
import type { CampaignRequirements, CreatorProfile } from "./types.js";

const baseCreator: CreatorProfile = {
  id: 1,
  platform: "tiktok",
  genre: "fitness",
  followers: 50_000,
  engagementBps: 400,
  medianViews: 20_000,
  minFeeCents: 10_000,
};

const baseCampaign: CampaignRequirements = {
  id: 1,
  platforms: ["tiktok", "instagram"],
  genres: ["fitness", "food"],
  minFollowers: 10_000,
  minEngagementBps: 200,
  budgetCents: 100_000,
  targetCpmCents: 1_000,
  maxCpmCents: 2_000,
  deadlineAt: new Date("2030-01-01T00:00:00Z"),
};

describe("checkEligibility", () => {
  it("returns no failures when every requirement is met", () => {
    expect(checkEligibility(baseCreator, baseCampaign)).toEqual([]);
    expect(isEligible(baseCreator, baseCampaign)).toBe(true);
  });

  it("flags PLATFORM_NOT_SUPPORTED when the creator's platform isn't targeted", () => {
    const campaign = { ...baseCampaign, platforms: ["instagram" as const] };
    const result = checkEligibility(baseCreator, campaign);
    expect(result).toContainEqual({
      code: "PLATFORM_NOT_SUPPORTED",
      required: ["instagram"],
      actual: "tiktok",
    });
  });

  it("flags GENRE_NOT_TARGETED when the creator's genre isn't targeted", () => {
    const campaign = { ...baseCampaign, genres: ["beauty" as const] };
    const result = checkEligibility(baseCreator, campaign);
    expect(result).toContainEqual({
      code: "GENRE_NOT_TARGETED",
      required: ["beauty"],
      actual: "fitness",
    });
  });

  it("flags BELOW_MIN_FOLLOWERS when followers are under the requirement", () => {
    const campaign = { ...baseCampaign, minFollowers: 100_000 };
    const result = checkEligibility(baseCreator, campaign);
    expect(result).toContainEqual({
      code: "BELOW_MIN_FOLLOWERS",
      required: 100_000,
      actual: 50_000,
    });
  });

  it("flags BELOW_MIN_ENGAGEMENT when engagement is under the requirement", () => {
    const campaign = { ...baseCampaign, minEngagementBps: 500 };
    const result = checkEligibility(baseCreator, campaign);
    expect(result).toContainEqual({
      code: "BELOW_MIN_ENGAGEMENT",
      required: 500,
      actual: 400,
    });
  });

  it("is exactly eligible at the boundary (followers == minFollowers)", () => {
    const campaign = { ...baseCampaign, minFollowers: 50_000 };
    expect(isEligible(baseCreator, campaign)).toBe(true);
  });

  it("is exactly eligible at the boundary (engagementBps == minEngagementBps)", () => {
    const campaign = { ...baseCampaign, minEngagementBps: 400 };
    expect(isEligible(baseCreator, campaign)).toBe(true);
  });

  it("accumulates every failed requirement, not just the first", () => {
    const campaign: CampaignRequirements = {
      ...baseCampaign,
      platforms: ["instagram"],
      genres: ["beauty"],
      minFollowers: 1_000_000,
      minEngagementBps: 9_999,
    };
    const result = checkEligibility(baseCreator, campaign);
    expect(result).toHaveLength(4);
  });
});
