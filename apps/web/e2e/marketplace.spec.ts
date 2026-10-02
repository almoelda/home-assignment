import { expect, test, type Page } from "@playwright/test";

/**
 * The grader's path (IMPLEMENTATION_PLAN.md §10): an advertiser creates a campaign with a
 * short deadline, two creators bid, the worker closes it automatically, and both sides see
 * correct results and reasons — entirely through the UI, no database access.
 *
 * Runs against seeded demo data (packages/db/src/seed.ts): advertiser "Nova Sports
 * Nutrition", creators "Marta Fit" (@fit_marta, tiktok/fitness, 42,000 median views, €250
 * minimum fee) and "Jonas Gains" (@fit_jonas, instagram/fitness, 15,000 median views, €120
 * minimum fee).
 *
 * Numbers are chosen so the budget genuinely binds: budget €300, Marta bids €280 (ratio
 * 42000/28000 = 1.5), Jonas bids €120 (ratio 15000/12000 = 1.25). Combined (€400) exceeds the
 * €300 budget, so by value-density ranking Marta wins and Jonas loses on budget — a real,
 * demonstrable "won" + "lost" pair, not a contrived always-both-win case.
 *
 * This test waits on REAL wall-clock time for the campaign's 2-minute deadline to pass and
 * the worker to pick it up (poll interval up to 5s) — that wait is the point, not a flaky
 * sleep to work around: it proves the scheduled job closes campaigns on its own, unprompted.
 */

async function actAs(page: Page, label: string) {
  // The identity switcher is shadcn/ui's Select (Radix UI), not a native <select> — it opens
  // a listbox rather than supporting selectOption(). See DECISIONS.md "UI redesign".
  await page.getByRole("combobox", { name: "Acting as:" }).click();
  await page.getByRole("option", { name: label }).click();
}

test("full loop: create campaign, two creators bid, worker closes it, both sides see results", async ({ page }) => {
  await page.goto("/");

  // --- Advertiser creates the campaign ---
  await actAs(page, "Nova Sports Nutrition");
  await page.getByRole("link", { name: "+ Create Campaign" }).click();

  await page.getByLabel("Title").fill("E2E Test Campaign");
  await page.getByLabel("Brief").fill("End-to-end test campaign.");
  await page.getByLabel("Budget (EUR)").fill("300");
  await page.getByLabel("2 minutes (demo)").check();
  await page.getByLabel("instagram", { exact: true }).check(); // Jonas is instagram-only

  await page.getByRole("button", { name: "Create Campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/\d+$/);
  const campaignUrl = page.url();

  // --- Marta bids €280 (will win) ---
  await actAs(page, "Marta Fit (@fit_marta · tiktok · fitness)");
  await page.goto(campaignUrl);
  await page.getByLabel("Your bid (EUR)").fill("280");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByText("Bid saved.")).toBeVisible();

  // --- Jonas bids €120 (will lose: 280 + 120 > 300 budget, and his value ratio is lower) ---
  await actAs(page, "Jonas Gains (@fit_jonas · instagram · fitness)");
  await page.goto(campaignUrl);
  await page.getByLabel("Your bid (EUR)").fill("120");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByText("Bid saved.")).toBeVisible();

  // --- Wait for the deadline to pass and the worker to close it ---
  const deadline = Date.now() + 3 * 60_000;
  let closed = false;
  while (Date.now() < deadline && !closed) {
    await page.goto(campaignUrl);
    closed = await page
      .getByText("Closed", { exact: true })
      .isVisible()
      .catch(() => false);
    if (!closed) await page.waitForTimeout(5_000);
  }
  expect(closed, "campaign should have closed within 3 minutes").toBe(true);

  // --- Advertiser sees the winner and aggregate results ---
  await actAs(page, "Nova Sports Nutrition");
  await page.goto(campaignUrl);
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  // Scoped to the winners <li> specifically — the bid table (now shown post-close too, so the
  // advertiser can see losers and reasons, not just winners; see DECISIONS.md "F19") also
  // renders this creator's name in a <td>, so a bare getByText match is ambiguous.
  await expect(page.getByRole("listitem").filter({ hasText: "Marta Fit (@fit_marta)" })).toBeVisible();

  // --- Marta (winner) sees her own outcome ---
  await actAs(page, "Marta Fit (@fit_marta · tiktok · fitness)");
  await page.goto(campaignUrl);
  await expect(page.getByText(/Your bid of/)).toContainText("Selected");

  // --- Jonas (loser) sees his own reason, not Marta's details ---
  await actAs(page, "Jonas Gains (@fit_jonas · instagram · fitness)");
  await page.goto(campaignUrl);
  await expect(page.getByText(/Your bid of/)).toContainText("Insufficient remaining budget");
});
