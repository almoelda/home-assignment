import { createDb, type DbHandle } from "@marketplace/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("global error handler", () => {
  let dbHandle: DbHandle;

  beforeAll(() => {
    dbHandle = createDb(DATABASE_URL);
  });

  afterAll(async () => {
    await dbHandle.close();
  });

  it("maps an unexpected thrown error to the documented INTERNAL envelope, not the raw error", async () => {
    const app = buildApp({ db: dbHandle.db });
    // A route that throws something that is deliberately NOT an ApplicationError — standing
    // in for a raw Postgres/driver error reaching a handler no route-level catch expected.
    app.get("/__test/boom", async () => {
      throw new Error("sensitive internal detail: connection string, column name, etc.");
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/__test/boom" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "INTERNAL", message: "internal error" } });
    expect(res.payload).not.toContain("sensitive internal detail");

    await app.close();
  });

  it("maps Fastify's own 4xx errors (e.g. malformed JSON body) to VALIDATION_ERROR, not INTERNAL", async () => {
    const app = buildApp({ db: dbHandle.db });
    await app.ready();

    // Fastify's body parser throws before any route handler runs — this never reaches
    // packages/application at all, so it's a genuine client mistake, not a server failure.
    const res = await app.inject({
      method: "POST",
      url: "/campaigns",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    await app.close();
  });

  it("maps an unknown route to the documented NOT_FOUND envelope, not Fastify's default 404", async () => {
    const app = buildApp({ db: dbHandle.db });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/__test/does-not-exist" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

    await app.close();
  });
});
