import { advertisers, bids, campaignClosings, campaigns, createDb, creators, type DbHandle } from "@marketplace/db";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { placeBid } from "./bids.js";
import { createCampaign, type CreateCampaignInput } from "./campaigns.js";
import { closeNextDueCampaign } from "./closing.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

/** Resolves externally — lets a test pause one transaction mid-flight while it drives another. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("closing job — concurrency and races", () => {
  // Two independent connection pools, simulating two separate worker processes — a single
  // shared pool would still exercise real row locking, but two pools make "two workers" true
  // rather than merely plausible.
  let handleA: DbHandle;
  let handleB: DbHandle;
  let advertiserId: number;

  beforeAll(async () => {
    handleA = createDb(DATABASE_URL);
    handleB = createDb(DATABASE_URL);
    const [advertiser] = await handleA.db
      .insert(advertisers)
      .values({ name: `Race Test Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;
  });

  afterAll(async () => {
    await handleA.close();
    await handleB.close();
  });

  async function makeCreator() {
    const [creator] = await handleA.db
      .insert(creators)
      .values({
        handle: `race_${randomUUID()}`,
        displayName: "Race Test Creator",
        platform: "tiktok",
        genre: "fitness",
        followers: 50_000,
        engagementBps: 500,
        medianViews: 20_000,
        minFeeCents: 10_000,
      })
      .returning();
    if (!creator) throw new Error("fixture creator insert failed");
    return creator;
  }

  async function makeFutureCampaign(overrides: Partial<CreateCampaignInput> = {}) {
    return createCampaign(handleA.db, {
      advertiserId,
      title: `Race Campaign ${randomUUID()}`,
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

  async function backdate(campaignId: number) {
    await handleA.db.execute(sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${campaignId}`);
  }

  it("two closers racing the same due campaign: exactly one closes it, the other finds nothing to do", async () => {
    const campaign = await makeFutureCampaign();
    await backdate(campaign.id);

    const [resultA, resultB] = await Promise.all([
      closeNextDueCampaign(handleA.db),
      closeNextDueCampaign(handleB.db),
    ]);

    const closedResults = [resultA, resultB].filter((r) => r.closed);
    expect(closedResults).toHaveLength(1);
    // SKIP LOCKED means the loser finds no OTHER due campaign to claim instead, since this
    // was the only one due — it correctly reports closed:false rather than blocking.
    expect([resultA.closed, resultB.closed].filter((c) => !c)).toHaveLength(1);

    const closingRows = await handleA.db.select().from(campaignClosings).where(eq(campaignClosings.campaignId, campaign.id));
    expect(closingRows).toHaveLength(1);
  });

  it(
    "bid/close race — bid holds the campaign lock first: the closer skips it (SKIP LOCKED), " +
      "and once the bid commits, a later close correctly includes it",
    async () => {
      const creator = await makeCreator();
      const campaign = await makeFutureCampaign();
      await backdate(campaign.id);

      const lockAcquired = deferred();
      const releaseBidHolder = deferred();

      // Manually hold a FOR UPDATE lock on the campaign row — standing in for a bid write
      // that is mid-transaction, without needing to fork placeBid's internals to inject a
      // pause point.
      const bidHolderTx = handleA.db.transaction(async (tx) => {
        await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).for("update");
        lockAcquired.resolve();
        await releaseBidHolder.promise;
        await tx.insert(bids).values({
          campaignId: campaign.id,
          creatorId: creator.id,
          amountCents: 15_000,
          estimatedViews: creator.medianViews,
          pricingPolicyVersion: "median-views-v1",
          status: "active",
        });
      });

      await lockAcquired.promise;

      // The closer runs WHILE the row is locked — SKIP LOCKED means it does not block; with
      // only one due campaign and it being locked, it finds nothing to claim.
      const whileLocked = await closeNextDueCampaign(handleB.db);
      expect(whileLocked).toEqual({ closed: false });

      releaseBidHolder.resolve();
      await bidHolderTx;

      // Now that the bid has committed, a subsequent close correctly claims and includes it.
      const afterCommit = await closeNextDueCampaign(handleB.db);
      expect(afterCommit.closed).toBe(true);
      if (!afterCommit.closed) throw new Error("unreachable");
      expect(afterCommit.bidsConsidered).toBe(1);
      expect(afterCommit.winnersCount).toBe(1);

      const [bidRow] = await handleA.db.select().from(bids).where(and(eq(bids.campaignId, campaign.id), eq(bids.creatorId, creator.id)));
      expect(bidRow?.status).toBe("won");
    },
  );

  it(
    "bid/close race — the closer holds the campaign lock first: a concurrent bid genuinely " +
      "blocks (observed, not inferred), then sees the campaign closed and is rejected",
    async () => {
      const creator = await makeCreator();
      const campaign = await makeFutureCampaign();
      await backdate(campaign.id);

      const lockAcquired = deferred();
      const releaseCloser = deferred();

      // Drives the REAL closer and pauses it, under the lock, via the test-only
      // onLockAcquired hook (F8 — the previous version of this test hand-copied the closer's
      // claim query into the test body, so it would keep passing even if closing.ts lost its
      // row lock entirely).
      const closerPromise = closeNextDueCampaign(handleA.db, {
        onLockAcquired: async () => {
          lockAcquired.resolve();
          await releaseCloser.promise;
        },
      });

      await lockAcquired.promise;

      // placeBid's own FOR UPDATE (no SKIP LOCKED) should block here until the closer above
      // commits. Observed directly: race the bid attempt against a short timer — if it were
      // NOT blocked, it would settle (resolve or reject) well within that window.
      const bidAttempt = placeBid(handleB.db, { campaignId: campaign.id, creatorId: creator.id, amountCents: 15_000 });
      const settledEarly = await Promise.race([
        bidAttempt.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
      ]);
      expect(settledEarly).toBe(false);

      releaseCloser.resolve();
      await closerPromise;

      await expect(bidAttempt).rejects.toMatchObject({ code: "CAMPAIGN_CLOSED" });

      const activeBids = await handleA.db
        .select()
        .from(bids)
        .where(and(eq(bids.campaignId, campaign.id), eq(bids.status, "active")));
      expect(activeBids).toHaveLength(0);
    },
  );
});
