import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("accepts a minimal valid environment and applies the default poll interval", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/test" } as NodeJS.ProcessEnv);
    expect(config.DATABASE_URL).toBe("postgres://localhost/test");
    expect(config.WORKER_POLL_INTERVAL_MS).toBe(5000);
  });

  it("coerces WORKER_POLL_INTERVAL_MS from a string", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://localhost/test",
      WORKER_POLL_INTERVAL_MS: "1500",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.WORKER_POLL_INTERVAL_MS).toBe(1500);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow();
  });
});
