/**
 * Pre-merge migration dry-run.
 *
 * Applies the same `STATEMENTS` list `runMigrations()` ships at boot —
 * but against an ephemeral schema in the *same* physical Grudge DB,
 * so a malformed `CREATE TABLE` / guarded `ALTER TABLE` / bad index is
 * caught on the author's branch with the same UX as the typecheck and
 * test gates, instead of half-applying against `public` post-merge.
 *
 * Why a temp schema instead of a temp database:
 *   - Creating a database requires CREATEDB on the role; the shared
 *     Grudge role does not have it. Schemas only need USAGE/CREATE on
 *     the current DB, which the app role already has at runtime.
 *   - All STATEMENTS reference unqualified relation names
 *     (`forge_projects`, `REFERENCES forge_projects(id)`, …), so they
 *     resolve via `search_path`. Pointing the session at a fresh empty
 *     schema means `CREATE TABLE IF NOT EXISTS` actually creates
 *     (rather than no-oping against the real `public.forge_projects`),
 *     and FK targets resolve within the same temp schema.
 *   - `DROP SCHEMA … CASCADE` in `finally` cleans up tables, indexes,
 *     sequences, and FK constraints in one shot — even if the run
 *     crashed mid-statement.
 *
 * Failure semantics: any error from the migration itself (DDL,
 * connection, or the initial `CREATE SCHEMA`) exits non-zero. The
 * `.replit` `migrate-dryrun` validation and the
 * `scripts/post-merge.sh` enforcement layer both rely on the exit code.
 *
 * Cleanup (`DROP SCHEMA … CASCADE`) failures are intentionally
 * downgraded to a stderr WARN and do NOT change the exit code — the
 * gate exists to catch broken migrations, not to flake on a transient
 * connection blip during teardown after the migration already
 * succeeded. Leftover `forge_migrate_dryrun_*` schemas are harmless
 * (tables are isolated from `public.forge_*`), but they accumulate;
 * grep for `migrate-dryrun · WARN: failed to drop temp schema` in the
 * validation / post-merge logs to spot them, and drop manually with
 * `DROP SCHEMA "<name>" CASCADE` against the shared DB.
 */
import { randomBytes } from "node:crypto";
import { pool } from "./index.js";
import { runMigrations } from "./migrate.js";

function makeSchemaName(): string {
  // 8 hex chars of entropy is plenty to avoid collisions between
  // concurrent dry-runs on the same DB; keep the prefix obvious so a
  // human triaging leftover schemas can spot what created them.
  const suffix = randomBytes(4).toString("hex");
  return `forge_migrate_dryrun_${process.pid}_${suffix}`;
}

async function main(): Promise<void> {
  const schema = makeSchemaName();
  process.stdout.write(`migrate-dryrun · schema=${schema}\n`);

  // Provision + tear down on a dedicated client so the temp schema's
  // lifetime is independent of whichever pool client `runMigrations`
  // happens to grab.
  const setupClient = await pool.connect();
  let schemaCreated = false;
  try {
    try {
      await setupClient.query(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
    } finally {
      setupClient.release();
    }

    await runMigrations(
      (name, ok) => {
        process.stdout.write(
          `migrate-dryrun · ${name} … ${ok ? "ok" : "FAIL"}\n`,
        );
      },
      { searchPath: schema },
    );

    process.stdout.write("migrate-dryrun · all statements applied\n");
  } finally {
    if (schemaCreated) {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query(`DROP SCHEMA "${schema}" CASCADE`);
      } catch (err) {
        // Surface but do not mask an earlier failure.
        process.stderr.write(
          `migrate-dryrun · WARN: failed to drop temp schema ${schema}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      } finally {
        cleanupClient.release();
      }
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate-dryrun failed:", err);
  process.exit(1);
});
