import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Idempotent startup migrations for **Forge-owned** tables only.
 *
 * The Postgres database is shared with the wider Grudge ecosystem (the
 * upstream auth service at `GRUDGE_AUTH_URL`, the dashboard, marketplace,
 * etc.). Those owners run their own migrations against `users`,
 * `accounts`, `grudge_accounts`, `sessions`, and so on — Forge must never
 * touch those.
 *
 * For tables Forge alone needs, we create them on boot with `IF NOT
 * EXISTS` instead of going through drizzle-kit's reconciliation pipeline.
 * That pipeline compares our local schema to the entire DB and offers to
 * mutate (rename / drop) any tables it doesn't know about — exactly the
 * behaviour we must avoid in a shared DB.
 *
 * Conventions for Forge-owned tables:
 *   - Prefixed `forge_` so they're trivially greppable.
 *   - Reference shared tables with their existing column types.
 *     `users.id` is `varchar(uuid)` so FKs use `varchar`.
 *   - All FKs use `ON DELETE CASCADE` so user deletion (managed upstream)
 *     cleanly tidies our rows.
 */

const STATEMENTS: readonly string[] = [
  // Maps an ephemeral session-issued grudge_id (the `GRUDGE-<ms>-<HEX>`
  // string we mint when the user has no row in the upstream
  // `grudge_accounts` table yet) back to the shared `users.id` so we
  // can resolve the cookie → user on subsequent requests without
  // having to keep a server-side cache.
  `CREATE TABLE IF NOT EXISTS forge_session_links (
     grudge_id   text PRIMARY KEY,
     user_id     varchar NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT forge_session_links_user_fk
       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   )`,

  `CREATE INDEX IF NOT EXISTS forge_session_links_user_idx
     ON forge_session_links(user_id)`,
];

let ranOnce = false;

export async function runForgeMigrations(): Promise<void> {
  if (ranOnce) return;
  ranOnce = true;
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
    } catch (err) {
      // We log + rethrow: a failure here means subsequent auth requests
      // will reject the cookie (since we can't resolve the user), so the
      // server should not silently start up in a broken state. The
      // logger captures stack traces for diagnostics.
      logger.error(
        { err, sql: sql.slice(0, 80) },
        "forge migration failed",
      );
      throw err;
    }
  }
  logger.info({ count: STATEMENTS.length }, "forge migrations applied");
}
