import { defineConfig, devices } from "@playwright/test";

// Runs against the full docker compose stack (web on :5173, api on :3000) — started
// separately, not by Playwright itself (see .github/workflows/ci.yml and README "Quick
// start"). This is deliberately an end-to-end test of the real deployed shape, not a dev
// server shortcut.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 4 * 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
