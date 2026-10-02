import { closeDueCampaigns } from "@marketplace/application";
import { campaigns, createDb } from "@marketplace/db";
import { and, eq, lt } from "drizzle-orm";
import pino from "pino";
import { loadConfig } from "./config.js";

const config = loadConfig();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const { db, close } = createDb(config.DATABASE_URL);

let shuttingDown = false;

// Cross-tick backoff for campaigns that fail to close (plan §6.3: "a bounded retry/backoff so
// one poison campaign cannot starve others"). Per-tick isolation (excludeIds inside
// closeDueCampaigns) already stops a failing campaign from blocking the REST of one tick; this
// stops it from being retried on literally every tick forever once it's known bad.
interface BackoffState {
  consecutiveFailures: number;
  skipUntil: number;
}
const backoff = new Map<number, BackoffState>();
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

function currentlyBackedOffIds(now: number): number[] {
  return [...backoff.entries()].filter(([, state]) => state.skipUntil > now).map(([id]) => id);
}

function recordFailure(campaignId: number): void {
  const previous = backoff.get(campaignId);
  const consecutiveFailures = (previous?.consecutiveFailures ?? 0) + 1;
  const delayMs = Math.min(BASE_BACKOFF_MS * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS);
  backoff.set(campaignId, { consecutiveFailures, skipUntil: Date.now() + delayMs });
}

function recordSuccessOrAbsence(campaignId: number): void {
  backoff.delete(campaignId);
}

/**
 * One pass: closes every due campaign not currently in backoff, one transaction each (plan
 * §6.3). Logs each closed campaign with its outcome and each failure with its campaign id and
 * error — failures are isolated per campaign (closeDueCampaigns) and backed off across ticks
 * (above), so one poisoned campaign is visible and retried on a slower cadence, never silent
 * and never starving everything behind it.
 */
async function tick(): Promise<void> {
  const excluded = currentlyBackedOffIds(Date.now());
  const { results, failures } = await closeDueCampaigns(db, 100, excluded);

  for (const result of results) {
    if (result.closed) {
      recordSuccessOrAbsence(result.campaignId);
      logger.info(
        {
          campaignId: result.campaignId,
          bidsConsidered: result.bidsConsidered,
          winnersCount: result.winnersCount,
          spendCents: result.spendCents,
          estimatedViewsTotal: result.estimatedViewsTotal,
          unusedBudgetCents: result.unusedBudgetCents,
        },
        "campaign closed",
      );
    }
  }

  for (const failure of failures) {
    recordFailure(failure.campaignId);
    const state = backoff.get(failure.campaignId);
    logger.error(
      { campaignId: failure.campaignId, error: failure.error, consecutiveFailures: state?.consecutiveFailures },
      "campaign close failed — backing off",
    );
  }

  // Heartbeat: due-but-not-closed count and the worst settle lag among them, every tick. This
  // is the SLI the README's production section argues for (README "Running this in
  // production" — settle lag), and it's what makes "alive" distinguishable from "wedged": a
  // silent worker between closes looks identical to a crashed one without this line.
  const now = new Date();
  const stillDue = await db
    .select({ deadlineAt: campaigns.deadlineAt })
    .from(campaigns)
    .where(and(eq(campaigns.status, "open"), lt(campaigns.deadlineAt, now)));
  const maxSettleLagMs = stillDue.reduce((max, c) => Math.max(max, now.getTime() - c.deadlineAt.getTime()), 0);
  logger.info(
    { dueCount: stillDue.length, maxSettleLagMs, backedOffCount: excluded.length },
    "worker heartbeat",
  );
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    try {
      await tick();
    } catch (err) {
      // Genuinely unexpected — not a per-campaign CampaignCloseError (those are already
      // isolated and reported inside tick()). E.g. the database connection itself is down.
      logger.error({ err }, "worker tick failed unexpectedly");
    }
    await new Promise((resolve) => setTimeout(resolve, config.WORKER_POLL_INTERVAL_MS));
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down");
  shuttingDown = true;
  await close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

logger.info({ pollIntervalMs: config.WORKER_POLL_INTERVAL_MS }, "worker starting");
void loop();
