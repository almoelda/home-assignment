import { isWithinMaxCpm } from "./money.js";
import type { CampaignRequirements, CreatorProfile } from "./types.js";

export interface PriceGuidance {
  minFeeCents: number;
  targetPaymentCents: number;
  maxPaymentCents: number;
  /** The creator's own medianViews, carried alongside the guidance so the UI can show the
   * arithmetic behind targetPaymentCents/maxPaymentCents (views x CPM / 1000) instead of
   * just the result (plan §8.2 — "expected views" is part of the price panel). */
  estimatedViews: number;
  /** false iff minFeeCents > maxPaymentCents — "No compatible price under current terms". */
  hasCompatiblePrice: boolean;
}

/**
 * Price guidance for one creator x campaign pair (plan §4.3). Floor, never round, because
 * an advertiser's budget is a hard ceiling — rounding up could exceed it.
 */
export function computePriceGuidance(
  creator: CreatorProfile,
  campaign: CampaignRequirements,
): PriceGuidance {
  const targetPaymentCents = Math.floor((creator.medianViews * campaign.targetCpmCents) / 1000);
  const maxPaymentUncapped = Math.floor((creator.medianViews * campaign.maxCpmCents) / 1000);
  const maxPaymentCents = Math.min(campaign.budgetCents, maxPaymentUncapped);
  const minFeeCents = creator.minFeeCents;

  return {
    minFeeCents,
    targetPaymentCents,
    maxPaymentCents,
    estimatedViews: creator.medianViews,
    hasCompatiblePrice: minFeeCents <= maxPaymentCents,
  };
}

export type PricePosition =
  | "BLOCKED_BELOW_MIN"
  | "BLOCKED_ABOVE_MAX"
  | "AT_OR_BELOW_TARGET"
  | "ABOVE_TARGET";

export function classifyPricePosition(amountCents: number, guidance: PriceGuidance): PricePosition {
  if (amountCents < guidance.minFeeCents) return "BLOCKED_BELOW_MIN";
  if (amountCents > guidance.maxPaymentCents) return "BLOCKED_ABOVE_MAX";
  if (amountCents <= guidance.targetPaymentCents) return "AT_OR_BELOW_TARGET";
  return "ABOVE_TARGET";
}

export type BidAmountValidation =
  | { ok: true }
  | { ok: false; code: "BELOW_MIN_FEE" | "ABOVE_MAX_PRICE" };

/**
 * The pure half of bid validation (plan §4.3, §5). Uses exact cross-multiplication, not the
 * rounded maxPaymentCents from computePriceGuidance — an amount could pass the floored
 * guidance figure but fail the true a*1000 <= views*maxCpm test, or vice versa near the
 * boundary; the exact check is authoritative. Does NOT check campaign status/deadline or
 * budget-remaining — those live in packages/application (need the DB clock / a live lock).
 */
export function validateBidAmount(
  amountCents: number,
  creator: CreatorProfile,
  campaign: CampaignRequirements,
): BidAmountValidation {
  if (amountCents < creator.minFeeCents) {
    return { ok: false, code: "BELOW_MIN_FEE" };
  }
  const withinCampaignMax = isWithinMaxCpm(amountCents, creator.medianViews, campaign.maxCpmCents);
  const withinBudget = amountCents <= campaign.budgetCents;
  if (!withinCampaignMax || !withinBudget) {
    return { ok: false, code: "ABOVE_MAX_PRICE" };
  }
  return { ok: true };
}

/** a*1000/views, for DISPLAY only — never used to validate or settle money (plan §2). */
export function effectiveCpmCents(amountCents: number, estimatedViews: number): number {
  if (estimatedViews === 0) return 0;
  return Math.round(((amountCents * 1000) / estimatedViews) * 100) / 100;
}

/** clamp(max(minFee, targetPayment), minFee, maxPayment) — plan §4.3. */
export function suggestedDefaultBidCents(guidance: PriceGuidance): number {
  const raw = Math.max(guidance.minFeeCents, guidance.targetPaymentCents);
  return Math.min(Math.max(raw, guidance.minFeeCents), guidance.maxPaymentCents);
}
