import { bids, campaignClosings, campaigns, creators, type Database } from "@marketplace/db";
import { and, eq } from "drizzle-orm";
import { ApplicationError } from "./errors.js";

export interface ResultWinner {
  creatorId: number;
  creatorHandle: string;
  creatorDisplayName: string;
  amountCents: number;
  estimatedViews: number;
}

export interface MyOutcome {
  status: "won" | "lost";
  amountCents: number;
  resultReason: string | null;
}

export interface CampaignResult {
  campaignId: number;
  algorithmVersion: string;
  closedAt: Date;
  bidsConsidered: number;
  winnersCount: number;
  spendCents: number;
  estimatedViewsTotal: number;
  unusedBudgetCents: number;
  winners: ResultWinner[];
  /** Only set when actorCreatorId placed a (decided) bid — plan §7: "creator sees only their own reason". */
  myOutcome: MyOutcome | null;
}

/**
 * Plan §7: GET /campaigns/:id/result — "after close: winners, spend, views, unused budget,
 * algorithm_version, per-bid reasons (creator sees only their own reason)". The winners list
 * and aggregate stats are not actor-restricted (an advertiser needs to see who won; a losing
 * creator benefits from seeing who the budget went to) — only an individual's OWN reason
 * text is scoped to them, via `actorCreatorId`.
 */
export async function getCampaignResult(
  db: Database,
  campaignId: number,
  actorCreatorId: number | null,
): Promise<CampaignResult> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) throw new ApplicationError("NOT_FOUND", `campaign ${campaignId} not found`);

  const [closing] = await db.select().from(campaignClosings).where(eq(campaignClosings.campaignId, campaignId));
  if (!closing) {
    throw new ApplicationError("VALIDATION_ERROR", "campaign has not closed yet");
  }

  const winnerRows = await db
    .select({
      creatorId: creators.id,
      creatorHandle: creators.handle,
      creatorDisplayName: creators.displayName,
      amountCents: bids.amountCents,
      estimatedViews: bids.estimatedViews,
    })
    .from(bids)
    .innerJoin(creators, eq(bids.creatorId, creators.id))
    .where(and(eq(bids.campaignId, campaignId), eq(bids.status, "won")));

  let myOutcome: MyOutcome | null = null;
  if (actorCreatorId !== null) {
    const [mine] = await db
      .select()
      .from(bids)
      .where(and(eq(bids.campaignId, campaignId), eq(bids.creatorId, actorCreatorId)));
    if (mine && (mine.status === "won" || mine.status === "lost")) {
      myOutcome = { status: mine.status, amountCents: mine.amountCents, resultReason: mine.resultReason };
    }
  }

  return {
    campaignId: campaign.id,
    algorithmVersion: closing.algorithmVersion,
    closedAt: closing.closedAt,
    bidsConsidered: closing.bidsConsidered,
    winnersCount: closing.winnersCount,
    spendCents: closing.spendCents,
    estimatedViewsTotal: closing.estimatedViewsTotal,
    unusedBudgetCents: closing.unusedBudgetCents,
    winners: winnerRows,
    myOutcome,
  };
}
