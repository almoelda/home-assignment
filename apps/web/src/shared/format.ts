import type { EligibilityFailureReason } from "../api/campaigns.js";

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-IE", { style: "currency", currency: "EUR" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "Meets your minimum at target rate",
  2: "Needs a bid above target",
  3: "No compatible price",
};

export function tierLabel(tier: 1 | 2 | 3): string {
  return TIER_LABELS[tier];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatEligibilityReason(reason: EligibilityFailureReason): string {
  switch (reason.code) {
    case "PLATFORM_NOT_SUPPORTED": {
      const required = (reason.required as string[]).map(capitalize).join(" or ");
      return `Platform not targeted — campaign wants ${required}, you're on ${capitalize(String(reason.actual))}`;
    }
    case "GENRE_NOT_TARGETED": {
      const required = (reason.required as string[]).map(capitalize).join(" or ");
      return `Genre not targeted — campaign wants ${required}, you're ${capitalize(String(reason.actual))}`;
    }
    case "BELOW_MIN_FOLLOWERS":
      return `Needs ${Number(reason.required).toLocaleString()} followers, you have ${Number(reason.actual).toLocaleString()}`;
    case "BELOW_MIN_ENGAGEMENT":
      return `Needs ${formatBps(Number(reason.required))} engagement, you have ${formatBps(Number(reason.actual))}`;
    default:
      return reason.code;
  }
}
