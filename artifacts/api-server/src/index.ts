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

// Seed built-in scene templates into object storage *before* opening
// the listen socket. The /templates endpoints rely on the in-memory
// manifest the seeder produces — without it they'd 503 on first hit.
// Seeder failures are logged per-template and never throw, so a flaky
// storage call doesn't take the whole server down.
seedTemplates()
  .then((manifest) => {
    logger.info(
      { count: manifest.length },
      "Scene templates ready",
    );
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    // Should be unreachable — seedTemplates swallows per-template
    // failures — but if the whole call rejects (e.g. importing the
    // builders threw) we want a loud, fatal exit rather than a half-up
    // server.
    logger.fatal({ err }, "Fatal error during template seed");
    process.exit(1);
  });
