import { runMigrations } from "@workspace/db/migrate";
import app from "./app";
import { logger } from "./lib/logger";
import { seedTemplates } from "./lib/seedTemplates";

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

// Apply DB migrations and seed built-in scene templates into object
// storage *before* opening the listen socket. Migrations are idempotent
// `CREATE TABLE IF NOT EXISTS` statements — without them, every
// `/api/projects` request would 500 against an empty database. The
// /templates endpoints rely on the in-memory manifest the seeder
// produces — without it they'd 503 on first hit.
//
// We run both in parallel: they touch independent backends (Postgres
// vs R2) and the listen socket only opens once both have resolved.
// A migration failure is fatal (mirrors the existing seedTemplates
// fatal-exit on a hard reject) — booting against a half-migrated DB
// would surface as confusing per-route 500s instead.
Promise.all([
  runMigrations().then(() => {
    logger.info("DB migrations applied");
  }),
  seedTemplates().then((manifest) => {
    logger.info({ count: manifest.length }, "Scene templates ready");
  }),
])
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    // Either migrations failed (broken DB — refuse to start so route
    // handlers don't 500 on every request) or seedTemplates rejected
    // outright (e.g. importing the builders threw). Either way we want
    // a loud, fatal exit rather than a half-up server.
    logger.fatal({ err }, "Fatal error during boot");
    process.exit(1);
  });
