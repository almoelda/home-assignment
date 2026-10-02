import { useQuery } from "@tanstack/react-query";
import { getCampaignResult } from "../api/results.js";
import { formatCents } from "../shared/format.js";
import { useIdentity } from "../state/IdentityContext.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export function CampaignResultPanel({ campaignId }: { campaignId: number }) {
  const { identity } = useIdentity();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["campaign-result", campaignId, identity?.id],
    queryFn: () => getCampaignResult(campaignId, identity),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError || !data) return <p className="text-sm text-destructive">Could not load results.</p>;

  const blendedCpmCents = data.estimatedViewsTotal > 0 ? (data.spendCents * 1000) / data.estimatedViewsTotal : 0;

  const stats: Array<[string, string]> = [
    ["Winners", String(data.winnersCount)],
    ["Total spend", formatCents(data.spendCents)],
    ["Total est. views", data.estimatedViewsTotal.toLocaleString()],
    ["Blended CPM", formatCents(Math.round(blendedCpmCents))],
    ["Unused budget", formatCents(data.unusedBudgetCents)],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <Separator />

        {data.winners.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Winning creators</h4>
            <ul className="space-y-1 text-sm">
              {data.winners.map((w) => (
                <li key={w.creatorId}>
                  {w.creatorDisplayName} (@{w.creatorHandle}) — {formatCents(w.amountCents)} for ~
                  {w.estimatedViews.toLocaleString()} views
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No winners were selected — either no bids were placed, or none fit the budget.
          </p>
        )}

        {data.myOutcome && (
          <Alert variant={data.myOutcome.status === "won" ? "success" : "destructive"}>
            <AlertDescription>
              Your bid of {formatCents(data.myOutcome.amountCents)}: {data.myOutcome.resultReason}
            </AlertDescription>
          </Alert>
        )}

        <details className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            How winners were picked ({data.algorithmVersion})
          </summary>
          <p className="mt-2">
            Bids are ranked by value — expected views per cent bid — highest first. The budget is
            filled by walking that ranking and taking every bid that still fits, skipping (not
            stopping at) any bid that doesn't. This is a <strong>heuristic, not a guaranteed
            optimum</strong>: it can leave more total views on the table than the single best
            possible combination would. See the README for a worked example of exactly this case.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
