import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

// fileURLToPath, not `new URL(...).pathname` — .pathname is URL-encoded (spaces become
// %20), and this repo's own path contains spaces. Decoding matters, not just style.
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

console.log("Running migrations...");
await migrate(db, { migrationsFolder });
console.log("Migrations complete.");

await pool.end();
