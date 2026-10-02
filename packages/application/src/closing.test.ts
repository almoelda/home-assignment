import { advertisers, bids, campaignClosings, campaigns, createDb, creators, type DbHandle } from "@marketplace/db";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCampaign, type CreateCampaignInput } from "./campaigns.js";
import { closeDueCampaigns, closeNextDueCampaign } from "./closing.js";
import { placeBid } from "./bids.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("closing job", () => {
  let handle: DbHandle;
  let advertiserId: number;

  beforeAll(async () => {
    handle = createDb(DATABASE_URL);
    const [advertiser] = await handle.db
      .insert(advertisers)
      .values({ name: `Closing Test Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;
  });

  afterAll(async () => {
    await handle.close();
  });

  async function makeCreator(overrides: Partial<typeof creators.$inferInsert> = {}) {
    const [creator] = await handle.db
      .insert(creators)
      .values({
        handle: `closing_${randomUUID()}`,
        displayName: "Closing Test Creator",
        platform: "tiktok",
        genre: "fitness",
        followers: 50_000,
        engagementBps: 500,
        medianViews: 20_000,
        minFeeCents: 10_000,
        ...overrides,
      })
      .returning();
    if (!creator) throw new Error("fixture creator insert failed");
    return creator;
  }

  /** Creates an open campaign with a near-future deadline, then backdates it directly via SQL
   * so it's immediately due — mirrors a real campaign reaching its deadline, without having to
   * wait in real time. */
  async function makeDueCampaign(overrides: Partial<CreateCampaignInput> = {}) {
    const campaign = await createCampaign(handle.db, {
      advertiserId,
      title: `Closing Test Campaign ${randomUUID()}`,
      brief: "Brief.",
      budgetCents: 100_000,
      deadlineAt: new Date(Date.now() + 2 * 60_000),
      platforms: ["tiktok"],
      genres: ["fitness"],
      minFollowers: 0,
      minEngagementBps: 0,
      targetCpmCents: 1_000,
      maxCpmCents: 2_000,
      ...overrides,
    });
    await handle.db.execute(sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${campaign.id}`);
    return campaign;
  }

  async function makeFutureCampaign(overrides: Partial<CreateCampaignInput> = {}) {
    return createCampaign(handle.db, {
      advertiserId,
      title: `Future Campaign ${randomUUID()}`,
      brief: "Brief.",
      budgetCents: 100_000,
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      platforms: ["tiktok"],
      genres: ["fitness"],
      minFollowers: 0,
      minEngagementBps: 0,
      targetCpmCents: 1_000,
      maxCpmCents: 2_000,
      ...overrides,
    });
  }

  it("leaves a campaign before its deadline untouched", async () => {
    const campaign = await makeFutureCampaign();
    const result = await closeNextDueCampaign(handle.db);
    // Either closed:false (no due campaigns at all) or it closed a DIFFERENT due campaign
    // left over from another test — either way, our future campaign must still be open.
    void result;
    const [row] = await handle.db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("open");
  });

  it("closes a campaign with zero bids, awarding zero winners", async () => {
    const campaign = await makeDueCampaign();
    const result = await closeNextDueCampaignFor(campaign.id);
    expect(result.closed).toBe(true);
    if (!result.closed) throw new Error("unreachable");
    expect(result.campaignId).toBe(campaign.id);
    expect(result.winnersCount).toBe(0);
    expect(result.spendCents).toBe(0);
    expect(result.bidsConsidered).toBe(0);

    const [row] = await handle.db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(row?.status).toBe("closed");
    expect(row?.closedAt).not.toBeNull();
  });

  it("awards winners within budget and marks losers with a specific reason", async () => {
    const generous = await makeCreator({ medianViews: 50_000, minFeeCents: 10_000 });
    const worseValue = await makeCreator({ medianViews: 10_000, minFeeCents: 10_000 });

    // Bids must be placed while the campaign is still open (placeBid enforces the deadline),
    // so create it with a future deadline, bid, then backdate it to due. maxCpmCents set high
    // so the max-price cap isn't the binding constraint — budget and ratio are what's tested.
    const fresh = await makeFutureCampaign({ budgetCents: 100_000, targetCpmCents: 1_000, maxCpmCents: 20_000 });
    await placeBid(handle.db, { campaignId: fresh.id, creatorId: generous.id, amountCents: 50_000 }); // ratio 1.0
    await placeBid(handle.db, { campaignId: fresh.id, creatorId: worseValue.id, amountCents: 60_000 }); // ratio 0.167, won't fit after generous (50k+60k > 100k budget)

    await handle.db.execute(sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${fresh.id}`);

    const result = await closeNextDueCampaignFor(fresh.id);
    expect(result.closed).toBe(true);
    if (!result.closed) throw new Error("unreachable");
    expect(result.winnersCount).toBe(1);
    expect(result.spendCents).toBe(50_000);
    expect(result.unusedBudgetCents).toBe(50_000);

    const rows = await handle.db.select().from(bids).where(eq(bids.campaignId, fresh.id));
    const generousBid = rows.find((b) => b.creatorId === generous.id);
    const worseValueBid = rows.find((b) => b.creatorId === worseValue.id);
    expect(generousBid?.status).toBe("won");
    expect(generousBid?.resultReason).toMatch(/Selected/);
    expect(worseValueBid?.status).toBe("lost");
    expect(worseValueBid?.resultReason).toMatch(/Insufficient remaining budget/);
  });

  it("never awards more than the budget (invariant holds across many bids)", async () => {
    const creatorsList = await Promise.all(
      Array.from({ length: 6 }, (_, i) => makeCreator({ medianViews: 10_000 * (i + 1) })),
    );
    const campaign = await makeFutureCampaign({ budgetCents: 100_000, targetCpmCents: 1_000, maxCpmCents: 5_000 });
    for (const [i, creator] of creatorsList.entries()) {
      await placeBid(handle.db, { campaignId: campaign.id, creatorId: creator.id, amountCents: 20_000 + i * 1_000 });
    }
    await handle.db.execute(sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${campaign.id}`);

    const result = await closeNextDueCampaignFor(campaign.id);
    expect(result.closed).toBe(true);
    if (!result.closed) throw new Error("unreachable");
    expect(result.spendCents).toBeLessThanOrEqual(100_000);

    const [closingRow] = await handle.db.select().from(campaignClosings).where(eq(campaignClosings.campaignId, campaign.id));
    expect(closingRow?.spendCents).toBeLessThanOrEqual(100_000);
  });

  it("running the worker loop twice in a row leaves state unchanged the second time", async () => {
    await makeDueCampaign();
    const firstPass = await closeDueCampaigns(handle.db);
    expect(firstPass.results.some((r) => r.closed)).toBe(true);
    expect(firstPass.failures).toEqual([]);

    const snapshotCampaigns = await handle.db.select().from(campaigns);
    const snapshotBids = await handle.db.select().from(bids);
    const snapshotClosings = await handle.db.select().from(campaignClosings);

    const secondPass = await closeDueCampaigns(handle.db);
    expect(secondPass).toEqual({ results: [{ closed: false }], failures: [] });

    expect(await handle.db.select().from(campaigns)).toEqual(snapshotCampaigns);
    expect(await handle.db.select().from(bids)).toEqual(snapshotBids);
    expect(await handle.db.select().from(campaignClosings)).toEqual(snapshotClosings);
  });

  it("one campaign's close failing does not block other due campaigns in the same tick, and the failure recurs on a later tick", async () => {
    // Poison it by pre-inserting its campaign_closings row — when the real closer gets to the
    // final insert, it hits the PK and the whole transaction rolls back (campaign stays
    // 'open', bids stay 'active'). Created first, so both its earlier deadline_at (backdated
    // a moment before the healthy campaign's) and its lower id put it first in claim order —
    // exactly the "oldest-first" ordering that would otherwise starve every campaign behind it.
    const poisoned = await makeDueCampaign();
    await handle.db.insert(campaignClosings).values({
      campaignId: poisoned.id,
      algorithmVersion: "greedy-v1",
      bidsConsidered: 0,
      winnersCount: 0,
      spendCents: 0,
      estimatedViewsTotal: 0,
      unusedBudgetCents: 0,
    });

    const healthy = await makeDueCampaign();

    const tick = await closeDueCampaigns(handle.db);

    expect(tick.failures.map((f) => f.campaignId)).toContain(poisoned.id);
    expect(tick.results.some((r) => r.closed && r.campaignId === healthy.id)).toBe(true);

    // The poisoned campaign's own failed attempt left it untouched, not half-closed.
    const [poisonedRow] = await handle.db.select().from(campaigns).where(eq(campaigns.id, poisoned.id));
    expect(poisonedRow?.status).toBe("open");

    // A later tick still reports it failing — the failure isn't silently swallowed after one
    // attempt, and a persistently poisoned campaign stays visible rather than disappearing.
    const laterTick = await closeDueCampaigns(handle.db);
    expect(laterTick.failures.map((f) => f.campaignId)).toContain(poisoned.id);

    // Clean up the poison: left in place, this campaign stays permanently open+due+failing
    // and any OTHER test's un-targeted closeNextDueCampaign/closeDueCampaigns call sharing
    // this database could claim and fail on it too — exactly the leaked-fixture class of bug
    // documented in DECISIONS.md ("bids.test.ts leaking a permanently-due campaign"). Removing
    // the stray row lets it close normally if anything claims it after this test.
    await handle.db.delete(campaignClosings).where(eq(campaignClosings.campaignId, poisoned.id));
  });

  it("structural backstop: a second campaign_closings row for the same campaign is rejected by the database", async () => {
    const campaign = await makeDueCampaign();
    const result = await closeNextDueCampaignFor(campaign.id);
    expect(result.closed).toBe(true);

    await expect(
      handle.db.insert(campaignClosings).values({
        campaignId: campaign.id,
        algorithmVersion: "greedy-v1",
        bidsConsidered: 0,
        winnersCount: 0,
        spendCents: 0,
        estimatedViewsTotal: 0,
        unusedBudgetCents: 0,
      }),
    ).rejects.toThrow();
  });

  it("Postgres rolls back an aborted transaction, so partial awards are never observable (the primitive L3 relies on)", async () => {
    const creator = await makeCreator();
    const campaign = await makeFutureCampaign({ budgetCents: 100_000 });
    await placeBid(handle.db, { campaignId: campaign.id, creatorId: creator.id, amountCents: 20_000 });
    await handle.db.execute(sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${campaign.id}`);

    // This does NOT call the real closer — it asserts the underlying guarantee the closer's
    // L3 depends on: an update followed by a throw, inside db.transaction, is fully undone.
    // See the next test for the real closer actually failing mid-transaction.
    await expect(
      handle.db.transaction(async (tx) => {
        await tx.update(bids).set({ status: "won" }).where(eq(bids.campaignId, campaign.id));
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash");

    // Nothing persisted: the bid is still active, the campaign still open.
    const [bidRow] = await handle.db.select().from(bids).where(and(eq(bids.campaignId, campaign.id), eq(bids.creatorId, creator.id)));
    expect(bidRow?.status).toBe("active");
    const [campaignRow] = await handle.db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignRow?.status).toBe("open");

    // A real retry succeeds cleanly.
    const retryResult = await closeNextDueCampaignFor(campaign.id);
    expect(retryResult.closed).toBe(true);
    if (!retryResult.closed) throw new Error("unreachable");
    expect(retryResult.winnersCount).toBe(1);
  });

  it("crash safety: the REAL closer failing mid-transaction rolls back completely, and a retry then succeeds", async () => {
    const creator = await makeCreator();
    const campaign = await makeFutureCampaign({ budgetCents: 100_000 });
    await placeBid(handle.db, { campaignId: campaign.id, creatorId: creator.id, amountCents: 20_000 });
    await handle.db.execute(sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${campaign.id}`);

    // Forces closeNextDueCampaign itself to fail AFTER it has updated bids to won/lost and set
    // the campaign to 'closed', but ON the final campaign_closings insert — a pre-existing row
    // for this campaign_id collides with its PK. This is the exact window plan §6.3 L3 is
    // designed to protect, exercised through the real function, not a hand-rolled transaction.
    await handle.db.insert(campaignClosings).values({
      campaignId: campaign.id,
      algorithmVersion: "greedy-v1",
      bidsConsidered: 0,
      winnersCount: 0,
      spendCents: 0,
      estimatedViewsTotal: 0,
      unusedBudgetCents: 0,
    });

    await expect(closeNextDueCampaignFor(campaign.id)).rejects.toThrow();

    // Rolled back completely: the bid update and the campaign status update inside that same
    // failed transaction were undone too, not just the insert that triggered the failure.
    const [bidRow] = await handle.db.select().from(bids).where(and(eq(bids.campaignId, campaign.id), eq(bids.creatorId, creator.id)));
    expect(bidRow?.status).toBe("active");
    const [campaignRow] = await handle.db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    expect(campaignRow?.status).toBe("open");

    // Remove the poison and retry: succeeds cleanly, proving the earlier failure left the
    // campaign genuinely retryable rather than stuck.
    await handle.db.delete(campaignClosings).where(eq(campaignClosings.campaignId, campaign.id));
    const retryResult = await closeNextDueCampaignFor(campaign.id);
    expect(retryResult.closed).toBe(true);
    if (!retryResult.closed) throw new Error("unreachable");
    expect(retryResult.winnersCount).toBe(1);
  });

  /** Closes campaigns one at a time via closeNextDueCampaign until the specific campaignId
   * has been closed, so tests aren't order-dependent on which due campaign gets claimed first
   * when multiple tests' fixtures are due simultaneously. */
  async function closeNextDueCampaignFor(campaignId: number) {
    for (let i = 0; i < 50; i++) {
      const result = await closeNextDueCampaign(handle.db);
      if (!result.closed) return result;
      if (result.campaignId === campaignId) return result;
    }
    throw new Error(`campaign ${campaignId} was never claimed after 50 attempts`);
  }
});
