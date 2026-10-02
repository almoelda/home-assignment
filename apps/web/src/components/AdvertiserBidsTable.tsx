import { useQuery } from "@tanstack/react-query";
import { listCampaignBids } from "../api/bids.js";
import { formatCents } from "../shared/format.js";
import { useIdentity } from "../state/IdentityContext.js";
import { BidStatusBadge } from "./StatusBadge.js";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AdvertiserBidsTable({ campaignId }: { campaignId: number }) {
  const { identity } = useIdentity();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaign-bids", campaignId, identity?.id],
    queryFn: () => listCampaignBids(campaignId, identity),
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError || !data) return <p className="text-sm text-destructive">Could not load bids.</p>;

  if (data.bids.length === 0) return <p className="text-sm text-muted-foreground">No bids yet.</p>;

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Creator</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Est. views</TableHead>
            <TableHead>Effective CPM</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.bids.map((b) => (
            <TableRow key={b.bidId}>
              <TableCell>{b.valueRank}</TableCell>
              <TableCell>
                {b.creatorDisplayName} (@{b.creatorHandle})
              </TableCell>
              <TableCell>{formatCents(b.amountCents)}</TableCell>
              <TableCell>{b.estimatedViews.toLocaleString()}</TableCell>
              <TableCell>{formatCents(b.effectiveCpmCents)}</TableCell>
              <TableCell>
                <BidStatusBadge status={b.status} />
              </TableCell>
              <TableCell className="max-w-xs text-sm text-muted-foreground">{b.resultReason ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
