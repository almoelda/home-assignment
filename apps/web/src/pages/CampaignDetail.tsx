import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { listCreatorBids } from "../api/bids.js";
import { getCampaignDetail } from "../api/campaigns.js";
import { AdvertiserBidsTable } from "../components/AdvertiserBidsTable.js";
import { BidForm } from "../components/BidForm.js";
import { CampaignResultPanel } from "../components/CampaignResultPanel.js";
import { CampaignStateBadge } from "../components/StatusBadge.js";
import { ErrorRetry } from "../components/ErrorRetry.js";
import { formatBps, formatCents, formatDate, formatEligibilityReason, tierLabel } from "../shared/format.js";
import { useIdentity } from "../state/IdentityContext.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { identity } = useIdentity();
  const campaignId = Number(id);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["campaign", campaignId, identity?.role, identity?.id],
    queryFn: () => getCampaignDetail(campaignId, identity),
    enabled: Number.isInteger(campaignId),
  });

  const creatorId = identity?.role === "creator" ? identity.id : null;
  const { data: myBids } = useQuery({
    queryKey: ["creator-bids", creatorId],
    queryFn: () => listCreatorBids(creatorId!, identity),
    enabled: creatorId !== null,
  });
  const myBidOnThisCampaign = myBids?.bids.find((b) => b.campaignId === campaignId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return <ErrorRetry message="Could not load this campaign." onRetry={() => void refetch()} />;

  const infoRows: Array<[string, string]> = [
    ["Budget", formatCents(data.budgetCents)],
    ["Deadline", formatDate(data.deadlineAt)],
    ["Platforms", data.platforms.join(", ")],
    ["Genres", data.genres.join(", ")],
    ["Minimum followers", data.minFollowers.toLocaleString()],
    ["Minimum engagement", formatBps(data.minEngagementBps)],
    ["Target CPM", `${formatCents(data.targetCpmCents)} / 1,000 views`],
    ["Max CPM", `${formatCents(data.maxCpmCents)} / 1,000 views`],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">{data.title}</h2>
        <CampaignStateBadge state={data.displayState} />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-muted-foreground">{data.brief}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {infoRows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {data.guidanceForActor && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Your price guidance — {data.tierForActor && tierLabel(data.tierForActor)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your minimum fee</dt>
                <dd className="font-medium">{formatCents(data.guidanceForActor.minFeeCents)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target payment</dt>
                <dd className="font-medium">{formatCents(data.guidanceForActor.targetPaymentCents)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Max payment</dt>
                <dd className="font-medium">{formatCents(data.guidanceForActor.maxPaymentCents)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Est. views</dt>
                <dd className="font-medium">{data.guidanceForActor.estimatedViews.toLocaleString()}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">
              ≈{data.guidanceForActor.estimatedViews.toLocaleString()} expected views × {formatCents(data.targetCpmCents)}{" "}
              CPM ÷ 1,000 = {formatCents(data.guidanceForActor.targetPaymentCents)} target payment.{" "}
              {data.activeBidCount} active {data.activeBidCount === 1 ? "bid" : "bids"} on this campaign so far.
            </p>
            {data.displayState === "open" ? (
              <BidForm
                campaignId={data.id}
                guidance={data.guidanceForActor}
                existingBidAmountCents={myBidOnThisCampaign?.amountCents}
                existingBidStatus={myBidOnThisCampaign?.status}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Bidding is closed for this campaign.</p>
            )}
          </CardContent>
        </Card>
      )}

      {data.ineligibilityReasons && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="mb-2 font-medium">You're not eligible for this campaign</p>
            <ul className="list-inside list-disc space-y-1">
              {data.ineligibilityReasons.map((r, i) => (
                <li key={i}>{formatEligibilityReason(r)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {identity?.role === "advertiser" && identity.id === data.advertiserId && (
        <div className="space-y-2">
          <h3 className="text-lg font-semibold tracking-tight">Bids</h3>
          <AdvertiserBidsTable campaignId={data.id} />
        </div>
      )}

      {data.displayState === "closed" && <CampaignResultPanel campaignId={data.id} />}
    </div>
  );
}
