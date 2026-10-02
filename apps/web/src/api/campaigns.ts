import type { Identity } from "../state/IdentityContext.js";
import { actorHeaders, apiFetch } from "./client.js";

export type Platform = "tiktok" | "instagram";
export type Genre = "fitness" | "beauty" | "gaming" | "food" | "travel" | "tech" | "fashion" | "music";
export type DisplayState = "open" | "settling" | "closed";
export type Tier = 1 | 2 | 3;

export interface PriceGuidance {
  minFeeCents: number;
  targetPaymentCents: number;
  maxPaymentCents: number;
  estimatedViews: number;
  hasCompatiblePrice: boolean;
}

export interface EligibilityFailureReason {
  code: string;
  required?: unknown;
  actual?: unknown;
}

export interface CampaignListItem {
  id: number;
  title: string;
  budgetCents: number;
  deadlineAt: string;
  displayState: DisplayState;
  activeBidCount: number;
}

export interface CampaignDetail {
  id: number;
  advertiserId: number;
  title: string;
  brief: string;
  budgetCents: number;
  deadlineAt: string;
  platforms: Platform[];
  genres: Genre[];
  minFollowers: number;
  minEngagementBps: number;
  targetCpmCents: number;
  maxCpmCents: number;
  displayState: DisplayState;
  guidanceForActor: PriceGuidance | null;
  tierForActor: Tier | null;
  ineligibilityReasons: EligibilityFailureReason[] | null;
  activeBidCount: number;
}

export interface EligibleOpportunity {
  campaignId: number;
  title: string;
  brief: string;
  budgetCents: number;
  deadlineAt: string;
  tier: Tier;
  guidance: PriceGuidance;
  activeBidCount: number;
}

export interface IneligibleOpportunity {
  campaignId: number;
  title: string;
  reasons: EligibilityFailureReason[];
}

export interface OpportunitiesResponse {
  eligible: EligibleOpportunity[];
  ineligible?: IneligibleOpportunity[];
}

export interface CreateCampaignBody {
  title: string;
  brief: string;
  budgetCents: number;
  deadlineAt: string;
  platforms: Platform[];
  genres: Genre[];
  minFollowers?: number;
  minEngagementBps?: number;
  targetCpmCents: number;
  maxCpmCents: number;
}

export function createCampaign(identity: Identity | null, body: CreateCampaignBody) {
  return apiFetch<{ id: number }>("/campaigns", {
    method: "POST",
    headers: actorHeaders(identity),
    body: JSON.stringify(body),
  });
}

export function listAdvertiserCampaigns(advertiserId: number) {
  return apiFetch<{ campaigns: CampaignListItem[] }>(`/advertisers/${advertiserId}/campaigns`);
}

export function getCampaignDetail(campaignId: number, identity: Identity | null) {
  return apiFetch<CampaignDetail>(`/campaigns/${campaignId}`, { headers: actorHeaders(identity) });
}

export function listCreatorOpportunities(creatorId: number) {
  return apiFetch<OpportunitiesResponse>(`/creators/${creatorId}/campaigns?include=ineligible`);
}
