import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { listAdvertiserCampaigns } from "../../api/campaigns.js";
import { CampaignStateBadge } from "../../components/StatusBadge.js";
import { ErrorRetry } from "../../components/ErrorRetry.js";
import { formatCents, formatDate } from "../../shared/format.js";
import { useIdentity } from "../../state/IdentityContext.js";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function MyCampaigns() {
  const { identity } = useIdentity();
  const advertiserId = identity?.role === "advertiser" ? identity.id : null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["advertiser-campaigns", advertiserId],
    queryFn: () => listAdvertiserCampaigns(advertiserId!),
    enabled: advertiserId !== null,
  });

  if (!advertiserId) return <p className="text-muted-foreground">Switch to an advertiser identity to see your campaigns.</p>;
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <ErrorRetry message="Could not load campaigns." onRetry={() => void refetch()} />;

  const campaigns = data?.campaigns ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">My Campaigns</h2>
        <Button asChild>
          <Link to="/advertiser/campaigns/new">+ Create Campaign</Link>
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-muted-foreground">No campaigns yet.</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Active bids</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link to={`/campaigns/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CampaignStateBadge state={c.displayState} />
                  </TableCell>
                  <TableCell>{formatCents(c.budgetCents)}</TableCell>
                  <TableCell>{formatDate(c.deadlineAt)}</TableCell>
                  <TableCell>{c.activeBidCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
