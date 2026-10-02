import { advertisers, createDb, creators, type DbHandle } from "@marketplace/db";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("bid routes", () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;
  let advertiserId: number;
  let creatorId: number;

  beforeAll(async () => {
    dbHandle = createDb(DATABASE_URL);
    app = buildApp({ db: dbHandle.db });

    const [advertiser] = await dbHandle.db
      .insert(advertisers)
      .values({ name: `Bid Route Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;

    const [creator] = await dbHandle.db
      .insert(creators)
      .values({
        handle: `bid_route_${randomUUID()}`,
        displayName: "Bid Route Creator",
        platform: "tiktok",
        genre: "fitness",
        followers: 50_000,
        engagementBps: 500,
        medianViews: 20_000,
        minFeeCents: 10_000,
      })
      .returning();
    if (!creator) throw new Error("fixture creator insert failed");
    creatorId = creator.id;
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  async function createOpenCampaign() {
    const res = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
      payload: {
        title: `Bid Route Campaign ${randomUUID()}`,
        brief: "Brief.",
        budgetCents: 500_000,
        deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        platforms: ["tiktok"],
        genres: ["fitness"],
        targetCpmCents: 1_000,
        maxCpmCents: 2_000,
      },
    });
    return res.json() as { id: number };
  }

  describe("PUT /campaigns/:id/bids/me", () => {
    it("rejects without a creator actor", async () => {
      const campaign = await createOpenCampaign();
      const res = await app.inject({
        method: "PUT",
        url: `/campaigns/${campaign.id}/bids/me`,
        payload: { amountCents: 15_000 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("places a bid for an eligible creator", async () => {
      const campaign = await createOpenCampaign();
      const res = await app.inject({
        method: "PUT",
        url: `/campaigns/${campaign.id}/bids/me`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
        payload: { amountCents: 15_000 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { status: string; amountCents: number };
      expect(body.status).toBe("active");
      expect(body.amountCents).toBe(15_000);
    });

    it("rejects an amount below the minimum fee with BELOW_MIN_FEE", async () => {
      const campaign = await createOpenCampaign();
      const res = await app.inject({
        method: "PUT",
        url: `/campaigns/${campaign.id}/bids/me`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
        payload: { amountCents: 500 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "BELOW_MIN_FEE" } });
    });
  });

  describe("DELETE /campaigns/:id/bids/me", () => {
    it("withdraws an active bid", async () => {
      const campaign = await createOpenCampaign();
      await app.inject({
        method: "PUT",
        url: `/campaigns/${campaign.id}/bids/me`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
        payload: { amountCents: 15_000 },
      });
      const res = await app.inject({
        method: "DELETE",
        url: `/campaigns/${campaign.id}/bids/me`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
      });
      expect(res.statusCode).toBe(204);
    });

    it("returns NOT_FOUND when there is no active bid", async () => {
      const campaign = await createOpenCampaign();
      const res = await app.inject({
        method: "DELETE",
        url: `/campaigns/${campaign.id}/bids/me`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /creators/:id/bids", () => {
    it("lets a creator list their own bids", async () => {
      const campaign = await createOpenCampaign();
      await app.inject({
        method: "PUT",
        url: `/campaigns/${campaign.id}/bids/me`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
        payload: { amountCents: 15_000 },
      });
      const res = await app.inject({
        method: "GET",
        url: `/creators/${creatorId}/bids`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { bids: Array<{ campaignId: number }> };
      expect(body.bids.some((b) => b.campaignId === campaign.id)).toBe(true);
    });

    it("rejects a request with no actor headers (sealed bids — plan §5)", async () => {
      const res = await app.inject({ method: "GET", url: `/creators/${creatorId}/bids` });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: "FORBIDDEN_ACTOR" } });
    });

    it("rejects a different creator trying to view someone else's bids", async () => {
      const [otherCreator] = await dbHandle.db
        .insert(creators)
        .values({
          handle: `bid_route_other_${randomUUID()}`,
          displayName: "Other Creator",
          platform: "tiktok",
          genre: "fitness",
          followers: 50_000,
          engagementBps: 500,
          medianViews: 20_000,
          minFeeCents: 10_000,
        })
        .returning();
      if (!otherCreator) throw new Error("fixture insert failed");

      const res = await app.inject({
        method: "GET",
        url: `/creators/${creatorId}/bids`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(otherCreator.id) },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: "FORBIDDEN_ACTOR" } });
    });
  });

  describe("GET /campaigns/:id/bids", () => {
    it("rejects a non-advertiser actor", async () => {
      const campaign = await createOpenCampaign();
      const res = await app.inject({
        method: "GET",
        url: `/campaigns/${campaign.id}/bids`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
      });
      expect(res.statusCode).toBe(403);
    });

    it("lets the owning advertiser see ranked bids", async () => {
      const campaign = await createOpenCampaign();
      await app.inject({
        method: "PUT",
        url: `/campaigns/${campaign.id}/bids/me`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
        payload: { amountCents: 15_000 },
      });
      const res = await app.inject({
        method: "GET",
        url: `/campaigns/${campaign.id}/bids`,
        headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { bids: Array<{ valueRank: number }> };
      expect(body.bids).toHaveLength(1);
      expect(body.bids[0]?.valueRank).toBe(1);
    });
  });
});
