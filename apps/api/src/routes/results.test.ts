import { closeDueCampaigns } from "@marketplace/application";
import { advertisers, createDb, creators, type DbHandle } from "@marketplace/db";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("GET /campaigns/:id/result", () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;
  let advertiserId: number;
  let creatorId: number;

  beforeAll(async () => {
    dbHandle = createDb(DATABASE_URL);
    app = buildApp({ db: dbHandle.db });

    const [advertiser] = await dbHandle.db
      .insert(advertisers)
      .values({ name: `Result Route Advertiser ${randomUUID()}` })
      .returning();
    if (!advertiser) throw new Error("fixture advertiser insert failed");
    advertiserId = advertiser.id;

    const [creator] = await dbHandle.db
      .insert(creators)
      .values({
        handle: `result_route_${randomUUID()}`,
        displayName: "Result Route Creator",
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

  it("returns VALIDATION_ERROR for a campaign that hasn't closed yet", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
      payload: {
        title: `Open Result Test ${randomUUID()}`,
        brief: "Brief.",
        budgetCents: 100_000,
        deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        platforms: ["tiktok"],
        genres: ["fitness"],
        targetCpmCents: 1_000,
        maxCpmCents: 2_000,
      },
    });
    const { id } = createRes.json() as { id: number };
    const res = await app.inject({ method: "GET", url: `/campaigns/${id}/result` });
    expect(res.statusCode).toBe(400);
  });

  it("returns winners, aggregate stats, and the caller's own outcome after closing", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: { "x-actor-role": "advertiser", "x-actor-id": String(advertiserId) },
      payload: {
        title: `Closed Result Test ${randomUUID()}`,
        brief: "Brief.",
        budgetCents: 100_000,
        deadlineAt: new Date(Date.now() + 60_000 * 2).toISOString(),
        platforms: ["tiktok"],
        genres: ["fitness"],
        targetCpmCents: 1_000,
        maxCpmCents: 2_000,
      },
    });
    const { id: campaignId } = createRes.json() as { id: number };

    await app.inject({
      method: "PUT",
      url: `/campaigns/${campaignId}/bids/me`,
      headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
      payload: { amountCents: 15_000 },
    });

    await dbHandle.db.execute(sql`UPDATE campaigns SET deadline_at = now() - interval '1 minute' WHERE id = ${campaignId}`);
    await closeDueCampaigns(dbHandle.db, 200);

    const asNoOne = await app.inject({ method: "GET", url: `/campaigns/${campaignId}/result` });
    expect(asNoOne.statusCode).toBe(200);
    const bodyNoOne = asNoOne.json() as { winnersCount: number; winners: unknown[]; myOutcome: unknown };
    expect(bodyNoOne.winnersCount).toBe(1);
    expect(bodyNoOne.winners).toHaveLength(1);
    expect(bodyNoOne.myOutcome).toBeNull();

    const asWinner = await app.inject({
      method: "GET",
      url: `/campaigns/${campaignId}/result`,
      headers: { "x-actor-role": "creator", "x-actor-id": String(creatorId) },
    });
    const bodyWinner = asWinner.json() as { myOutcome: { status: string; resultReason: string } | null };
    expect(bodyWinner.myOutcome?.status).toBe("won");
    expect(bodyWinner.myOutcome?.resultReason).toMatch(/Selected/);
  });
});
