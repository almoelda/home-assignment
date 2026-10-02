import { compareRatioDescending } from "./money.js";
import type { PriceGuidance } from "./pricing.js";

export type OpportunityTier = 1 | 2 | 3;

export interface RankedOpportunity {
  campaignId: number;
  deadlineAt: Date;
  guidance: PriceGuidance;
}

/**
 * Plan §4.4:
 *   Tier 1 "Meets your minimum at target rate": target_payment >= min_fee
 *   Tier 2 "Needs a bid above target": target_payment < min_fee <= max_payment
 *   Tier 3 "No compatible price": min_fee > max_payment
 */
export function classifyTier(guidance: PriceGuidance): OpportunityTier {
  if (guidance.targetPaymentCents >= guidance.minFeeCents) return 1;
  if (guidance.hasCompatiblePrice) return 2;
  return 3;
}

/**
 * Within a tier: sort by target_payment/min_fee descending, then earlier deadline, then
 * campaign id (plan §4.4). Across tiers: tier 1 before 2 before 3.
 */
export function compareOpportunities(a: RankedOpportunity, b: RankedOpportunity): number {
  const tierA = classifyTier(a.guidance);
  const tierB = classifyTier(b.guidance);
  if (tierA !== tierB) return tierA - tierB;

  const byRatio = compareRatioDescending(
    a.guidance.targetPaymentCents,
    a.guidance.minFeeCents,
    b.guidance.targetPaymentCents,
    b.guidance.minFeeCents,
  );
  if (byRatio !== 0) return byRatio;

  const byDeadline = a.deadlineAt.getTime() - b.deadlineAt.getTime();
  if (byDeadline !== 0) return byDeadline;

  return a.campaignId - b.campaignId;
}

export function rankOpportunities<T extends RankedOpportunity>(opportunities: readonly T[]): T[] {
  return [...opportunities].sort(compareOpportunities);
}
