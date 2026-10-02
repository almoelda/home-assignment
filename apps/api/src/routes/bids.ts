import { listBidsForCampaign, listBidsForCreator, placeBid, withdrawBid } from "@marketplace/application";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getActor } from "../actor.js";
import type { AppDeps } from "../app.js";
import { sendApplicationError } from "../errorMapping.js";

// Matches the campaign money ceiling (apps/api/src/routes/campaigns.ts) — below Postgres
// `integer` range on bids.amount_cents, rejected as 400 rather than a raw DB range error.
const MAX_MONEY_CENTS = 2_000_000_000;

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const putBidBodySchema = z.object({ amountCents: z.number().int().positive().max(MAX_MONEY_CENTS) });

export function registerBidRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.put("/campaigns/:id/bids/me", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    const actor = getActor(req);
    if (!actor || actor.role !== "creator") {
      return reply.code(403).send({
        error: { code: "FORBIDDEN_ACTOR", message: "must act as a creator (X-Actor-Role: creator) to bid" },
      });
    }
    const body = putBidBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: body.error.message } });
    }

    try {
      const bid = await placeBid(deps.db, {
        campaignId: params.data.id,
        creatorId: actor.id,
        amountCents: body.data.amountCents,
      });
      return reply.code(200).send(bid);
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });

  app.delete("/campaigns/:id/bids/me", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    const actor = getActor(req);
    if (!actor || actor.role !== "creator") {
      return reply.code(403).send({
        error: { code: "FORBIDDEN_ACTOR", message: "must act as a creator (X-Actor-Role: creator) to withdraw a bid" },
      });
    }

    try {
      await withdrawBid(deps.db, params.data.id, actor.id);
      return reply.code(204).send();
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });

  app.get("/creators/:id/bids", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    // Sealed bids (plan §5): "A creator sees only their own bid." A soft hint, not real auth
    // (no auth in this project — anyone can send any X-Actor-Id), but the rule still has to be
    // expressed in code, the same way /campaigns/:id/bids already gates the owning advertiser.
    const actor = getActor(req);
    if (!actor || actor.role !== "creator" || actor.id !== params.data.id) {
      return reply.code(403).send({
        error: { code: "FORBIDDEN_ACTOR", message: "can only view your own bids" },
      });
    }
    try {
      const bids = await listBidsForCreator(deps.db, params.data.id);
      return { bids };
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });

  app.get("/campaigns/:id/bids", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    const actor = getActor(req);
    if (!actor || actor.role !== "advertiser") {
      return reply.code(403).send({
        error: { code: "FORBIDDEN_ACTOR", message: "must act as the owning advertiser to view bids" },
      });
    }
    try {
      const bids = await listBidsForCampaign(deps.db, params.data.id, actor.id);
      return { bids };
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });
}
