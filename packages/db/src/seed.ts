import { PRICING_POLICY_VERSION } from "@marketplace/domain";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { advertisers, bids, campaigns, creators } from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function main() {
  console.log("Seeding (idempotent: truncates and reinserts every run)...");

  // RESTART IDENTITY so bigint identity PKs are predictable across repeated seed runs —
  // this is a demo dataset, not production data, so a full reset each run is simplest and
  // matches "designed so the app is interesting the moment it opens" (plan §9).
  await db.execute(
    sql`TRUNCATE TABLE campaign_closings, bids, campaigns, creators, advertisers RESTART IDENTITY CASCADE`,
  );

  const [nova, glow, pixelForge] = await db
    .insert(advertisers)
    .values([{ name: "Nova Sports Nutrition" }, { name: "Glow Cosmetics" }, { name: "Pixel Forge Games" }])
    .returning();
  if (!nova || !glow || !pixelForge) throw new Error("advertiser seed failed");

  // ~14 creators spanning both platforms and all 8 genres, with followers/engagement/
  // median_views/min_fee spread widely enough that every price-compatibility tier (plan
  // §4.4) appears across the seeded campaigns below.
  const [
    fitMarta,
    fitJonas,
    beautyLena,
    beautyMia,
    gameTom,
    gameAna,
    foodLeo,
    foodSara,
    travelNik,
    techDev,
    fashionIvy,
    fashionKai,
    musicZoe,
    musicRay,
  ] = await db
    .insert(creators)
    .values([
      {
        handle: "fit_marta",
        displayName: "Marta Fit",
        platform: "tiktok",
        genre: "fitness",
        followers: 110_000,
        engagementBps: 480,
        medianViews: 42_000,
        minFeeCents: 25_000,
      },
      {
        handle: "fit_jonas",
        displayName: "Jonas Gains",
        platform: "instagram",
        genre: "fitness",
        followers: 32_000,
        engagementBps: 310,
        medianViews: 15_000,
        minFeeCents: 12_000,
      },
      {
        handle: "beauty_lena",
        displayName: "Lena Glow",
        platform: "instagram",
        genre: "beauty",
        followers: 210_000,
        engagementBps: 290,
        medianViews: 68_000,
        minFeeCents: 45_000,
      },
      {
        handle: "beauty_mia",
        displayName: "Mia Blush",
        platform: "tiktok",
        genre: "beauty",
        followers: 54_000,
        engagementBps: 520,
        medianViews: 31_000,
        minFeeCents: 18_000,
      },
      {
        handle: "game_tom",
        displayName: "Tom Plays",
        platform: "tiktok",
        genre: "gaming",
        followers: 120_000,
        engagementBps: 350,
        medianViews: 58_000,
        minFeeCents: 30_000,
      },
      {
        handle: "game_ana",
        displayName: "Ana Respawns",
        platform: "instagram",
        genre: "gaming",
        followers: 18_000,
        engagementBps: 410,
        medianViews: 9_000,
        minFeeCents: 9_000,
      },
      {
        handle: "food_leo",
        displayName: "Leo Cooks",
        platform: "tiktok",
        genre: "food",
        followers: 67_000,
        engagementBps: 390,
        medianViews: 36_000,
        minFeeCents: 20_000,
      },
      {
        handle: "food_sara",
        displayName: "Sara Bakes",
        platform: "instagram",
        genre: "food",
        followers: 9_500,
        engagementBps: 610,
        medianViews: 6_200,
        minFeeCents: 6_000,
      },
      {
        handle: "travel_nik",
        displayName: "Nik Roams",
        platform: "instagram",
        genre: "travel",
        followers: 150_000,
        engagementBps: 270,
        medianViews: 54_000,
        minFeeCents: 40_000,
      },
      {
        handle: "tech_dev",
        displayName: "Dev Reviews",
        platform: "tiktok",
        genre: "tech",
        followers: 41_000,
        engagementBps: 330,
        medianViews: 19_000,
        minFeeCents: 15_000,
      },
      {
        handle: "fashion_ivy",
        displayName: "Ivy Styles",
        platform: "instagram",
        genre: "fashion",
        followers: 95_000,
        engagementBps: 300,
        medianViews: 37_000,
        minFeeCents: 28_000,
      },
      {
        handle: "fashion_kai",
        displayName: "Kai Fits",
        platform: "tiktok",
        genre: "fashion",
        followers: 23_000,
        engagementBps: 440,
        medianViews: 13_000,
        minFeeCents: 10_000,
      },
      {
        handle: "music_zoe",
        displayName: "Zoe Beats",
        platform: "tiktok",
        genre: "music",
        followers: 310_000,
        engagementBps: 260,
        medianViews: 92_000,
        minFeeCents: 60_000,
      },
      {
        handle: "music_ray",
        displayName: "Ray Notes",
        platform: "instagram",
        genre: "music",
        followers: 12_000,
        engagementBps: 500,
        medianViews: 8_000,
        minFeeCents: 7_000,
      },
    ])
    .returning();
  if (
    !fitMarta || !fitJonas || !beautyLena || !beautyMia || !gameTom || !gameAna || !foodLeo ||
    !foodSara || !travelNik || !techDev || !fashionIvy || !fashionKai || !musicZoe || !musicRay
  ) {
    throw new Error("creator seed failed");
  }

  // Four purpose-built creators for the greedy-vs-optimal fixture documented in
  // IMPLEMENTATION_PLAN.md §4.7 and asserted as a unit test ("greedy-suboptimal"). Separate
  // from the 14 general-purpose creators above so the fixture's numbers are exact and the
  // demo is self-documenting (display name states its role). See DECISIONS.md.
  const [demoB, demoE, demoA, demoD] = await db
    .insert(creators)
    .values([
      {
        handle: "demo_creator_b",
        displayName: "Demo Creator B (greedy fixture)",
        platform: "tiktok",
        genre: "fitness",
        followers: 20_000,
        engagementBps: 300,
        medianViews: 20_000,
        minFeeCents: 15_000,
      },
      {
        handle: "demo_creator_e",
        displayName: "Demo Creator E (greedy fixture)",
        platform: "tiktok",
        genre: "fitness",
        followers: 60_000,
        engagementBps: 300,
        medianViews: 60_000,
        minFeeCents: 54_000,
      },
      {
        handle: "demo_creator_a",
        displayName: "Demo Creator A (greedy fixture)",
        platform: "tiktok",
        genre: "fitness",
        followers: 50_000,
        engagementBps: 300,
        medianViews: 50_000,
        minFeeCents: 50_000,
      },
      {
        handle: "demo_creator_d",
        displayName: "Demo Creator D (greedy fixture)",
        platform: "tiktok",
        genre: "fitness",
        followers: 30_000,
        engagementBps: 300,
        medianViews: 30_000,
        minFeeCents: 33_000,
      },
    ])
    .returning();
  if (!demoB || !demoE || !demoA || !demoD) throw new Error("demo creator seed failed");

  // Campaign 1 — already open a while, several bids placed, budget not yet exhausted.
  const [campaignOpenWithBids] = await db
    .insert(campaigns)
    .values({
      advertiserId: nova.id,
      title: "Protein Bar Launch — Fitness Creators",
      brief: "Show your gym routine with the new bar. 15-30s, tag us, natural placement.",
      budgetCents: 150_000,
      deadlineAt: minutesFromNow(60 * 48),
      platforms: ["tiktok", "instagram"],
      genres: ["fitness", "food"],
      minFollowers: 10_000,
      minEngagementBps: 200,
      targetCpmCents: 1_500,
      maxCpmCents: 2_500,
      createdAt: minutesFromNow(-60 * 24),
    })
    .returning();
  if (!campaignOpenWithBids) throw new Error("campaign 1 seed failed");

  // Campaign 2 — short-ish deadline for a live demo of bidding end-to-end. 20 minutes, not 3:
  // a 3-minute window was usually already settled by the time a reviewer finished reading the
  // README's quick-start steps and got here (F14 in the independent review). The README's own
  // demo flow now leads with Create Campaign's "2 minutes (demo)" preset instead, which a
  // reviewer controls the timing of directly; this campaign is the fallback for bidding on an
  // already-existing one.
  const [campaignLiveDemo] = await db
    .insert(campaigns)
    .values({
      advertiserId: glow.id,
      title: "Weekend Flash — Beauty Try-On",
      brief: "Quick try-on and first impressions. Any format, your style.",
      budgetCents: 100_000,
      deadlineAt: minutesFromNow(20),
      platforms: ["instagram", "tiktok"],
      genres: ["beauty", "fashion"],
      minFollowers: 5_000,
      minEngagementBps: 150,
      targetCpmCents: 1_200,
      maxCpmCents: 2_000,
    })
    .returning();
  if (!campaignLiveDemo) throw new Error("campaign 2 seed failed");

  // Campaign 3 — deadline already passed, still open: settles on the worker's first tick
  // once Slice 5 lands. Bids sized so the whole set fits the budget (clean first example).
  const [campaignPendingClose] = await db
    .insert(campaigns)
    .values({
      advertiserId: pixelForge.id,
      title: "New Title Teaser — Gaming Creators",
      brief: "React to the teaser trailer, post your honest first take.",
      budgetCents: 80_000,
      deadlineAt: minutesFromNow(-10),
      platforms: ["tiktok", "instagram"],
      genres: ["gaming", "tech"],
      minFollowers: 8_000,
      minEngagementBps: 200,
      targetCpmCents: 1_000,
      maxCpmCents: 1_800,
      createdAt: minutesFromNow(-60 * 6),
    })
    .returning();
  if (!campaignPendingClose) throw new Error("campaign 3 seed failed");

  // Campaign 4 — deliberately ineligible-heavy: platform=tiktok only + a high follower bar
  // means 13 of the 14 general creators fail (platform or follower-count mismatch), and
  // exactly one (fit_marta) qualifies. Demonstrates the "why not" UI at scale.
  const [campaignIneligibleHeavy] = await db
    .insert(campaigns)
    .values({
      advertiserId: nova.id,
      title: "Premium Recovery Drink — High-Reach Fitness",
      brief: "Studio-quality spot for a premium product. Established fitness creators only.",
      budgetCents: 200_000,
      deadlineAt: minutesFromNow(60 * 24),
      platforms: ["tiktok"],
      genres: ["fitness"],
      minFollowers: 100_000,
      minEngagementBps: 400,
      targetCpmCents: 1_800,
      maxCpmCents: 3_000,
    })
    .returning();
  if (!campaignIneligibleHeavy) throw new Error("campaign 4 seed failed");

  // Campaign 5 — the greedy-vs-optimal fixture from IMPLEMENTATION_PLAN.md §4.7, live: four
  // bids at exactly the documented amounts, deadline already past. No eligibility gating
  // (min_followers/min_engagement = 0) so the demo is pure pricing/selection, not matching.
  const [campaignGreedyDemo] = await db
    .insert(campaigns)
    .values({
      advertiserId: pixelForge.id,
      title: "Demo: Greedy vs Optimal Selection (see README)",
      brief: "Fixture campaign — reproduces the greedy-suboptimal example from the README.",
      budgetCents: 100_000,
      deadlineAt: minutesFromNow(-5),
      platforms: ["tiktok"],
      genres: ["fitness"],
      minFollowers: 0,
      minEngagementBps: 0,
      targetCpmCents: 800,
      maxCpmCents: 1_500,
      createdAt: minutesFromNow(-30),
    })
    .returning();
  if (!campaignGreedyDemo) throw new Error("campaign 5 seed failed");

  await db.insert(bids).values([
    // Campaign 1 bids — all comfortably within budget; campaign stays open with room left.
    {
      campaignId: campaignOpenWithBids.id,
      creatorId: fitMarta.id,
      amountCents: 30_000,
      estimatedViews: fitMarta.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    {
      campaignId: campaignOpenWithBids.id,
      creatorId: fitJonas.id,
      amountCents: 15_000,
      estimatedViews: fitJonas.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    {
      campaignId: campaignOpenWithBids.id,
      creatorId: foodLeo.id,
      amountCents: 25_000,
      estimatedViews: foodLeo.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    // Campaign 3 bids — sized to all fit within the 80,000-cent budget (65,000 total).
    {
      campaignId: campaignPendingClose.id,
      creatorId: gameTom.id,
      amountCents: 40_000,
      estimatedViews: gameTom.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    {
      campaignId: campaignPendingClose.id,
      creatorId: gameAna.id,
      amountCents: 9_000,
      estimatedViews: gameAna.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    {
      campaignId: campaignPendingClose.id,
      creatorId: techDev.id,
      amountCents: 16_000,
      estimatedViews: techDev.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    // Campaign 5 — the exact greedy-suboptimal fixture (plan §4.7).
    {
      campaignId: campaignGreedyDemo.id,
      creatorId: demoB.id,
      amountCents: 15_000,
      estimatedViews: demoB.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    {
      campaignId: campaignGreedyDemo.id,
      creatorId: demoE.id,
      amountCents: 54_000,
      estimatedViews: demoE.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    {
      campaignId: campaignGreedyDemo.id,
      creatorId: demoA.id,
      amountCents: 50_000,
      estimatedViews: demoA.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
    {
      campaignId: campaignGreedyDemo.id,
      creatorId: demoD.id,
      amountCents: 33_000,
      estimatedViews: demoD.medianViews,
      pricingPolicyVersion: PRICING_POLICY_VERSION,
      status: "active",
    },
  ]);

  // campaignIneligibleHeavy intentionally gets zero bids: it exists to demonstrate the
  // ineligibility UI, not the bidding or closing flow.
  void campaignIneligibleHeavy;

  console.log("Seed complete: 3 advertisers, 18 creators, 5 campaigns, 10 bids.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
