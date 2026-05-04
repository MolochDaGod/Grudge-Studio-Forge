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
 * Seeding mode (`--seed`, optional `--seed-rows=<N>`):
 *   By default the temp schema starts empty, so every `CREATE TABLE`
 *   succeeds and every `ALTER` lands on a zero-row table. That catches
 *   syntax / FK-target errors but NOT the most dangerous class of
 *   migration bug: a guarded `ALTER TABLE … ADD COLUMN` that conflicts
 *   with existing rows (e.g. `NOT NULL` without a default on a
 *   populated table).
 *
 *   With `--seed`, before applying STATEMENTS we discover every
 *   `public.forge_*` table that currently exists, mirror its structure
 *   into the temp schema with `CREATE TABLE … (LIKE public.<t>
 *   INCLUDING ALL)`, and copy up to N representative rows
 *   (`--seed-rows`, default 100) via
 *   `INSERT INTO "<temp>".<t> SELECT * FROM public.<t> LIMIT N`. Then
 *   `runMigrations()` runs with `search_path` set to the temp schema:
 *   the seeded `CREATE TABLE IF NOT EXISTS` no-ops on the pre-existing
 *   table, and any new `ALTER TABLE … ADD COLUMN IF NOT EXISTS` lands
 *   on a *populated* copy. A constraint that is incompatible with
 *   real production data fails on the author's branch instead of
 *   half-applying post-merge.
 *
 *   Notes on the `LIKE INCLUDING ALL` copy:
 *     - INCLUDING ALL covers indexes, defaults, identity, check
 *       constraints, primary keys, etc. It deliberately does NOT
 *       include foreign-key constraints, which is what we want: the
 *       seeded copies are detached islands, so a partial sample
 *       (LIMIT N rows from the parent table without their children)
 *       never trips an FK check during INSERT.
 *     - SERIAL/identity columns get their own sequence in the temp
 *       schema. We never call `nextval`; we only INSERT copies of
 *       existing rows with their existing IDs, so the temp sequence
 *       stays at its default and the production sequence is untouched.
 *     - `DROP SCHEMA … CASCADE` in `finally` cleans up the seeded
 *       tables, their indexes, and their owned sequences in one shot.
 *
 * Failure semantics: any error from the migration itself (DDL,
 * connection, the initial `CREATE SCHEMA`, or any `--seed` step) exits
 * non-zero. The `.replit` `migrate-dryrun` validation and the
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
import type { PoolClient } from "pg";
import { pool } from "./index.js";
import { runMigrations } from "./migrate.js";
import {
  lockKeyForSchema,
  sweepStaleDryRunSchemas,
} from "./migrate-dryrun-sweeper.js";

const DEFAULT_SEED_ROWS = 100;

interface CliOptions {
  seed: boolean;
  seedRows: number;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let seed = false;
  let seedRows = DEFAULT_SEED_ROWS;
  for (const arg of argv) {
    // pnpm forwards a bare `--` separator from `pnpm run … -- --seed`
    // through to the script, where Node leaves it in argv. Skip it so
    // the rest of the parser sees only real flags.
    if (arg === "--") {
      continue;
    }
    if (arg === "--seed") {
      seed = true;
      continue;
    }
    const seedRowsMatch = /^--seed-rows=(\d+)$/.exec(arg);
    if (seedRowsMatch) {
      seed = true;
      seedRows = Number.parseInt(seedRowsMatch[1]!, 10);
      if (!Number.isFinite(seedRows) || seedRows < 0) {
        throw new Error(
          `migrate-dryrun: --seed-rows must be a non-negative integer, got ${arg}`,
        );
      }
      continue;
    }
    throw new Error(`migrate-dryrun: unknown argument ${JSON.stringify(arg)}`);
  }
  return { seed, seedRows };
}

function makeSchemaName(): string {
  // 8 hex chars of entropy is plenty to avoid collisions between
  // concurrent dry-runs on the same DB; keep the prefix obvious so a
  // human triaging leftover schemas can spot what created them.
  const suffix = randomBytes(4).toString("hex");
  return `forge_migrate_dryrun_${process.pid}_${suffix}`;
}

/**
 * Mirror every existing `public.forge_*` table into the temp schema and
 * copy up to `rows` representative rows from each. See file header for
 * the rationale and the `LIKE INCLUDING ALL` caveats.
 *
 * Returns the number of tables seeded so the caller can log it.
 */
async function seedTempSchema(
  client: PoolClient,
  schema: string,
  rows: number,
): Promise<number> {
  // Discover what's actually in public right now. We deliberately scope
  // to the `forge_*` prefix so a dry-run never reads from the ~65
  // unrelated Grudge tables in the shared DB.
  const { rows: tables } = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name LIKE 'forge\\_%' ESCAPE '\\'
      ORDER BY table_name`,
  );

  for (const { table_name } of tables) {
    // Identifier comes from information_schema for tables we own; still
    // double-quote and reject anything that isn't a plain identifier so
    // a future rename can't smuggle in SQL.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table_name)) {
      throw new Error(
        `migrate-dryrun: refusing to seed unsafe table name ${JSON.stringify(table_name)}`,
      );
    }
    await client.query(
      `CREATE TABLE "${schema}"."${table_name}" (LIKE public."${table_name}" INCLUDING ALL)`,
    );
    if (rows > 0) {
      // Parameterized LIMIT — the table identifiers are validated above
      // and double-quoted, the only user-controllable value is the row
      // count which goes through a bind param.
      await client.query(
        `INSERT INTO "${schema}"."${table_name}" SELECT * FROM public."${table_name}" LIMIT $1`,
        [rows],
      );
    }
  }

  return tables.length;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

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
  process.stdout.write(
    `migrate-dryrun · schema=${schema} seed=${opts.seed}${
      opts.seed ? ` seed-rows=${opts.seedRows}` : ""
    }\n`,
  );

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
    if (opts.seed) {
      const seeded = await seedTempSchema(
        setupClient,
        schema,
        opts.seedRows,
      );
      process.stdout.write(
        `migrate-dryrun · seeded ${seeded} table(s) from public.forge_* (up to ${opts.seedRows} rows each)\n`,
      );
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
