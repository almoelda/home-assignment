import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { listCreatorBids } from "../../api/bids.js";
import { BidStatusBadge, CampaignStateBadge } from "../../components/StatusBadge.js";
import { ErrorRetry } from "../../components/ErrorRetry.js";
import { formatCents } from "../../shared/format.js";
import { useIdentity } from "../../state/IdentityContext.js";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function MyBids() {
  const { identity } = useIdentity();
  const creatorId = identity?.role === "creator" ? identity.id : null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["creator-bids", creatorId],
    queryFn: () => listCreatorBids(creatorId!, identity),
    enabled: creatorId !== null,
  });

  if (!creatorId) return <p className="text-muted-foreground">Switch to a creator identity to see your bids.</p>;
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError || !data) return <ErrorRetry message="Could not load your bids." onRetry={() => void refetch()} />;

  if (data.bids.length === 0) return <p className="text-muted-foreground">You haven't placed any bids yet.</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold tracking-tight">My Bids</h2>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Effective CPM</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Campaign state</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.bids.map((b) => (
              <TableRow key={b.bidId}>
                <TableCell>
                  <Link to={`/campaigns/${b.campaignId}`} className="font-medium text-primary hover:underline">
                    {b.campaignTitle}
                  </Link>
                </TableCell>
                <TableCell>{formatCents(b.amountCents)}</TableCell>
                <TableCell>{formatCents(b.effectiveCpmCents)}</TableCell>
                <TableCell>
                  <BidStatusBadge status={b.status} />
                </TableCell>
                <TableCell>
                  <CampaignStateBadge state={b.campaignDisplayState} />
                </TableCell>
                <TableCell className="max-w-xs text-sm text-muted-foreground">{b.resultReason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
