import { advertisers, createDb, creators, type DbHandle } from "@marketplace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBidsForCampaign, listBidsForCreator, placeBid, withdrawBid } from "./bids.js";
import { createCampaign, type CreateCampaignInput } from "./campaigns.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("bids application layer", () => {
  let handle: DbHandle;
  let advertiserId: number;
  let eligibleCreatorId: number;
  let secondEligibleCreatorId: number;
  let ineligibleCreatorId: number;

  beforeAll(async () => {
    handle = createDb(DATABASE_URL);

    const [advertiser] = await handle.db
      .insert(advertisers)
      .values({ name: `Bid Test Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;

    const [eligible] = await handle.db
      .insert(creators)
      .values({
        handle: `bid_eligible_${randomUUID()}`,
        displayName: "Eligible Bidder",
        platform: "tiktok",
        genre: "fitness",
        followers: 50_000,
        engagementBps: 500,
        medianViews: 20_000,
        minFeeCents: 10_000,
      })
      .returning();
    if (!eligible) throw new Error("fixture creator insert failed");
    eligibleCreatorId = eligible.id;

    const [second] = await handle.db
      .insert(creators)
      .values({
        handle: `bid_eligible2_${randomUUID()}`,
        displayName: "Second Eligible Bidder",
        platform: "tiktok",
        genre: "fitness",
        followers: 80_000,
        engagementBps: 600,
        medianViews: 40_000,
        minFeeCents: 15_000,
      })
      .returning();
    if (!second) throw new Error("fixture creator insert failed");
    secondEligibleCreatorId = second.id;

    const [ineligible] = await handle.db
      .insert(creators)
      .values({
        handle: `bid_ineligible_${randomUUID()}`,
        displayName: "Ineligible Bidder",
        platform: "instagram",
        genre: "beauty",
        followers: 1_000,
        engagementBps: 50,
        medianViews: 500,
        minFeeCents: 10_000,
      })
      .returning();
    if (!ineligible) throw new Error("fixture creator insert failed");
    ineligibleCreatorId = ineligible.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  async function openCampaign(overrides: Partial<CreateCampaignInput> = {}) {
    return createCampaign(handle.db, {
      advertiserId,
      title: `Bid Test Campaign ${randomUUID()}`,
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
    });
  }

  describe("placeBid", () => {
    it("creates an active bid with a snapshotted estimated_views and policy version", async () => {
      const campaign = await openCampaign();
      const bid = await placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 15_000 });
      expect(bid.status).toBe("active");
      expect(bid.estimatedViews).toBe(20_000);
      expect(bid.pricingPolicyVersion).toBe("median-views-v1");
      expect(bid.amountCents).toBe(15_000);
    });

    it("rejects a bid from an ineligible creator with NOT_ELIGIBLE and the specific reasons", async () => {
      const campaign = await openCampaign();
      await expect(
        placeBid(handle.db, { campaignId: campaign.id, creatorId: ineligibleCreatorId, amountCents: 15_000 }),
      ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    });

    it("rejects an amount below the creator's minimum fee", async () => {
      const campaign = await openCampaign();
      await expect(
        placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 9_999 }),
      ).rejects.toMatchObject({ code: "BELOW_MIN_FEE" });
    });

    it("rejects an amount above the max price", async () => {
      // views=20000, maxCpm=2000 -> max = floor(20000*2000/1000) = 40000
      const campaign = await openCampaign();
      await expect(
        placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 40_001 }),
      ).rejects.toMatchObject({ code: "ABOVE_MAX_PRICE" });
    });

    it("rejects bidding on a campaign whose deadline has already passed", async () => {
      const campaign = await openCampaign({ deadlineAt: new Date(Date.now() + 61_000) });
      // Can't create with a past deadline directly (createCampaign enforces 1-min-ahead), so
      // instead exercise the closed-campaign path, which is the other half of the same guard.
      // Forces the campaign closed directly, as the Slice 5 closer would. Raw SQL is fine in
      // a test fixture; application code never mutates status outside the closer.
      await handle.db.execute(sql`UPDATE campaigns SET status = 'closed', closed_at = now() WHERE id = ${campaign.id}`);
      await expect(
        placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 15_000 }),
      ).rejects.toMatchObject({ code: "CAMPAIGN_CLOSED" });
    });

    it("rejects bidding past the deadline with BIDDING_ENDED", async () => {
      const campaign = await openCampaign();
      // Move the deadline into the past directly (bypassing the API's forward-looking
      // validation) to exercise the deadline guard specifically, as distinct from status.
      await handle.db.execute(
        sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${campaign.id}`,
      );
      await expect(
        placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 15_000 }),
      ).rejects.toMatchObject({ code: "BIDDING_ENDED" });

      // Close it immediately: otherwise this campaign is left "due" (open, deadline in the
      // past) in the shared test database forever, which the closing-job test suites — run
      // against this same real Postgres instance — would later discover and claim,
      // corrupting their "exactly one due campaign" assumptions. Found via exactly that
      // cross-file flakiness; see DECISIONS.md.
      await handle.db.execute(sql`UPDATE campaigns SET status = 'closed', closed_at = now() WHERE id = ${campaign.id}`);
    });

    it("upserts: re-bidding the same creator/campaign updates the existing row rather than creating a second one", async () => {
      const campaign = await openCampaign();
      const first = await placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 12_000 });
      const second = await placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 18_000 });
      expect(second.id).toBe(first.id);
      expect(second.amountCents).toBe(18_000);

      const bids = await listBidsForCreator(handle.db, eligibleCreatorId);
      expect(bids.filter((b) => b.campaignId === campaign.id)).toHaveLength(1);
    });
  });

  describe("withdrawBid", () => {
    it("marks an active bid as withdrawn", async () => {
      const campaign = await openCampaign();
      await placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 15_000 });
      await withdrawBid(handle.db, campaign.id, eligibleCreatorId);

      const bids = await listBidsForCreator(handle.db, eligibleCreatorId);
      const found = bids.find((b) => b.campaignId === campaign.id);
      expect(found?.status).toBe("withdrawn");
    });

    it("re-bidding after withdrawing re-activates the same row", async () => {
      const campaign = await openCampaign();
      const original = await placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 15_000 });
      await withdrawBid(handle.db, campaign.id, eligibleCreatorId);
      const reactivated = await placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 20_000 });

      expect(reactivated.id).toBe(original.id);
      expect(reactivated.status).toBe("active");
      expect(reactivated.amountCents).toBe(20_000);
    });

    it("rejects withdrawing when there is no active bid", async () => {
      const campaign = await openCampaign();
      await expect(withdrawBid(handle.db, campaign.id, eligibleCreatorId)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("listBidsForCampaign (advertiser-only)", () => {
    it("ranks bids by value density, highest first", async () => {
      const campaign = await openCampaign();
      // eligible: 20000 views / 15000 cents = 1.333
      // second:   40000 views / 15000 cents = 2.667  -> should rank first
      await placeBid(handle.db, { campaignId: campaign.id, creatorId: eligibleCreatorId, amountCents: 15_000 });
      await placeBid(handle.db, { campaignId: campaign.id, creatorId: secondEligibleCreatorId, amountCents: 15_000 });

      const view = await listBidsForCampaign(handle.db, campaign.id, advertiserId);
      expect(view).toHaveLength(2);
      expect(view[0]?.creatorId).toBe(secondEligibleCreatorId);
      expect(view[0]?.valueRank).toBe(1);
      expect(view[1]?.creatorId).toBe(eligibleCreatorId);
      expect(view[1]?.valueRank).toBe(2);
    });

    it("rejects a non-owning advertiser with FORBIDDEN_ACTOR", async () => {
      const campaign = await openCampaign();
      const [otherAdvertiser] = await handle.db
        .insert(advertisers)
        .values({ name: `Other Advertiser ${randomUUID()}` })
        .returning();
      if (!otherAdvertiser) throw new Error("fixture insert failed");

      await expect(listBidsForCampaign(handle.db, campaign.id, otherAdvertiser.id)).rejects.toMatchObject({
        code: "FORBIDDEN_ACTOR",
      });
    });
  });
});
