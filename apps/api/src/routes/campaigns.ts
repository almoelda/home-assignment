import {
  createCampaign,
  getCampaignDetail,
  listCampaignsForAdvertiser,
  listOpportunitiesForCreator,
} from "@marketplace/application";
import type { Genre, Platform } from "@marketplace/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { getActor } from "../actor.js";
import { sendApplicationError } from "../errorMapping.js";

const PLATFORMS: [Platform, ...Platform[]] = ["tiktok", "instagram"];
const GENRES: [Genre, ...Genre[]] = [
  "fitness",
  "beauty",
  "gaming",
  "food",
  "travel",
  "tech",
  "fashion",
  "music",
];

// Below Postgres `integer` (int4) range on every money/views column these feed
// (packages/db/src/schema.ts) — rejected here as 400 VALIDATION_ERROR rather than reaching
// the database as a raw out-of-range error.
const MAX_MONEY_CENTS = 2_000_000_000;

const createCampaignBodySchema = z.object({
  title: z.string().min(1),
  brief: z.string().min(1),
  budgetCents: z.number().int().positive().max(MAX_MONEY_CENTS),
  deadlineAt: z.string().datetime({ offset: true }),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  genres: z.array(z.enum(GENRES)).min(1),
  minFollowers: z.number().int().min(0).default(0),
  minEngagementBps: z.number().int().min(0).default(0),
  targetCpmCents: z.number().int().positive().max(MAX_MONEY_CENTS),
  maxCpmCents: z.number().int().positive().max(MAX_MONEY_CENTS),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function registerCampaignRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post("/campaigns", async (req, reply) => {
    const actor = getActor(req);
    if (!actor || actor.role !== "advertiser") {
      return reply.code(403).send({
        error: { code: "FORBIDDEN_ACTOR", message: "must act as an advertiser (X-Actor-Role: advertiser) to create a campaign" },
      });
    }

    const parsed = createCampaignBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }

    try {
      const campaign = await createCampaign(deps.db, {
        advertiserId: actor.id,
        ...parsed.data,
        deadlineAt: new Date(parsed.data.deadlineAt),
      });
      return reply.code(201).send(campaign);
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });

  app.get("/advertisers/:id/campaigns", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    try {
      const campaigns = await listCampaignsForAdvertiser(deps.db, params.data.id);
      return { campaigns };
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });

  app.get("/campaigns/:id", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    const actor = getActor(req);
    const actorCreatorId = actor?.role === "creator" ? actor.id : null;
    try {
      return await getCampaignDetail(deps.db, params.data.id, actorCreatorId);
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });

  app.get("/creators/:id/campaigns", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    const query = req.query as { include?: string };
    try {
      const result = await listOpportunitiesForCreator(deps.db, params.data.id);
      if (query.include === "ineligible") {
        return result;
      }
      return { eligible: result.eligible };
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });
}
