import type { Identity } from "../state/IdentityContext.js";
import { actorHeaders, apiFetch } from "./client.js";

export type BidStatus = "active" | "withdrawn" | "won" | "lost";

export interface Bid {
  id: number;
  campaignId: number;
  creatorId: number;
  amountCents: number;
  estimatedViews: number;
  status: BidStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorBidView {
  bidId: number;
  campaignId: number;
  campaignTitle: string;
  amountCents: number;
  estimatedViews: number;
  effectiveCpmCents: number;
  status: BidStatus;
  resultReason: string | null;
  campaignDisplayState: "open" | "settling" | "closed";
}

export interface AdvertiserBidView {
  bidId: number;
  creatorId: number;
  creatorHandle: string;
  creatorDisplayName: string;
  amountCents: number;
  estimatedViews: number;
  effectiveCpmCents: number;
  status: BidStatus;
  valueRank: number;
  resultReason: string | null;
}

export function placeBid(campaignId: number, amountCents: number, identity: Identity | null) {
  return apiFetch<Bid>(`/campaigns/${campaignId}/bids/me`, {
    method: "PUT",
    headers: actorHeaders(identity),
    body: JSON.stringify({ amountCents }),
  });
}

export async function withdrawBid(campaignId: number, identity: Identity | null): Promise<void> {
  await apiFetch<void>(`/campaigns/${campaignId}/bids/me`, {
    method: "DELETE",
    headers: actorHeaders(identity),
  });
}

export function listCreatorBids(creatorId: number, identity: Identity | null) {
  return apiFetch<{ bids: CreatorBidView[] }>(`/creators/${creatorId}/bids`, { headers: actorHeaders(identity) });
}

export function listCampaignBids(campaignId: number, identity: Identity | null) {
  return apiFetch<{ bids: AdvertiserBidView[] }>(`/campaigns/${campaignId}/bids`, {
    headers: actorHeaders(identity),
  });
}
