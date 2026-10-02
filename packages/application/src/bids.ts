import { bids, campaigns, creators, type Database } from "@marketplace/db";
import {
  checkEligibility,
  compareRatioDescending,
  effectiveCpmCents,
  validateBidAmount,
  PRICING_POLICY_VERSION,
} from "@marketplace/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import { ApplicationError } from "./errors.js";
import {
  campaignDisplayState,
  type CampaignDisplayState,
  readClockTimestamp,
  toCampaignRequirements,
  toCreatorProfile,
} from "./mappers.js";

export interface PlaceBidInput {
  campaignId: number;
  creatorId: number;
  amountCents: number;
}

type BidRow = typeof bids.$inferSelect;

/**
 * Plan §6.2: create/update a bid, one transaction.
 *   1. SELECT ... FOR UPDATE on the campaign row (exclusive lock).
 *   2. Verify status='open' AND clock_timestamp() < deadline_at — evaluated AFTER the lock
 *      (plan §6.1): a transaction that waited for the lock must not use a stale timestamp.
 *   3. Validate eligibility/price; upsert the bid; snapshot estimated_views + policy version.
 *   4. Commit.
 *
 * This serializes bid writes per campaign (documented tradeoff, plan §6.2) — acceptable at
 * this scale, and it's exactly what makes the bid/close race in packages/application's
 * closing job (Slice 5) safe: a bid either commits before the closer's lock, or the closer
 * already holds the lock and this call blocks until it's released, at which point the
 * campaign is 'closed' and the bid is rejected. Never half-included.
 */
export async function placeBid(db: Database, input: PlaceBidInput): Promise<BidRow> {
  return db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).for("update");
    if (!campaign) {
      throw new ApplicationError("NOT_FOUND", `campaign ${input.campaignId} not found`);
    }

    const now = await readClockTimestamp(tx);

    if (campaign.status !== "open") {
      throw new ApplicationError("CAMPAIGN_CLOSED", "campaign is closed");
    }
    if (campaign.deadlineAt <= now) {
      throw new ApplicationError("BIDDING_ENDED", "the bidding deadline has passed");
    }

    const [creatorRow] = await tx.select().from(creators).where(eq(creators.id, input.creatorId));
    if (!creatorRow) {
      throw new ApplicationError("NOT_FOUND", `creator ${input.creatorId} not found`);
    }

    const creatorProfile = toCreatorProfile(creatorRow);
    const campaignReq = toCampaignRequirements(campaign);

    const eligibilityFailures = checkEligibility(creatorProfile, campaignReq);
    if (eligibilityFailures.length > 0) {
      throw new ApplicationError("NOT_ELIGIBLE", "creator is not eligible for this campaign", {
        reasons: eligibilityFailures,
      });
    }

    const validation = validateBidAmount(input.amountCents, creatorProfile, campaignReq);
    if (!validation.ok) {
      const message =
        validation.code === "BELOW_MIN_FEE"
          ? "amount is below the creator's minimum fee"
          : "amount exceeds the campaign's max price or budget";
      throw new ApplicationError(validation.code, message);
    }

    const [bid] = await tx
      .insert(bids)
      .values({
        campaignId: input.campaignId,
        creatorId: input.creatorId,
        amountCents: input.amountCents,
        estimatedViews: creatorRow.medianViews,
        pricingPolicyVersion: PRICING_POLICY_VERSION,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [bids.campaignId, bids.creatorId],
        set: {
          amountCents: input.amountCents,
          estimatedViews: creatorRow.medianViews,
          pricingPolicyVersion: PRICING_POLICY_VERSION,
          status: "active",
          updatedAt: sql`now()`,
        },
      })
      .returning();

    if (!bid) throw new ApplicationError("INTERNAL", "bid upsert returned no row");
    return bid;
  });
}

/** Plan §5: withdraw while biddable; re-bidding later re-activates the same row. */
export async function withdrawBid(db: Database, campaignId: number, creatorId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for("update");
    if (!campaign) {
      throw new ApplicationError("NOT_FOUND", `campaign ${campaignId} not found`);
    }

    const now = await readClockTimestamp(tx);

    if (campaign.status !== "open") {
      throw new ApplicationError("CAMPAIGN_CLOSED", "campaign is closed");
    }
    if (campaign.deadlineAt <= now) {
      throw new ApplicationError("BIDDING_ENDED", "the bidding deadline has passed");
    }

    const [existing] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.campaignId, campaignId), eq(bids.creatorId, creatorId)));
    if (!existing || existing.status !== "active") {
      throw new ApplicationError("NOT_FOUND", "no active bid to withdraw");
    }

    await tx.update(bids).set({ status: "withdrawn", updatedAt: sql`now()` }).where(eq(bids.id, existing.id));
  });
}

export interface CreatorBidView {
  bidId: number;
  campaignId: number;
  campaignTitle: string;
  amountCents: number;
  estimatedViews: number;
  effectiveCpmCents: number;
  status: BidRow["status"];
  resultReason: string | null;
  campaignDisplayState: CampaignDisplayState;
}

/** Plan §7: GET /creators/:id/bids — "creator's bids with campaign state and outcome". */
export async function listBidsForCreator(db: Database, creatorId: number): Promise<CreatorBidView[]> {
  const [creator] = await db.select().from(creators).where(eq(creators.id, creatorId));
  if (!creator) throw new ApplicationError("NOT_FOUND", `creator ${creatorId} not found`);

  const rows = await db
    .select({
      bidId: bids.id,
      campaignId: campaigns.id,
      campaignTitle: campaigns.title,
      amountCents: bids.amountCents,
      estimatedViews: bids.estimatedViews,
      status: bids.status,
      resultReason: bids.resultReason,
      campaignStatus: campaigns.status,
      deadlineAt: campaigns.deadlineAt,
    })
    .from(bids)
    .innerJoin(campaigns, eq(bids.campaignId, campaigns.id))
    .where(eq(bids.creatorId, creatorId))
    .orderBy(desc(bids.updatedAt));

  const now = new Date();
  return rows.map((r) => ({
    bidId: r.bidId,
    campaignId: r.campaignId,
    campaignTitle: r.campaignTitle,
    amountCents: r.amountCents,
    estimatedViews: r.estimatedViews,
    effectiveCpmCents: effectiveCpmCents(r.amountCents, r.estimatedViews),
    status: r.status,
    resultReason: r.resultReason,
    campaignDisplayState: campaignDisplayState({ status: r.campaignStatus, deadlineAt: r.deadlineAt }, now),
  }));
}

export interface AdvertiserBidView {
  bidId: number;
  creatorId: number;
  creatorHandle: string;
  creatorDisplayName: string;
  amountCents: number;
  estimatedViews: number;
  effectiveCpmCents: number;
  status: BidRow["status"];
  valueRank: number;
  resultReason: string | null;
}

/**
 * Plan §7: GET /campaigns/:id/bids — "advertiser-only: all bids with effective CPM and rank
 * by value". Ranked the same way the closer will rank them (value density descending), so an
 * advertiser watching bids come in sees the order that will decide winners.
 */
export async function listBidsForCampaign(
  db: Database,
  campaignId: number,
  requestingAdvertiserId: number,
): Promise<AdvertiserBidView[]> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new ApplicationError("NOT_FOUND", `campaign ${campaignId} not found`);
  if (campaign.advertiserId !== requestingAdvertiserId) {
    throw new ApplicationError("FORBIDDEN_ACTOR", "only the owning advertiser can view this campaign's bids");
  }

  const rows = await db
    .select({
      bidId: bids.id,
      creatorId: creators.id,
      creatorHandle: creators.handle,
      creatorDisplayName: creators.displayName,
      amountCents: bids.amountCents,
      estimatedViews: bids.estimatedViews,
      status: bids.status,
      resultReason: bids.resultReason,
    })
    .from(bids)
    .innerJoin(creators, eq(bids.creatorId, creators.id))
    .where(eq(bids.campaignId, campaignId));

  const sorted = [...rows].sort((a, b) =>
    compareRatioDescending(a.estimatedViews, a.amountCents, b.estimatedViews, b.amountCents),
  );

  return sorted.map((r, index) => ({
    bidId: r.bidId,
    creatorId: r.creatorId,
    creatorHandle: r.creatorHandle,
    creatorDisplayName: r.creatorDisplayName,
    amountCents: r.amountCents,
    estimatedViews: r.estimatedViews,
    effectiveCpmCents: effectiveCpmCents(r.amountCents, r.estimatedViews),
    status: r.status,
    valueRank: index + 1,
    resultReason: r.resultReason,
  }));
}
