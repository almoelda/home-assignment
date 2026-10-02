export type Platform = "tiktok" | "instagram";

export type Genre =
  | "fitness"
  | "beauty"
  | "gaming"
  | "food"
  | "travel"
  | "tech"
  | "fashion"
  | "music";

export interface CreatorProfile {
  id: number;
  platform: Platform;
  genre: Genre;
  followers: number;
  engagementBps: number;
  /** Historical median views per comparable video. See IMPLEMENTATION_PLAN.md §4.2. */
  medianViews: number;
  minFeeCents: number;
}

export interface CampaignRequirements {
  id: number;
  platforms: Platform[];
  genres: Genre[];
  minFollowers: number;
  minEngagementBps: number;
  budgetCents: number;
  targetCpmCents: number;
  maxCpmCents: number;
  deadlineAt: Date;
}

/** The version string stamped onto every bid (plan §3) and closing record (plan §4.6). */
export const PRICING_POLICY_VERSION = "median-views-v1";
export const SELECTION_ALGORITHM_VERSION = "greedy-v1";
