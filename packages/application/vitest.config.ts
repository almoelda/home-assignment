import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 20_000,
    testTimeout: 20_000,
    // These are integration tests against one real, shared Postgres instance (CLAUDE.md:
    // "integration against a real Postgres, not mocks") — not isolated per file. In
    // particular, closing.test.ts and closing-race.test.ts each assume they're the only
    // source of "due" campaigns at a given moment (closeNextDueCampaign claims whatever is
    // next-due globally, not a specific campaign). Running test files in parallel breaks
    // that assumption and produces cross-file flakiness, not a product bug — so files run
    // sequentially here, trading test-suite speed for correctness against shared state.
    fileParallelism: false,
  },
});
