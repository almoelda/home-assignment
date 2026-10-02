import { getCampaignResult } from "@marketplace/application";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getActor } from "../actor.js";
import type { AppDeps } from "../app.js";
import { sendApplicationError } from "../errorMapping.js";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function registerResultRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/campaigns/:id/result", async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: params.error.message } });
    }
    const actor = getActor(req);
    const actorCreatorId = actor?.role === "creator" ? actor.id : null;
    try {
      return await getCampaignResult(deps.db, params.data.id, actorCreatorId);
    } catch (err) {
      return sendApplicationError(reply, err);
    }
  });
}
