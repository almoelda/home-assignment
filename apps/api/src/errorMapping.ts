import { ApplicationError, type ErrorCode } from "@marketplace/application";
import type { FastifyReply } from "fastify";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FORBIDDEN_ACTOR: 403,
  NOT_ELIGIBLE: 403,
  BELOW_MIN_FEE: 400,
  ABOVE_MAX_PRICE: 400,
  BIDDING_ENDED: 409,
  CAMPAIGN_CLOSED: 409,
  INTERNAL: 500,
};

/**
 * Translates an ApplicationError into the stable `{ error: { code, message, details } }`
 * shape (plan §7). apps/api is the ONLY layer that knows about HTTP status codes —
 * packages/application never imports Fastify.
 *
 * Logs `err.code` on every response — this is what makes the README's observability claim
 * ("stable codes designed to be dashboarded directly") actually true: without a log line
 * carrying the code, there is nothing for a log-based dashboard to aggregate (F17,
 * independent review).
 */
export function sendApplicationError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ApplicationError) {
    reply.log.info({ code: err.code, message: err.message }, "application error");
    return reply.code(STATUS_BY_CODE[err.code]).send({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  throw err;
}
