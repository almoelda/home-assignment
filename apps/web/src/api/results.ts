import type { Identity } from "../state/IdentityContext.js";
import { actorHeaders, apiFetch } from "./client.js";

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
  closedAt: string;
  bidsConsidered: number;
  winnersCount: number;
  spendCents: number;
  estimatedViewsTotal: number;
  unusedBudgetCents: number;
  winners: ResultWinner[];
  myOutcome: MyOutcome | null;
}

export function getCampaignResult(campaignId: number, identity: Identity | null) {
  return apiFetch<CampaignResult>(`/campaigns/${campaignId}/result`, { headers: actorHeaders(identity) });
}
