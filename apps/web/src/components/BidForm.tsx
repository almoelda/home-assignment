import { classifyPricePosition, suggestedDefaultBidCents, type PriceGuidance } from "@marketplace/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { placeBid, withdrawBid } from "../api/bids.js";
import { ApiError } from "../api/client.js";
import { formatCents } from "../shared/format.js";
import { useIdentity } from "../state/IdentityContext.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const POSITION_COPY: Record<ReturnType<typeof classifyPricePosition>, string> = {
  BLOCKED_BELOW_MIN: "Below your minimum fee — this bid would be rejected.",
  BLOCKED_ABOVE_MAX: "Above the campaign's max price — this bid would be rejected.",
  AT_OR_BELOW_TARGET: "At or below the advertiser's target — competitive.",
  ABOVE_TARGET: "Above target — still allowed, but a lower chance of being selected.",
};

const POSITION_ALERT_VARIANT: Record<ReturnType<typeof classifyPricePosition>, "success" | "destructive" | "warning"> = {
  BLOCKED_BELOW_MIN: "destructive",
  BLOCKED_ABOVE_MAX: "destructive",
  AT_OR_BELOW_TARGET: "success",
  ABOVE_TARGET: "warning",
};

interface BidFormProps {
  campaignId: number;
  guidance: PriceGuidance;
  existingBidAmountCents?: number | undefined;
  existingBidStatus?: "active" | "withdrawn" | "won" | "lost" | undefined;
}

export function BidForm({ campaignId, guidance, existingBidAmountCents, existingBidStatus }: BidFormProps) {
  const { identity } = useIdentity();
  const queryClient = useQueryClient();
  const [amountEur, setAmountEur] = useState(
    String((existingBidAmountCents ?? suggestedDefaultBidCents(guidance)) / 100),
  );

  const amountCents = Math.round(Number(amountEur) * 100) || 0;
  const position = classifyPricePosition(amountCents, guidance);
  const blocked = position === "BLOCKED_BELOW_MIN" || position === "BLOCKED_ABOVE_MAX";

  const bidMutation = useMutation({
    mutationFn: () => placeBid(campaignId, amountCents, identity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["creator-bids"] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawBid(campaignId, identity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign", campaignId] });
      queryClient.invalidateQueries({ queryKey: ["creator-bids"] });
    },
  });

  if (!guidance.hasCompatiblePrice) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          No compatible price under current terms — your minimum fee exceeds the max this campaign can pay.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="bid-amount">Your bid (EUR)</Label>
        <Input
          id="bid-amount"
          type="number"
          min="0"
          step="0.01"
          value={amountEur}
          onChange={(e) => setAmountEur(e.target.value)}
        />
      </div>

      <Alert variant={POSITION_ALERT_VARIANT[position]}>
        <AlertDescription>
          {formatCents(amountCents)} — {POSITION_COPY[position]}
        </AlertDescription>
      </Alert>

      <div className="flex gap-2">
        <Button type="button" onClick={() => bidMutation.mutate()} disabled={blocked || bidMutation.isPending}>
          {existingBidStatus === "active" ? "Update bid" : "Place bid"}
        </Button>
        {existingBidStatus === "active" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => withdrawMutation.mutate()}
            disabled={withdrawMutation.isPending}
          >
            Withdraw
          </Button>
        )}
      </div>

      {bidMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {bidMutation.error instanceof ApiError ? bidMutation.error.message : "Something went wrong."}
          </AlertDescription>
        </Alert>
      )}
      {withdrawMutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {withdrawMutation.error instanceof ApiError ? withdrawMutation.error.message : "Something went wrong."}
          </AlertDescription>
        </Alert>
      )}
      {bidMutation.isSuccess && (
        <Alert variant="success">
          <AlertDescription>Bid saved.</AlertDescription>
        </Alert>
      )}
      {withdrawMutation.isSuccess && (
        <Alert variant="success">
          <AlertDescription>Bid withdrawn.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
