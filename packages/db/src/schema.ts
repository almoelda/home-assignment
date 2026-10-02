import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────────

export const platformEnum = pgEnum("platform", ["tiktok", "instagram"]);

export const genreEnum = pgEnum("genre", [
  "fitness",
  "beauty",
  "gaming",
  "food",
  "travel",
  "tech",
  "fashion",
  "music",
]);

export const campaignStatusEnum = pgEnum("campaign_status", ["open", "closed"]);

export const bidStatusEnum = pgEnum("bid_status", ["active", "withdrawn", "won", "lost"]);

// A bigint identity PK, used consistently across every table (see DECISIONS.md:
// "UUID v7 or bigserial; pick one and be consistent" — bigint identity chosen for
// native sortability and simple ascending tiebreaks per IMPLEMENTATION_PLAN.md §4.6/§4.4).
const id = () => bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

// ─── advertisers ────────────────────────────────────────────────────────────

export const advertisers = pgTable("advertisers", {
  id: id(),
  name: text().notNull(),
});

// ─── creators ───────────────────────────────────────────────────────────────

export const creators = pgTable(
  "creators",
  {
    id: id(),
    handle: text().notNull(),
    displayName: text("display_name").notNull(),
    platform: platformEnum().notNull(),
    genre: genreEnum().notNull(),
    followers: integer().notNull(),
    engagementBps: integer("engagement_bps").notNull(),
    // Historical median views per comparable short-form video. Seeded demo data;
    // see IMPLEMENTATION_PLAN.md §4.2 for why this, not a follower/engagement formula.
    medianViews: integer("median_views").notNull(),
    minFeeCents: integer("min_fee_cents").notNull(),
  },
  (table) => [
    unique("creators_handle_unique").on(table.handle),
    check("creators_followers_nonnegative", sql`${table.followers} >= 0`),
    check("creators_engagement_bps_nonnegative", sql`${table.engagementBps} >= 0`),
    check("creators_median_views_nonnegative", sql`${table.medianViews} >= 0`),
    check("creators_min_fee_positive", sql`${table.minFeeCents} > 0`),
  ],
);

// ─── campaigns ──────────────────────────────────────────────────────────────

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    advertiserId: bigint("advertiser_id", { mode: "number" })
      .notNull()
      .references(() => advertisers.id),
    title: text().notNull(),
    brief: text().notNull(),
    budgetCents: integer("budget_cents").notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    platforms: platformEnum().array().notNull(),
    genres: genreEnum().array().notNull(),
    minFollowers: integer("min_followers").notNull().default(0),
    minEngagementBps: integer("min_engagement_bps").notNull().default(0),
    targetCpmCents: integer("target_cpm_cents").notNull(),
    maxCpmCents: integer("max_cpm_cents").notNull(),
    status: campaignStatusEnum().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    // The worker's claim query: WHERE status = 'open' AND deadline_at <= clock_timestamp()
    // ORDER BY deadline_at, id — this index serves it directly (plan §3, §6.3).
    index("campaigns_status_deadline_idx").on(table.status, table.deadlineAt),
    check("campaigns_budget_positive", sql`${table.budgetCents} > 0`),
    check("campaigns_min_followers_nonnegative", sql`${table.minFollowers} >= 0`),
    check("campaigns_min_engagement_bps_nonnegative", sql`${table.minEngagementBps} >= 0`),
    check("campaigns_target_cpm_positive", sql`${table.targetCpmCents} > 0`),
    check("campaigns_max_cpm_at_least_target", sql`${table.maxCpmCents} >= ${table.targetCpmCents}`),
    check("campaigns_platforms_nonempty", sql`array_length(${table.platforms}, 1) > 0`),
    check("campaigns_genres_nonempty", sql`array_length(${table.genres}, 1) > 0`),
    check(
      "campaigns_closed_at_matches_status",
      sql`(${table.status} = 'open' AND ${table.closedAt} IS NULL) OR (${table.status} = 'closed' AND ${table.closedAt} IS NOT NULL)`,
    ),
  ],
);

// ─── bids ───────────────────────────────────────────────────────────────────

export const bids = pgTable(
  "bids",
  {
    id: id(),
    campaignId: bigint("campaign_id", { mode: "number" })
      .notNull()
      .references(() => campaigns.id),
    creatorId: bigint("creator_id", { mode: "number" })
      .notNull()
      .references(() => creators.id),
    amountCents: integer("amount_cents").notNull(),
    // Snapshot of creator.medianViews at last write — see IMPLEMENTATION_PLAN.md §3:
    // "so results remain explainable if the model later changes."
    estimatedViews: integer("estimated_views").notNull(),
    pricingPolicyVersion: text("pricing_policy_version").notNull(),
    status: bidStatusEnum().notNull().default("active"),
    resultReason: text("result_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Changes whenever amount changes or a withdrawn bid is reactivated; used as a
    // tiebreak in winner selection (plan §4.6) — "earlier updated_at first". The closer must
    // NEVER write this column (see decidedAt below) — doing so would overwrite the creator's
    // actual last-edit timestamp with the close time, corrupting both the tiebreak input and
    // the audit trail.
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Set once, by the closer, when this bid is marked won/lost — separate from updatedAt so
    // closing a campaign never clobbers the creator's own last-edit timestamp (see above).
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    unique("bids_campaign_creator_unique").on(table.campaignId, table.creatorId),
    index("bids_campaign_status_idx").on(table.campaignId, table.status),
    index("bids_creator_idx").on(table.creatorId),
    check("bids_amount_positive", sql`${table.amountCents} > 0`),
    check("bids_estimated_views_nonnegative", sql`${table.estimatedViews} >= 0`),
  ],
);

// ─── campaign_closings ──────────────────────────────────────────────────────

export const campaignClosings = pgTable(
  "campaign_closings",
  {
    // PRIMARY KEY, not just a FK: the structural backstop against a double close
    // (plan §6.3 L4) — a second close attempt dies on a unique-violation even if
    // every line of the locking logic were wrong.
    campaignId: bigint("campaign_id", { mode: "number" })
      .primaryKey()
      .references(() => campaigns.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    algorithmVersion: text("algorithm_version").notNull(),
    bidsConsidered: integer("bids_considered").notNull(),
    winnersCount: integer("winners_count").notNull(),
    spendCents: integer("spend_cents").notNull(),
    estimatedViewsTotal: integer("estimated_views_total").notNull(),
    unusedBudgetCents: integer("unused_budget_cents").notNull(),
  },
  (table) => [
    check("campaign_closings_bids_considered_nonnegative", sql`${table.bidsConsidered} >= 0`),
    check("campaign_closings_winners_within_bids", sql`${table.winnersCount} <= ${table.bidsConsidered}`),
    check("campaign_closings_spend_nonnegative", sql`${table.spendCents} >= 0`),
    check("campaign_closings_unused_nonnegative", sql`${table.unusedBudgetCents} >= 0`),
  ],
);
