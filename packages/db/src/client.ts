import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Creates a pooled connection. Callers (api, worker) own the lifecycle and
 * should call `close()` on shutdown. A pool, not a single client, is required
 * for the worker: concurrent closers each need their own connection to hold
 * independent row locks (IMPLEMENTATION_PLAN.md §6.3, SKIP LOCKED).
 */
export function createDb(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}
