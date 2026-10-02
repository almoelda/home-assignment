import { createDb, type DbHandle } from "@marketplace/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://marketplace:marketplace@localhost:5432/marketplace";

describe("global error handler (F6)", () => {
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
});
