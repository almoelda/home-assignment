import { createDb } from "@marketplace/db";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
const app = buildApp({ db });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: "0.0.0.0", port: config.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
