import { advertisers, bids, campaigns, creators, type Database } from "@marketplace/db";
import {
  checkEligibility,
  classifyTier,
  computePriceGuidance,
  type Genre,
  type Platform,
} from "@marketplace/domain";
import { eq, sql } from "drizzle-orm";
import { ApplicationError } from "./errors.js";
import { campaignDisplayState, toCampaignRequirements, toCreatorProfile } from "./mappers.js";

export interface CreateCampaignInput {
  advertiserId: number;
  title: string;
  brief: string;
  budgetCents: number;
  deadlineAt: Date;
  platforms: Platform[];
  genres: Genre[];
  minFollowers: number;
  minEngagementBps: number;
  targetCpmCents: number;
  maxCpmCents: number;
}

/**
 * Validates and inserts a new campaign. DB CHECK constraints are the final backstop (e.g.
 * budget > 0, maxCpm >= targetCpm), but we validate first so a bad request gets a clean
 * VALIDATION_ERROR instead of a raw constraint-violation message.
 *
 * The 1-minute-ahead deadline check uses the APPLICATION clock, not the DB clock — this is
 * deliberate and different from §6.1's rule. §6.1 governs decisions made under a row lock
 * (accepting a bid, closing a campaign) where a race actually exists and money is on the
 * line. This is a one-time sanity check on a brand-new row nothing else can race against;
 * reaching for clock_timestamp() here would be a round trip for no correctness gain.
 */
export async function createCampaign(db: Database, input: CreateCampaignInput) {
  const [advertiser] = await db.select().from(advertisers).where(eq(advertisers.id, input.advertiserId));
  if (!advertiser) {
    throw new ApplicationError("NOT_FOUND", `advertiser ${input.advertiserId} not found`);
  }

  if (input.platforms.length === 0) {
    throw new ApplicationError("VALIDATION_ERROR", "at least one platform is required");
  }
  if (input.genres.length === 0) {
    throw new ApplicationError("VALIDATION_ERROR", "at least one genre is required");
  }
  if (input.budgetCents <= 0) {
    throw new ApplicationError("VALIDATION_ERROR", "budgetCents must be positive");
  }
  if (input.targetCpmCents <= 0) {
    throw new ApplicationError("VALIDATION_ERROR", "targetCpmCents must be positive");
  }
  if (input.maxCpmCents < input.targetCpmCents) {
    throw new ApplicationError("VALIDATION_ERROR", "maxCpmCents must be >= targetCpmCents");
  }
  const minDeadline = new Date(Date.now() + 60_000);
  if (input.deadlineAt < minDeadline) {
    throw new ApplicationError("VALIDATION_ERROR", "deadlineAt must be at least 1 minute in the future");
  }

  const [campaign] = await db.insert(campaigns).values(input).returning();
  if (!campaign) throw new ApplicationError("INTERNAL", "campaign insert returned no row");
  return campaign;
}

export interface CampaignListItem {
  id: number;
  title: string;
  budgetCents: number;
  deadlineAt: Date;
  displayState: ReturnType<typeof campaignDisplayState>;
  activeBidCount: number;
}

/** Plan §7: GET /advertisers/:id/campaigns — "list own campaigns with display state and bid counts". */
export async function listCampaignsForAdvertiser(db: Database, advertiserId: number): Promise<CampaignListItem[]> {
  const [advertiser] = await db.select().from(advertisers).where(eq(advertisers.id, advertiserId));
  if (!advertiser) {
    throw new ApplicationError("NOT_FOUND", `advertiser ${advertiserId} not found`);
  }

  const rows = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      budgetCents: campaigns.budgetCents,
      deadlineAt: campaigns.deadlineAt,
      status: campaigns.status,
      activeBidCount: sql<number>`count(${bids.id}) filter (where ${bids.status} = 'active')`.mapWith(Number),
    })
    .from(campaigns)
    .leftJoin(bids, eq(bids.campaignId, campaigns.id))
    .where(eq(campaigns.advertiserId, advertiserId))
    .groupBy(campaigns.id)
    .orderBy(campaigns.deadlineAt);

  const now = new Date();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    budgetCents: row.budgetCents,
    deadlineAt: row.deadlineAt,
    displayState: campaignDisplayState({ status: row.status, deadlineAt: row.deadlineAt }, now),
    activeBidCount: row.activeBidCount,
  }));
}

export interface CampaignDetail {
  id: number;
  advertiserId: number;
  title: string;
  brief: string;
  budgetCents: number;
  deadlineAt: Date;
  platforms: Platform[];
  genres: Genre[];
  minFollowers: number;
  minEngagementBps: number;
  targetCpmCents: number;
  maxCpmCents: number;
  displayState: ReturnType<typeof campaignDisplayState>;
  guidanceForActor: ReturnType<typeof computePriceGuidance> | null;
  tierForActor: 1 | 2 | 3 | null;
  ineligibilityReasons: ReturnType<typeof checkEligibility> | null;
  /** Plan §4.4/§5: the one competition signal a creator gets alongside their own bid. */
  activeBidCount: number;
}

/**
 * Plan §7: GET /campaigns/:id — "includes price guidance if actor is an eligible creator".
 * `actorCreatorId` is the soft, unauthenticated actor hint (plan §5) — null when the caller
 * isn't acting as a creator, in which case guidance/ineligibility are both null.
 */
export async function getCampaignDetail(
  db: Database,
  campaignId: number,
  actorCreatorId: number | null,
): Promise<CampaignDetail> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) {
    throw new ApplicationError("NOT_FOUND", `campaign ${campaignId} not found`);
  }

  let guidanceForActor: ReturnType<typeof computePriceGuidance> | null = null;
  let tierForActor: 1 | 2 | 3 | null = null;
  let ineligibilityReasons: ReturnType<typeof checkEligibility> | null = null;

  if (actorCreatorId !== null) {
    const [creatorRow] = await db.select().from(creators).where(eq(creators.id, actorCreatorId));
    if (creatorRow) {
      const creatorProfile = toCreatorProfile(creatorRow);
      const campaignReq = toCampaignRequirements(campaign);
      const failures = checkEligibility(creatorProfile, campaignReq);
      if (failures.length === 0) {
        guidanceForActor = computePriceGuidance(creatorProfile, campaignReq);
        tierForActor = classifyTier(guidanceForActor);
      } else {
        ineligibilityReasons = failures;
      }
    }
  }

  const [activeBidCountRow] = await db
    .select({ activeBidCount: sql<number>`count(*) filter (where ${bids.status} = 'active')`.mapWith(Number) })
    .from(bids)
    .where(eq(bids.campaignId, campaignId));

  return {
    id: campaign.id,
    advertiserId: campaign.advertiserId,
    title: campaign.title,
    brief: campaign.brief,
    budgetCents: campaign.budgetCents,
    deadlineAt: campaign.deadlineAt,
    platforms: campaign.platforms,
    genres: campaign.genres,
    minFollowers: campaign.minFollowers,
    minEngagementBps: campaign.minEngagementBps,
    targetCpmCents: campaign.targetCpmCents,
    maxCpmCents: campaign.maxCpmCents,
    displayState: campaignDisplayState(campaign, new Date()),
    guidanceForActor,
    tierForActor,
    ineligibilityReasons,
    activeBidCount: activeBidCountRow?.activeBidCount ?? 0,
  };
}
