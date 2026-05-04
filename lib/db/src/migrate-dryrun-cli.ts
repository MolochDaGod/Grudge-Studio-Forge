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
 * succeeded.
 *
 * Crash-safety / leftover sweeper: if the Node process is taken out
 * hard (SIGKILL, container eviction, OOM) between `CREATE SCHEMA` and
 * the `finally`, the temp schema is left behind. To keep the shared DB
 * tidy without risking a live concurrent run, this CLI runs
 * `sweepStaleDryRunSchemas()` *before* creating its own schema. The
 * sweeper drops every `forge_migrate_dryrun_*` schema whose advisory
 * lock it can acquire — the live run below holds that lock for the
 * lifetime of its session, so a parallel in-flight dry-run on another
 * runner is never reaped. See `migrate-dryrun-sweeper.ts`.
 */
import { randomBytes } from "node:crypto";
import { pool } from "./index.js";
import { runMigrations } from "./migrate.js";
import {
  lockKeyForSchema,
  sweepStaleDryRunSchemas,
} from "./migrate-dryrun-sweeper.js";

function makeSchemaName(): string {
  // 8 hex chars of entropy is plenty to avoid collisions between
  // concurrent dry-runs on the same DB; keep the prefix obvious so a
  // human triaging leftover schemas can spot what created them.
  const suffix = randomBytes(4).toString("hex");
  return `forge_migrate_dryrun_${process.pid}_${suffix}`;
}

async function main(): Promise<void> {
  // Reap any orphaned schemas left behind by previously crashed runs
  // before claiming our own. Best-effort: a sweeper failure must not
  // mask a real migration regression, so log and continue.
  try {
    const result = await sweepStaleDryRunSchemas(pool, {
      log: (msg) => process.stdout.write(`migrate-dryrun · ${msg}\n`),
    });
    process.stdout.write(
      `migrate-dryrun · sweeper scanned=${result.scanned} dropped=${result.dropped.length} skipped=${result.skipped.length} failed=${result.failed.length}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `migrate-dryrun · WARN: sweeper failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  const schema = makeSchemaName();
  process.stdout.write(`migrate-dryrun · schema=${schema}\n`);

  // Provision + tear down on a dedicated client so the temp schema's
  // lifetime is independent of whichever pool client `runMigrations`
  // happens to grab. The same client also holds the advisory lock that
  // tells a parallel sweeper "this schema is in use" — session-scoped
  // advisory locks are released automatically when the connection
  // closes, which is exactly what we want even on a hard crash.
  const setupClient = await pool.connect();
  let schemaCreated = false;
  let lockHeld = false;
  const lockKey = lockKeyForSchema(schema);
  try {
    await setupClient.query("SELECT pg_advisory_lock($1)", [lockKey]);
    lockHeld = true;
    await setupClient.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;

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
      try {
        await setupClient.query(`DROP SCHEMA "${schema}" CASCADE`);
      } catch (err) {
        process.stderr.write(
          `migrate-dryrun · WARN: failed to drop temp schema ${schema}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }
    if (lockHeld) {
      await setupClient
        .query("SELECT pg_advisory_unlock($1)", [lockKey])
        .catch(() => {
          /* best-effort; closing the client below also releases it */
        });
    }
    setupClient.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate-dryrun failed:", err);
  process.exit(1);
});
