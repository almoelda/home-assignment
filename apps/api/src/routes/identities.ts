import { advertisers, creators } from "@marketplace/db";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";

/**
 * GET /identities — backs the "Acting as" switcher (brief: "The user picks who they're
 * acting as", no auth). Returns every advertiser and creator so the UI can list them.
 */
export function registerIdentityRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/identities", async () => {
    const [advertiserRows, creatorRows] = await Promise.all([
      deps.db.select({ id: advertisers.id, name: advertisers.name }).from(advertisers).orderBy(advertisers.name),
      deps.db
        .select({
          id: creators.id,
          handle: creators.handle,
          displayName: creators.displayName,
          platform: creators.platform,
          genre: creators.genre,
        })
        .from(creators)
        .orderBy(creators.displayName),
    ]);

    return {
      advertisers: advertiserRows,
      creators: creatorRows,
    };
  });
}
