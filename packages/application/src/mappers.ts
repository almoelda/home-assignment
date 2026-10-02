import type { campaigns, creators, Database } from "@marketplace/db";
import type { CampaignRequirements, CreatorProfile } from "@marketplace/domain";
import { sql } from "drizzle-orm";

type CreatorRow = typeof creators.$inferSelect;
type CampaignRow = typeof campaigns.$inferSelect;

export function toCreatorProfile(row: CreatorRow): CreatorProfile {
  return {
    id: row.id,
    platform: row.platform,
    genre: row.genre,
    followers: row.followers,
    engagementBps: row.engagementBps,
    medianViews: row.medianViews,
    minFeeCents: row.minFeeCents,
  };
}

export function toCampaignRequirements(row: CampaignRow): CampaignRequirements {
  return {
    id: row.id,
    platforms: row.platforms,
    genres: row.genres,
    minFollowers: row.minFollowers,
    minEngagementBps: row.minEngagementBps,
    budgetCents: row.budgetCents,
    targetCpmCents: row.targetCpmCents,
    maxCpmCents: row.maxCpmCents,
    deadlineAt: row.deadlineAt,
  };
}

/**
 * Reads the DATABASE clock, inside the current transaction — plan §6.1: all deadline
 * decisions use Postgres `clock_timestamp()`, never application-server time.
 *
 * `db.execute(sql...)` returns raw driver rows, not Drizzle's schema-mapped types — the
 * node-postgres driver gives back `timestamptz` as a STRING (e.g.
 * "2026-10-01 19:27:54.586+00"), not a `Date`. Comparing that string directly against a
 * `Date` with `<=` silently coerces to `NaN` and is always `false` — this is exactly the bug
 * that would make a deadline check never fire. `new Date(...)` here is load-bearing, not
 * decorative.
 */
export async function readClockTimestamp(tx: Pick<Database, "execute">): Promise<Date> {
  const result = await tx.execute<{ now: string }>(sql`SELECT clock_timestamp() AS now`);
  const raw = result.rows[0]?.now;
  if (!raw) throw new Error("database did not return a timestamp");
  return new Date(raw);
}

export type CampaignDisplayState = "open" | "settling" | "closed";

/** Derived, never stored (plan §3): the three states a campaign actually shows as. */
export function campaignDisplayState(
  row: Pick<CampaignRow, "status" | "deadlineAt">,
  now: Date,
): CampaignDisplayState {
  if (row.status === "closed") return "closed";
  return row.deadlineAt <= now ? "settling" : "open";
}
