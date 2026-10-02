import { advertisers, createDb, creators, type DbHandle } from "@marketplace/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCampaign,
  getCampaignDetail,
  listCampaignsForAdvertiser,
  type CreateCampaignInput,
} from "./campaigns.js";
import { ApplicationError } from "./errors.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

function campaignInput(overrides: Partial<CreateCampaignInput> = {}, advertiserId: number): CreateCampaignInput {
  return {
    advertiserId,
    title: `Test Campaign ${randomUUID()}`,
    brief: "A test campaign brief.",
    budgetCents: 100_000,
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

describe("campaigns application layer", () => {
  let handle: DbHandle;
  let advertiserId: number;
  let eligibleCreatorId: number;
  let ineligibleCreatorId: number;

  beforeAll(async () => {
    handle = createDb(DATABASE_URL);
    const [advertiser] = await handle.db
      .insert(advertisers)
      .values({ name: `Test Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;

    const [eligibleCreator] = await handle.db
      .insert(creators)
      .values({
        handle: `eligible_${randomUUID()}`,
        displayName: "Eligible Creator",
        platform: "tiktok",
        genre: "fitness",
        followers: 50_000,
        engagementBps: 500,
        medianViews: 20_000,
        minFeeCents: 10_000,
      })
      .returning();
    if (!eligibleCreator) throw new Error("fixture eligible creator insert failed");
    eligibleCreatorId = eligibleCreator.id;

    const [ineligibleCreator] = await handle.db
      .insert(creators)
      .values({
        handle: `ineligible_${randomUUID()}`,
        displayName: "Ineligible Creator",
        platform: "instagram", // campaigns below target tiktok -> platform mismatch
        genre: "beauty",
        followers: 1_000,
        engagementBps: 50,
        medianViews: 500,
        minFeeCents: 10_000,
      })
      .returning();
    if (!ineligibleCreator) throw new Error("fixture ineligible creator insert failed");
    ineligibleCreatorId = ineligibleCreator.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("createCampaign", () => {
    it("creates a campaign with valid input", async () => {
      const campaign = await createCampaign(handle.db, campaignInput({}, advertiserId));
      expect(campaign.id).toBeGreaterThan(0);
      expect(campaign.status).toBe("open");
      expect(campaign.closedAt).toBeNull();
    });

    it("rejects an unknown advertiser", async () => {
      await expect(createCampaign(handle.db, campaignInput({}, 9_999_999))).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects an empty platforms list", async () => {
      await expect(
        createCampaign(handle.db, campaignInput({ platforms: [] }, advertiserId)),
      ).rejects.toThrow(ApplicationError);
    });

    it("rejects an empty genres list", async () => {
      await expect(createCampaign(handle.db, campaignInput({ genres: [] }, advertiserId))).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("rejects a non-positive budget", async () => {
      await expect(
        createCampaign(handle.db, campaignInput({ budgetCents: 0 }, advertiserId)),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects maxCpmCents below targetCpmCents", async () => {
      await expect(
        createCampaign(handle.db, campaignInput({ targetCpmCents: 2_000, maxCpmCents: 1_000 }, advertiserId)),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects a deadline less than 1 minute in the future", async () => {
      await expect(
        createCampaign(handle.db, campaignInput({ deadlineAt: new Date(Date.now() + 1000) }, advertiserId)),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe("listCampaignsForAdvertiser", () => {
    it("lists campaigns belonging to the advertiser with display state and bid count", async () => {
      const campaign = await createCampaign(handle.db, campaignInput({}, advertiserId));
      const list = await listCampaignsForAdvertiser(handle.db, advertiserId);
      const found = list.find((c) => c.id === campaign.id);
      expect(found).toBeDefined();
      expect(found?.displayState).toBe("open");
      expect(found?.activeBidCount).toBe(0);
    });

    it("rejects an unknown advertiser", async () => {
      await expect(listCampaignsForAdvertiser(handle.db, 9_999_999)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("getCampaignDetail", () => {
    it("returns base detail with no guidance when there is no creator actor", async () => {
      const campaign = await createCampaign(handle.db, campaignInput({}, advertiserId));
      const detail = await getCampaignDetail(handle.db, campaign.id, null);
      expect(detail.id).toBe(campaign.id);
      expect(detail.guidanceForActor).toBeNull();
      expect(detail.ineligibilityReasons).toBeNull();
      expect(detail.displayState).toBe("open");
    });

    it("throws NOT_FOUND for an unknown campaign", async () => {
      await expect(getCampaignDetail(handle.db, 9_999_999, null)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("includes price guidance and tier when the actor is an eligible creator", async () => {
      const campaign = await createCampaign(handle.db, campaignInput({}, advertiserId));
      const detail = await getCampaignDetail(handle.db, campaign.id, eligibleCreatorId);
      expect(detail.guidanceForActor).not.toBeNull();
      expect(detail.guidanceForActor?.minFeeCents).toBe(10_000);
      expect(detail.tierForActor).toBe(1);
      expect(detail.ineligibilityReasons).toBeNull();
    });

    it("includes ineligibility reasons (not guidance) when the actor is an ineligible creator", async () => {
      const campaign = await createCampaign(handle.db, campaignInput({}, advertiserId)); // tiktok/fitness
      const detail = await getCampaignDetail(handle.db, campaign.id, ineligibleCreatorId);
      expect(detail.guidanceForActor).toBeNull();
      expect(detail.tierForActor).toBeNull();
      expect(detail.ineligibilityReasons).not.toBeNull();
      expect(detail.ineligibilityReasons).toContainEqual({
        code: "PLATFORM_NOT_SUPPORTED",
        required: ["tiktok"],
        actual: "instagram",
      });
    });
  });
});
