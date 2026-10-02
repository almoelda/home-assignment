import { advertisers, createDb, creators, type DbHandle } from "@marketplace/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCampaign, type CreateCampaignInput } from "./campaigns.js";
import { listOpportunitiesForCreator } from "./opportunities.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("listOpportunitiesForCreator", () => {
  let handle: DbHandle;
  let advertiserId: number;
  let eligibleCreatorId: number;

  beforeAll(async () => {
    handle = createDb(DATABASE_URL);
    const [advertiser] = await handle.db
      .insert(advertisers)
      .values({ name: `Test Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;

    const [creator] = await handle.db
      .insert(creators)
      .values({
        handle: `test_creator_${randomUUID()}`,
        displayName: "Test Creator",
        platform: "tiktok",
        genre: "fitness",
        followers: 50_000,
        engagementBps: 500,
        medianViews: 20_000,
        minFeeCents: 10_000,
      })
      .returning();
    if (!creator) throw new Error("fixture creator insert failed");
    eligibleCreatorId = creator.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  function campaignInput(overrides: Partial<CreateCampaignInput> = {}): CreateCampaignInput {
    return {
      advertiserId,
      title: `Opportunity Test ${randomUUID()}`,
      brief: "Brief.",
      budgetCents: 500_000,
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      platforms: ["tiktok"],
      genres: ["fitness"],
      minFollowers: 0,
      minEngagementBps: 0,
      targetCpmCents: 1_000,
      maxCpmCents: 2_000,
      ...overrides,
    };
  }

  it("rejects an unknown creator", async () => {
    await expect(listOpportunitiesForCreator(handle.db, 9_999_999)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("places a matching campaign in the eligible, ranked list with guidance", async () => {
    const campaign = await createCampaign(handle.db, campaignInput());
    const result = await listOpportunitiesForCreator(handle.db, eligibleCreatorId);

    const found = result.eligible.find((o) => o.campaignId === campaign.id);
    expect(found).toBeDefined();
    expect(found?.tier).toBe(1); // target=floor(20000*1000/1000)=20000 >= minFee(10000)
    expect(found?.guidance.minFeeCents).toBe(10_000);
    expect(found?.guidance.targetPaymentCents).toBe(20_000);
    expect(result.ineligible.some((o) => o.campaignId === campaign.id)).toBe(false);
  });

  it("places a non-matching campaign in the ineligible list with specific reasons", async () => {
    const campaign = await createCampaign(handle.db, campaignInput({ genres: ["beauty"] }));
    const result = await listOpportunitiesForCreator(handle.db, eligibleCreatorId);

    const found = result.ineligible.find((o) => o.campaignId === campaign.id);
    expect(found).toBeDefined();
    expect(found?.reasons).toContainEqual({
      code: "GENRE_NOT_TARGETED",
      required: ["beauty"],
      actual: "fitness",
    });
    expect(result.eligible.some((o) => o.campaignId === campaign.id)).toBe(false);
  });

  it("ranks tier 1 (meets minimum at target) ahead of tier 2 (needs a bid above target)", async () => {
    const tier1 = await createCampaign(handle.db, campaignInput({ targetCpmCents: 1_000 })); // target 20000 >= minFee 10000
    const tier2 = await createCampaign(handle.db, campaignInput({ targetCpmCents: 100, maxCpmCents: 2_000 })); // target 2000 < minFee 10000 <= max 40000
    const result = await listOpportunitiesForCreator(handle.db, eligibleCreatorId);

    const rank = (id: number) => result.eligible.findIndex((o) => o.campaignId === id);
    expect(rank(tier1.id)).toBeGreaterThanOrEqual(0);
    expect(rank(tier2.id)).toBeGreaterThanOrEqual(0);
    expect(rank(tier1.id)).toBeLessThan(rank(tier2.id));
  });
});
