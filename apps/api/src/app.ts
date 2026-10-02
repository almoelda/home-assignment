import cors from "@fastify/cors";
import type { Database } from "@marketplace/db";
import Fastify, { type FastifyInstance } from "fastify";
import { registerBidRoutes } from "./routes/bids.js";
import { registerCampaignRoutes } from "./routes/campaigns.js";
import { registerResultRoutes } from "./routes/results.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIdentityRoutes } from "./routes/identities.js";

export interface AppDeps {
  db: Database;
}

/**
 * Builds the Fastify instance without starting it — kept separate from main.ts so
 * integration tests can construct an app against a test database without binding a port.
 * Per CLAUDE.md: the API stays thin, business logic lives in packages/domain and
 * packages/application.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  app.register(cors, { origin: true });

  app.decorate("db", deps.db);

  // Catches anything a route handler didn't already turn into an ApplicationError — e.g. a
  // raw Postgres error (out-of-range value, constraint violation we didn't pre-validate for).
  // Without this, Fastify's default handler lets the real error (SQLSTATE, column name, raw
  // message) reach the client; the documented INTERNAL code was otherwise never actually
  // emitted by anything (F6 in the independent review).
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error" } });
  });

  registerHealthRoutes(app, deps);
  registerIdentityRoutes(app, deps);
  registerCampaignRoutes(app, deps);
  registerBidRoutes(app, deps);
  registerResultRoutes(app, deps);

  return app;
}
