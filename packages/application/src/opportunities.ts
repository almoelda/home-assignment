import { bids, campaigns, creators, type Database } from "@marketplace/db";
import {
  checkEligibility,
  classifyTier,
  computePriceGuidance,
  rankOpportunities,
  type EligibilityFailureReason,
  type PriceGuidance,
} from "@marketplace/domain";
import { eq, inArray, sql } from "drizzle-orm";
import { ApplicationError } from "./errors.js";
import { toCampaignRequirements, toCreatorProfile } from "./mappers.js";

export interface EligibleOpportunity {
  campaignId: number;
  title: string;
  brief: string;
  budgetCents: number;
  deadlineAt: Date;
  tier: 1 | 2 | 3;
  guidance: PriceGuidance;
  /** Plan §4.4/§5: "number of active bids" — the only competition signal a creator gets,
   * since individual bid amounts stay sealed between creators. */
  activeBidCount: number;
}

export interface IneligibleOpportunity {
  campaignId: number;
  title: string;
  reasons: EligibilityFailureReason[];
}

export interface OpportunitiesResult {
  eligible: EligibleOpportunity[];
  ineligible: IneligibleOpportunity[];
}

/**
 * Plan §4.4: every open campaign a creator is eligible for, ranked into tiers with the raw
 * numbers that produced the ranking — plus every open campaign they're NOT eligible for,
 * with the specific failed requirements, so the UI can show "why not" rather than nothing
 * (plan §4.4: "Ineligible open campaigns are available behind a toggle with the failed
 * requirements listed").
 *
 * Shows every status='open' campaign regardless of whether its deadline has passed — a
 * campaign in the "settling" display state (plan §3) is still worth seeing, even though the
 * separate bid-write path (Slice 4) will reject a new bid against it.
 */
export async function listOpportunitiesForCreator(db: Database, creatorId: number): Promise<OpportunitiesResult> {
  const [creatorRow] = await db.select().from(creators).where(eq(creators.id, creatorId));
  if (!creatorRow) {
    throw new ApplicationError("NOT_FOUND", `creator ${creatorId} not found`);
  }
  const creatorProfile = toCreatorProfile(creatorRow);

  const openCampaigns = await db.select().from(campaigns).where(eq(campaigns.status, "open"));

  const ineligible: IneligibleOpportunity[] = [];
  const eligibleCampaignsById = new Map<number, (typeof openCampaigns)[number]>();
  const rankingInput: Array<{ campaignId: number; deadlineAt: Date; guidance: PriceGuidance }> = [];

  for (const campaign of openCampaigns) {
    const campaignReq = toCampaignRequirements(campaign);
    const reasons = checkEligibility(creatorProfile, campaignReq);
    if (reasons.length > 0) {
      ineligible.push({ campaignId: campaign.id, title: campaign.title, reasons });
      continue;
    }
    const guidance = computePriceGuidance(creatorProfile, campaignReq);
    eligibleCampaignsById.set(campaign.id, campaign);
    rankingInput.push({ campaignId: campaign.id, deadlineAt: campaign.deadlineAt, guidance });
  }

  const ranked = rankOpportunities(rankingInput);

  const bidCountByCampaignId = new Map<number, number>();
  if (ranked.length > 0) {
    const counts = await db
      .select({
        campaignId: bids.campaignId,
        activeBidCount: sql<number>`count(*) filter (where ${bids.status} = 'active')`.mapWith(Number),
      })
      .from(bids)
      .where(inArray(bids.campaignId, ranked.map((r) => r.campaignId)))
      .groupBy(bids.campaignId);
    for (const row of counts) bidCountByCampaignId.set(row.campaignId, row.activeBidCount);
  }

  const eligible: EligibleOpportunity[] = ranked.map((r) => {
    const campaign = eligibleCampaignsById.get(r.campaignId);
    if (!campaign) throw new ApplicationError("INTERNAL", "ranked campaign missing from lookup");
    return {
      campaignId: r.campaignId,
      title: campaign.title,
      brief: campaign.brief,
      budgetCents: campaign.budgetCents,
      deadlineAt: campaign.deadlineAt,
      tier: classifyTier(r.guidance),
      guidance: r.guidance,
      activeBidCount: bidCountByCampaignId.get(r.campaignId) ?? 0,
    };
  });

  return { eligible, ineligible };
}
