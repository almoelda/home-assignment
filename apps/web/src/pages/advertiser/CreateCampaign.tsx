import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { createCampaign, type Genre, type Platform } from "../../api/campaigns.js";
import { ApiError } from "../../api/client.js";
import { formatCents } from "../../shared/format.js";
import { useIdentity } from "../../state/IdentityContext.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

const ALL_PLATFORMS: Platform[] = ["tiktok", "instagram"];
const ALL_GENRES: Genre[] = ["fitness", "beauty", "gaming", "food", "travel", "tech", "fashion", "music"];

type DeadlinePreset = "2m" | "1h" | "1d" | "custom";

function presetToDeadline(preset: DeadlinePreset, customValue: string): Date | null {
  const now = Date.now();
  if (preset === "2m") return new Date(now + 2 * 60_000);
  if (preset === "1h") return new Date(now + 60 * 60_000);
  if (preset === "1d") return new Date(now + 24 * 60 * 60_000);
  if (!customValue) return null;
  return new Date(customValue);
}

// Native radio/checkbox inputs, deliberately not the Radix-based shadcn RadioGroup/Checkbox
// components: Radix renders role="radio"/"checkbox" <button>s, and the E2E test's
// `.check()` calls (apps/web/e2e/marketplace.spec.ts) must keep working exactly as before.
// `accent-primary` is Tailwind's own styling hook for native controls — modern without the risk.
const fieldInputClass = "size-4 accent-primary";

export function CreateCampaign() {
  const { identity } = useIdentity();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [budgetEur, setBudgetEur] = useState("1000");
  const [deadlinePreset, setDeadlinePreset] = useState<DeadlinePreset>("1d");
  const [customDeadline, setCustomDeadline] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>(["tiktok"]);
  const [genres, setGenres] = useState<Genre[]>(["fitness"]);
  const [minFollowers, setMinFollowers] = useState("0");
  const [minEngagementPct, setMinEngagementPct] = useState("0");
  const [targetCpmEur, setTargetCpmEur] = useState("25");
  const [maxCpmEur, setMaxCpmEur] = useState("40");

  const mutation = useMutation({
    mutationFn: async () => {
      const deadline = presetToDeadline(deadlinePreset, customDeadline);
      if (!deadline) throw new Error("Pick a deadline");
      return createCampaign(identity, {
        title,
        brief,
        budgetCents: Math.round(Number(budgetEur) * 100),
        deadlineAt: deadline.toISOString(),
        platforms,
        genres,
        minFollowers: Number(minFollowers),
        minEngagementBps: Math.round(Number(minEngagementPct) * 100),
        targetCpmCents: Math.round(Number(targetCpmEur) * 100),
        maxCpmCents: Math.round(Number(maxCpmEur) * 100),
      });
    },
    onSuccess: (campaign) => navigate(`/campaigns/${campaign.id}`),
  });

  if (identity?.role !== "advertiser") {
    return <p className="text-muted-foreground">Switch to an advertiser identity to create a campaign.</p>;
  }

  const togglePlatform = (p: Platform) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  const toggleGenre = (g: Genre) =>
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const targetCpmCents = Math.round(Number(targetCpmEur) * 100) || 0;
  const exampleViews = 40_000;
  const exampleCostCents = Math.floor((exampleViews * targetCpmCents) / 1000);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Create Campaign</h2>

      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="space-y-5"
          >
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brief">Brief</Label>
              <Textarea id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} required rows={3} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="budget">Budget (EUR)</Label>
              <Input
                id="budget"
                type="number"
                min="1"
                step="1"
                value={budgetEur}
                onChange={(e) => setBudgetEur(e.target.value)}
                required
              />
            </div>

            <Separator />

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Deadline</legend>
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["2m", "2 minutes (demo)"],
                    ["1h", "1 hour"],
                    ["1d", "1 day"],
                    ["custom", "Custom"],
                  ] as const
                ).map(([value, text]) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="deadline"
                      className={fieldInputClass}
                      checked={deadlinePreset === value}
                      onChange={() => setDeadlinePreset(value)}
                    />
                    {text}
                  </label>
                ))}
              </div>
              {deadlinePreset === "custom" && (
                <Input
                  type="datetime-local"
                  value={customDeadline}
                  onChange={(e) => setCustomDeadline(e.target.value)}
                  className="mt-2 w-fit"
                />
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Platforms</legend>
              <div className="flex gap-4">
                {ALL_PLATFORMS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm capitalize">
                    <input
                      type="checkbox"
                      className={fieldInputClass}
                      checked={platforms.includes(p)}
                      onChange={() => togglePlatform(p)}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Genres</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ALL_GENRES.map((g) => (
                  <label key={g} className="flex items-center gap-2 text-sm capitalize">
                    <input
                      type="checkbox"
                      className={fieldInputClass}
                      checked={genres.includes(g)}
                      onChange={() => toggleGenre(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </fieldset>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="minFollowers">Minimum followers</Label>
                <Input
                  id="minFollowers"
                  type="number"
                  min="0"
                  value={minFollowers}
                  onChange={(e) => setMinFollowers(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minEngagement">Minimum engagement (%)</Label>
                <Input
                  id="minEngagement"
                  type="number"
                  min="0"
                  step="0.1"
                  value={minEngagementPct}
                  onChange={(e) => setMinEngagementPct(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="targetCpm">Target CPM (EUR per 1,000 views)</Label>
                <Input
                  id="targetCpm"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={targetCpmEur}
                  onChange={(e) => setTargetCpmEur(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxCpm">Max CPM (EUR per 1,000 views)</Label>
                <Input
                  id="maxCpm"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={maxCpmEur}
                  onChange={(e) => setMaxCpmEur(e.target.value)}
                  required
                />
              </div>
            </div>

            <Card className="border-dashed bg-muted/40 shadow-none">
              <CardHeader className="p-4">
                <CardTitle className="text-sm font-normal text-muted-foreground">
                  At {exampleViews.toLocaleString()} expected views, your target CPM implies about{" "}
                  <strong className="font-semibold text-foreground">{formatCents(exampleCostCents)}</strong> per
                  creator.
                </CardTitle>
              </CardHeader>
            </Card>

            {mutation.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {mutation.error instanceof ApiError ? mutation.error.message : "Something went wrong."}
                </AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={mutation.isPending || platforms.length === 0 || genres.length === 0}>
              {mutation.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
