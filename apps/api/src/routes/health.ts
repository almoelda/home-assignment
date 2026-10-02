import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Liveness: process is up and responding. Must never touch the database — a DB outage
  // should not make Kubernetes think the process itself is unhealthy and restart it.
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness: can this instance actually serve traffic right now.
  app.get("/ready", async (_req, reply) => {
    try {
      await deps.db.execute(sql`SELECT 1`);
      return { status: "ok" };
    } catch (err) {
      app.log.error({ err }, "readiness check failed: database unreachable");
      return reply.code(503).send({ status: "unavailable" });
    }
  });
}
