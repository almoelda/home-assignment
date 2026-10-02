import { createDb, type DbHandle } from "@marketplace/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

// Integration tests against a real Postgres (CLAUDE.md: "Vitest unit + integration against a
// real Postgres, not mocks"). Requires DATABASE_URL to point at a migrated + seeded database;
// CI provides this via a Postgres service container (see .github/workflows/ci.yml).
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("api routes (slice 1: read-only)", () => {
  let dbHandle: DbHandle;
  let app: FastifyInstance;

  beforeAll(() => {
    dbHandle = createDb(DATABASE_URL);
    app = buildApp({ db: dbHandle.db });
  });

  afterAll(async () => {
    await app.close();
    await dbHandle.close();
  });

  it("GET /health responds without touching the database", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready confirms the database is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /identities lists seeded advertisers and creators", async () => {
    const res = await app.inject({ method: "GET", url: "/identities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { advertisers: unknown[]; creators: unknown[] };
    expect(Array.isArray(body.advertisers)).toBe(true);
    expect(Array.isArray(body.creators)).toBe(true);
    expect(body.advertisers.length).toBeGreaterThan(0);
    expect(body.creators.length).toBeGreaterThan(0);
  });
});
