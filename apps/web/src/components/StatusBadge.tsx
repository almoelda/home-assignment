import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { BidStatus } from "../api/bids.js";
import type { DisplayState } from "../api/campaigns.js";

// One consistent status -> Badge variant mapping, used everywhere a status is shown
// (campaign lists, campaign detail, bid tables, My Bids) — not re-derived per page.
const CAMPAIGN_STATE: Record<DisplayState, { label: string; variant: BadgeProps["variant"] }> = {
  open: { label: "Open", variant: "success" },
  settling: { label: "Bidding ended — settling", variant: "warning" },
  closed: { label: "Closed", variant: "secondary" },
};

const BID_STATUS: Record<BidStatus, { label: string; variant: BadgeProps["variant"] }> = {
  active: { label: "Active", variant: "success" },
  won: { label: "Won", variant: "success" },
  lost: { label: "Lost", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
};

export function CampaignStateBadge({ state }: { state: DisplayState }) {
  const { label, variant } = CAMPAIGN_STATE[state];
  return <Badge variant={variant}>{label}</Badge>;
}

export function BidStatusBadge({ status }: { status: BidStatus }) {
  const { label, variant } = BID_STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}
