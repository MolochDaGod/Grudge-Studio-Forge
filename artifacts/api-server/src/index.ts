import app from "./app";
import { logger } from "./lib/logger";
import { runForgeMigrations } from "./lib/forgeMigrations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Provision Forge-owned tables before we start accepting traffic. We
 * intentionally do not pre-warm any other shared-table state — the
 * Grudge ecosystem owns those migrations.
 */
async function start() {
  await runForgeMigrations();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
