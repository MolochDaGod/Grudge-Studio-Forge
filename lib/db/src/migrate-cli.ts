/**
 * CLI entry point for `pnpm --filter @workspace/db run migrate`.
 *
 * Lives in a separate file from `migrate.ts` on purpose: the runtime
 * migration runner is bundled into the API server (so it can run on
 * boot), and we must not let the CLI's `pool.end()` execute as a side
 * effect of that bundle starting up. Keeping the CLI in its own
 * module guarantees the server bundle never reaches this code.
 */
import { pool } from "./index.js";
import { runMigrations } from "./migrate.js";

async function main(): Promise<void> {
  try {
    await runMigrations((name, ok) => {
      process.stdout.write(`migrate · ${name} … ${ok ? "ok" : "FAIL"}\n`);
    });
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate failed:", err);
  process.exit(1);
});
