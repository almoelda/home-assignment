import { advertisers, createDb, creators, type DbHandle } from "@marketplace/db";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("campaign routes", () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;
  let advertiserId: number;
  let creatorId: number;

  beforeAll(async () => {
    dbHandle = createDb(DATABASE_URL);
    app = buildApp({ db: dbHandle.db });

    const [advertiser] = await dbHandle.db
      .insert(advertisers)
      .values({ name: `Route Test Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;

    const [creator] = await dbHandle.db
      .insert(creators)
      .values({
        handle: `route_test_${randomUUID()}`,
        displayName: "Route Test Creator",
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

  function validCampaignBody(overrides: Record<string, unknown> = {}) {
    return {
      title: `API Test Campaign ${randomUUID()}`,
      brief: "Brief.",
      budgetCents: 100_000,
      deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      platforms: ["tiktok"],
      genres: ["fitness"],
      targetCpmCents: 1_000,
      maxCpmCents: 2_000,
      ...overrides,
    };
  }

  describe("POST /campaigns", () => {
    it("rejects a request with no actor headers", async () => {
      const res = await app.inject({ method: "POST", url: "/campaigns", payload: validCampaignBody() });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: "FORBIDDEN_ACTOR" } });
    });

    it("rejects a creator actor (only advertisers can create campaigns)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
        payload: validCampaignBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects an invalid body with VALIDATION_ERROR", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
        payload: validCampaignBody({ platforms: [] }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    });

    it("creates a campaign for a valid advertiser request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
        payload: validCampaignBody(),
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: number; status: string };
      expect(body.id).toBeGreaterThan(0);
      expect(body.status).toBe("open");
    });

    it("rejects an out-of-range budget as 400 VALIDATION_ERROR rather than a raw DB error (F6)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
        payload: validCampaignBody({ budgetCents: 999_999_999_999 }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    });
  });

  describe("GET /advertisers/:id/campaigns", () => {
    it("lists campaigns for the advertiser", async () => {
      await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
        payload: validCampaignBody(),
      });
      const res = await app.inject({ method: "GET", url: `/advertisers/${advertiserId}/campaigns` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { campaigns: unknown[] };
      expect(body.campaigns.length).toBeGreaterThan(0);
    });

    it("returns NOT_FOUND for an unknown advertiser", async () => {
      const res = await app.inject({ method: "GET", url: "/advertisers/9999999/campaigns" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    });
  });

  describe("GET /campaigns/:id", () => {
    it("includes price guidance when requested as an eligible creator", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/campaigns",
        headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
        payload: validCampaignBody(),
      });
      const { id } = createRes.json() as { id: number };

      const res = await app.inject({
        method: "GET",
        url: `/campaigns/${id}`,
        headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { guidanceForActor: { minFeeCents: number } | null };
      expect(body.guidanceForActor).not.toBeNull();
      expect(body.guidanceForActor?.minFeeCents).toBe(10_000);
    });

    it("returns 404 for an unknown campaign", async () => {
      const res = await app.inject({ method: "GET", url: "/campaigns/9999999" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /creators/:id/campaigns", () => {
    it("omits ineligible campaigns by default and includes them with ?include=ineligible", async () => {
      const withoutIneligible = await app.inject({ method: "GET", url: `/creators/${creatorId}/campaigns` });
      expect(withoutIneligible.statusCode).toBe(200);
      expect(withoutIneligible.json()).not.toHaveProperty("ineligible");

      const withIneligible = await app.inject({
        method: "GET",
        url: `/creators/${creatorId}/campaigns?include=ineligible`,
      });
      expect(withIneligible.statusCode).toBe(200);
      expect(withIneligible.json()).toHaveProperty("ineligible");
    });
  });
});
