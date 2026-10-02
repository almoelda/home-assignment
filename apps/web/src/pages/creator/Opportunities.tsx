import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { listCreatorOpportunities } from "../../api/campaigns.js";
import { formatCents, formatDate, formatEligibilityReason, tierLabel } from "../../shared/format.js";
import { useIdentity } from "../../state/IdentityContext.js";
import { ErrorRetry } from "../../components/ErrorRetry.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TIER_BADGE_VARIANT = {
  1: "success",
  2: "warning",
  3: "secondary",
} as const;

export function Opportunities() {
  const { identity } = useIdentity();
  const creatorId = identity?.role === "creator" ? identity.id : null;
  const [showIneligible, setShowIneligible] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["opportunities", creatorId],
    queryFn: () => listCreatorOpportunities(creatorId!),
    enabled: creatorId !== null,
  });

  if (!creatorId) return <p className="text-muted-foreground">Switch to a creator identity to see matched campaigns.</p>;
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError || !data) return <ErrorRetry message="Could not load opportunities." onRetry={() => void refetch()} />;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">Campaigns matched to you</h2>

      {data.eligible.length === 0 ? (
        <p className="text-muted-foreground">No matching campaigns right now.</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Your min fee</TableHead>
                <TableHead>Target payment</TableHead>
                <TableHead>Max payment</TableHead>
                <TableHead>Est. views</TableHead>
                <TableHead>Active bids</TableHead>
                <TableHead>Deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.eligible.map((o) => (
                <TableRow key={o.campaignId}>
                  <TableCell>
                    <Link to={`/campaigns/${o.campaignId}`} className="font-medium text-primary hover:underline">
                      {o.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={TIER_BADGE_VARIANT[o.tier]}>{tierLabel(o.tier)}</Badge>
                  </TableCell>
                  <TableCell>{formatCents(o.guidance.minFeeCents)}</TableCell>
                  <TableCell>{formatCents(o.guidance.targetPaymentCents)}</TableCell>
                  <TableCell>{formatCents(o.guidance.maxPaymentCents)}</TableCell>
                  <TableCell>{o.guidance.estimatedViews.toLocaleString()}</TableCell>
                  <TableCell>{o.activeBidCount}</TableCell>
                  <TableCell>{formatDate(o.deadlineAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Button type="button" variant="link" className="h-auto p-0" onClick={() => setShowIneligible((v) => !v)}>
        {showIneligible ? "Hide" : "Show"} campaigns you're not eligible for ({data.ineligible?.length ?? 0})
      </Button>

      {showIneligible && (
        <ul className="space-y-3">
          {(data.ineligible ?? []).map((o) => (
            <li key={o.campaignId} className="rounded-lg border bg-muted/30 p-4">
              <p className="font-medium">{o.title}</p>
              <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                {o.reasons.map((r, i) => (
                  <li key={i}>{formatEligibilityReason(r)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
