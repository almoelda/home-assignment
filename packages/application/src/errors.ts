// Error codes from IMPLEMENTATION_PLAN.md §7. apps/api maps these to HTTP status codes;
// this package never knows about HTTP.
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "FORBIDDEN_ACTOR",
  "NOT_ELIGIBLE",
  "BELOW_MIN_FEE",
  "ABOVE_MAX_PRICE",
  "BIDDING_ENDED",
  "CAMPAIGN_CLOSED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ApplicationError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.details = details;
  }
}
