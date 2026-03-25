import pkg from "../package.json";

if (process.argv.includes("--version")) {
  console.log(pkg.version);
  process.exit(0);
}

import config from "./config.js";
import logger from "./utils/logger.js";
import { runMigrations } from "./db/migrations.js";
import { closeDb } from "./db/connection.js";
import { startBot } from "./bot/client.js";
import { registerAll } from "./bot/dispatcher.js";
import { mkdirSync } from "node:fs";

async function main() {
  logger.info("Starting WCoder...");

  mkdirSync(config.paths.repos, { recursive: true });
  mkdirSync(config.paths.tmp, { recursive: true });

  runMigrations();
  registerAll();
  await startBot();

  logger.info("WCoder is ready");
}

function shutdown(signal) {
  logger.info({ signal }, "Shutting down...");
  closeDb();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  logger.fatal({ err }, "Failed to start WCoder");
  process.exit(1);
});
