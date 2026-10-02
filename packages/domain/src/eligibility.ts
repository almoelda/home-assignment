import type { CampaignRequirements, CreatorProfile, Genre, Platform } from "./types.js";

export type EligibilityFailureReason =
  | { code: "PLATFORM_NOT_SUPPORTED"; required: Platform[]; actual: Platform }
  | { code: "GENRE_NOT_TARGETED"; required: Genre[]; actual: Genre }
  | { code: "BELOW_MIN_FOLLOWERS"; required: number; actual: number }
  | { code: "BELOW_MIN_ENGAGEMENT"; required: number; actual: number };

/**
 * Hard requirements only (plan §4.1). Campaign status/deadline are NOT checked here — that
 * decision needs the database clock (plan §6.1) and belongs in packages/application, not in
 * this pure, clock-free package.
 */
export function checkEligibility(
  creator: CreatorProfile,
  campaign: CampaignRequirements,
): EligibilityFailureReason[] {
  const reasons: EligibilityFailureReason[] = [];

  if (!campaign.platforms.includes(creator.platform)) {
    reasons.push({
      code: "PLATFORM_NOT_SUPPORTED",
      required: campaign.platforms,
      actual: creator.platform,
    });
  }
  if (!campaign.genres.includes(creator.genre)) {
    reasons.push({
      code: "GENRE_NOT_TARGETED",
      required: campaign.genres,
      actual: creator.genre,
    });
  }
  if (creator.followers < campaign.minFollowers) {
    reasons.push({
      code: "BELOW_MIN_FOLLOWERS",
      required: campaign.minFollowers,
      actual: creator.followers,
    });
  }
  if (creator.engagementBps < campaign.minEngagementBps) {
    reasons.push({
      code: "BELOW_MIN_ENGAGEMENT",
      required: campaign.minEngagementBps,
      actual: creator.engagementBps,
    });
  }

  return reasons;
}

/** Boolean convenience wrapper over checkEligibility — part of this package's public
 * surface (tested directly) even though nothing in packages/application calls it today,
 * every caller there needing the specific failure reasons instead. */
export function isEligible(creator: CreatorProfile, campaign: CampaignRequirements): boolean {
  return checkEligibility(creator, campaign).length === 0;
}
