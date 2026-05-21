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
 * Per-statement timing budget (`--max-statement-ms=<N>`, default
 * 30000):
 *   `runMigrations()` reports wall-clock duration for every
 *   STATEMENT it applies. The dry-run logs the duration alongside the
 *   ok/FAIL line, calls out the slowest statement, and — if any
 *   statement exceeded the budget — exits non-zero with a message
 *   naming the offenders. Pass `--max-statement-ms=0` to disable the
 *   gate entirely (timings are still logged).
 *
 *   Why this matters: at deploy time `runMigrations()` runs before the
 *   API server starts answering health probes. A single statement that
 *   rewrites every row of a populated table (the seeded copy gives us
 *   a representative sample) can easily exceed the Autoscale startup
 *   probe window, which kills the new instance before it ever serves
 *   traffic and stalls the deploy. Surfacing the slow statement
 *   pre-merge gives the author a chance to move the heavy work
 *   out-of-band (batched backfill, online schema change) before it
 *   bites production.
 *
 * External seed source (`--seed-from=<url>` or
 * `MIGRATE_DRYRUN_SEED_DATABASE_URL`):
 *   Today Grudge runs autoscale where dev and prod share one physical
 *   DB, so seeding from `public.forge_*` on `DATABASE_URL` is a faithful
 *   prod sample. The moment the project moves to a separate prod DB
 *   (read replica, logical replica, isolated cluster), that assumption
 *   silently breaks: the gate would still pass `--seed`, but the rows
 *   it copies are dev-only and a `NOT NULL` ADD COLUMN that is
 *   incompatible with real prod data sails through.
 *
 *   `--seed-from=<conn-url>` (or the matching env var) makes the
 *   guarantee explicit. When set, the CLI opens a *second* `pg.Pool`
 *   against that connection string, marks the session
 *   `default_transaction_read_only = on` so a misconfigured URL pointed
 *   at a writable DB still cannot mutate it, and uses it as the source
 *   of truth for both:
 *     - table discovery (what `forge_*` tables exist in *prod*),
 *     - column shape (introspected from `pg_catalog` so the temp table
 *       matches prod's column names / types / nullability — not dev's),
 *     - and row sampling.
 *   Rows are SELECTed from the source and re-INSERTed into the temp
 *   schema in the target DB via parameterized batches; jsonb/json
 *   values are re-serialized because the `pg` driver returns them as
 *   parsed JS values. The migration runner then applies STATEMENTS
 *   against a temp schema whose contents reflect *prod's* shape and
 *   data, regardless of how far dev has drifted.
 *
 *   `--seed-from` requires `--seed` and is mutually compatible with
 *   `--seed-rows=<N>` and `--max-statement-ms=<N>`. With it unset,
 *   behaviour is unchanged: the single-DB `LIKE INCLUDING ALL` +
 *   `INSERT … SELECT * FROM public.<t>` path runs as before. See
 *   `DEPLOYMENT.md` ("Migration dry-run gate") for the operational
 *   pattern.
 *
 * Failure semantics: any error from the migration itself (DDL,
 * connection, the initial `CREATE SCHEMA`, or any `--seed` step) exits
 * non-zero. The CI `migrate-dryrun` validation and the
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
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { pool } from "./index.js";
import { runMigrations } from "./migrate.js";
import {
  lockKeyForSchema,
  sweepStaleDryRunSchemas,
} from "./migrate-dryrun-sweeper.js";

const { Pool: PgPool } = pg;

const DEFAULT_SEED_ROWS = 100;
/**
 * Default per-statement wall-clock budget for the dry-run.
 *
 * Autoscale boots a new instance, runs `runMigrations()` before the
 * server starts listening, and only then begins answering health
 * probes. If a single migration statement (typically an `ALTER TABLE`
 * that rewrites every row) takes longer than the startup probe window,
 * the new instance is killed before it ever serves traffic and the
 * deploy stalls.
 *
 * 30s is comfortably under a typical deployment health-probe timeout
 * but big enough that small index builds against the seeded sample
 * don't false-positive. Override with `--max-statement-ms=<N>`.
 */
const DEFAULT_MAX_STATEMENT_MS = 30_000;

interface CliOptions {
  seed: boolean;
  seedRows: number;
  maxStatementMs: number;
  /**
   * Optional read-only `pg` connection string used as the source of
   * truth for both table structure and row sampling when seeding.
   * Resolved from `--seed-from=<url>` or the
   * `MIGRATE_DRYRUN_SEED_DATABASE_URL` env var. Unset → fall back to
   * the legacy single-DB `public.forge_*` path.
   */
  seedFromUrl: string | undefined;
}

function parseArgs(argv: ReadonlyArray<string>): CliOptions {
  let seed = false;
  let seedRows = DEFAULT_SEED_ROWS;
  let maxStatementMs = DEFAULT_MAX_STATEMENT_MS;
  let seedFromUrl: string | undefined =
    process.env.MIGRATE_DRYRUN_SEED_DATABASE_URL || undefined;
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
    const maxMsMatch = /^--max-statement-ms=(\d+)$/.exec(arg);
    if (maxMsMatch) {
      maxStatementMs = Number.parseInt(maxMsMatch[1]!, 10);
      if (!Number.isFinite(maxStatementMs) || maxStatementMs < 0) {
        throw new Error(
          `migrate-dryrun: --max-statement-ms must be a non-negative integer, got ${arg}`,
        );
      }
      continue;
    }
    const seedFromMatch = /^--seed-from=(.+)$/.exec(arg);
    if (seedFromMatch) {
      seed = true;
      seedFromUrl = seedFromMatch[1];
      continue;
    }
    throw new Error(`migrate-dryrun: unknown argument ${JSON.stringify(arg)}`);
  }
  if (seedFromUrl !== undefined && !seed) {
    // Defensive: parser sets `seed = true` whenever `--seed-from=` is
    // passed on the CLI, so this only triggers for the env-var-only
    // case where the operator forgot to also pass `--seed`.
    throw new Error(
      "migrate-dryrun: MIGRATE_DRYRUN_SEED_DATABASE_URL is set but --seed was not passed; refusing to silently ignore the prod sample source",
    );
  }
  return { seed, seedRows, maxStatementMs, seedFromUrl };
}

function makeSchemaName(): string {
  // 8 hex chars of entropy is plenty to avoid collisions between
  // concurrent dry-runs on the same DB; keep the prefix obvious so a
  // human triaging leftover schemas can spot what created them.
  const suffix = randomBytes(4).toString("hex");
  return `forge_migrate_dryrun_${process.pid}_${suffix}`;
}

function assertSafeIdent(kind: string, ident: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(
      `migrate-dryrun: refusing to seed unsafe ${kind} name ${JSON.stringify(ident)}`,
    );
  }
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
    assertSafeIdent("table", table_name);
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

interface SourceColumn {
  readonly name: string;
  /** `pg_catalog.format_type` output, e.g. `integer`, `text`, `jsonb`, `timestamp without time zone`, `text[]`. */
  readonly type: string;
  readonly notNull: boolean;
}

/**
 * Mirror every `public.forge_*` table from a *separate* read-only
 * source DB (`--seed-from=<url>`) into the temp schema in the target
 * DB, then copy up to `rows` representative rows per table. Used when
 * dev and prod live in different physical databases and the legacy
 * single-DB seed would otherwise sample dev-only data. See file
 * header for the full rationale.
 *
 * Returns the number of tables seeded so the caller can log it.
 */
async function seedTempSchemaFromSource(
  targetClient: PoolClient,
  sourcePool: Pool,
  schema: string,
  rows: number,
): Promise<number> {
  const sourceClient = await sourcePool.connect();
  try {
    // Belt-and-braces read-only guard. The session-level setting
    // applies to every implicit transaction we open below; even if a
    // future maintainer accidentally points `--seed-from` at a writable
    // DB, the SELECTs we issue cannot mutate it. Postgres rejects any
    // write attempt with a clear `read-only transaction` error.
    await sourceClient.query("SET default_transaction_read_only = on");

    const { rows: tables } = await sourceClient.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name LIKE 'forge\\_%' ESCAPE '\\'
        ORDER BY table_name`,
    );

    for (const { table_name } of tables) {
      assertSafeIdent("table", table_name);

      // Introspect the source's actual column shape. We deliberately
      // do NOT consult the target DB here — the whole point of this
      // mode is that the temp table reflects *prod's* shape, not
      // dev's, so a divergent column type or nullability constraint
      // gets exercised by the migration.
      const { rows: columns } = await sourceClient.query<{
        column_name: string;
        data_type: string;
        not_null: boolean;
      }>(
        `SELECT a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                a.attnotnull AS not_null
           FROM pg_catalog.pg_attribute a
           JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = $1
            AND a.attnum > 0
            AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [table_name],
      );

      if (columns.length === 0) {
        // Source table exists but has no readable columns — nothing
        // sensible to mirror. Skip rather than emit a `CREATE TABLE
        // ()` that Postgres will reject.
        continue;
      }

      const cols: SourceColumn[] = columns.map((c) => {
        assertSafeIdent("column", c.column_name);
        return {
          name: c.column_name,
          type: c.data_type,
          notNull: c.not_null,
        };
      });

      // We deliberately omit defaults, identity, indexes, primary key,
      // and foreign keys here — same posture as the `LIKE` path's
      // intentional FK exclusion. Indexes and PKs are not required for
      // the migration runner to exercise its statements; FKs would
      // trip on the partial `LIMIT N` sample. Migrations that ADD a
      // PK / index / constraint will still run against the seeded
      // rows and surface conflicts.
      const colDefs = cols
        .map(
          (c) =>
            `"${c.name}" ${c.type}${c.notNull ? " NOT NULL" : ""}`,
        )
        .join(", ");
      await targetClient.query(
        `CREATE TABLE "${schema}"."${table_name}" (${colDefs})`,
      );

      if (rows > 0) {
        const colList = cols.map((c) => `"${c.name}"`).join(", ");
        const { rows: srcRows } = await sourceClient.query<
          Record<string, unknown>
        >(
          `SELECT ${colList} FROM public."${table_name}" LIMIT $1`,
          [rows],
        );

        if (srcRows.length === 0) {
          continue;
        }

        // Re-insert one row at a time. Batch sizes are bounded by
        // `--seed-rows` (default 100) per table, so this is fine —
        // and keeping rows independent means a single bad row cannot
        // poison the batch. jsonb / json values come back from the
        // `pg` driver as already-parsed JS objects/arrays, so we
        // re-serialize them before binding; everything else
        // (numbers, strings, Date, Buffer, native arrays for
        // `text[]` etc.) round-trips through the driver as-is.
        const placeholders = cols
          .map((_, i) => `$${i + 1}`)
          .join(", ");
        const insertSql = `INSERT INTO "${schema}"."${table_name}" (${colList}) VALUES (${placeholders})`;
        for (const row of srcRows) {
          const values = cols.map((c) => {
            const v = row[c.name];
            if (v === null || v === undefined) {
              return null;
            }
            if (c.type === "jsonb" || c.type === "json") {
              return JSON.stringify(v);
            }
            return v;
          });
          await targetClient.query(insertSql, values);
        }
      }
    }

    return tables.length;
  } finally {
    sourceClient.release();
  }
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
  const seedSourceLabel = opts.seedFromUrl ? "external" : "public";
  process.stdout.write(
    `migrate-dryrun · schema=${schema} seed=${opts.seed}${
      opts.seed
        ? ` seed-rows=${opts.seedRows} seed-source=${seedSourceLabel}`
        : ""
    } max-statement-ms=${opts.maxStatementMs}\n`,
  );

  // A separate pool for the read-only prod sample source. Created up
  // front (rather than lazily inside the seed step) so a typo in the
  // connection URL surfaces before we mutate the target DB, and so
  // the `finally` always has a handle to close.
  let sourcePool: Pool | undefined;
  if (opts.seed && opts.seedFromUrl) {
    sourcePool = new PgPool({
      connectionString: opts.seedFromUrl,
      // Cap to 1 connection — we use exactly one client and this pool
      // is short-lived. Keeps us off any per-connection quota a prod
      // replica might enforce.
      max: 1,
    });
  }

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
      const seeded = sourcePool
        ? await seedTempSchemaFromSource(
            setupClient,
            sourcePool,
            schema,
            opts.seedRows,
          )
        : await seedTempSchema(setupClient, schema, opts.seedRows);
      const sourceDesc = sourcePool
        ? "external prod source (--seed-from)"
        : "public.forge_*";
      process.stdout.write(
        `migrate-dryrun · seeded ${seeded} table(s) from ${sourceDesc} (up to ${opts.seedRows} rows each)\n`,
      );
    }

    const timings: Array<{ name: string; durationMs: number }> = [];
    await runMigrations(
      (name, ok, durationMs) => {
        timings.push({ name, durationMs });
        process.stdout.write(
          `migrate-dryrun · ${name} … ${ok ? "ok" : "FAIL"} (${durationMs.toFixed(1)}ms)\n`,
        );
      },
      { searchPath: schema },
    );

    process.stdout.write("migrate-dryrun · all statements applied\n");

    // Per-statement budget enforcement.
    //
    // The dry-run runs against a seeded copy of `public.forge_*`, so a
    // statement that takes too long here is a strong signal that the
    // same statement on real production data will blow past the
    // Autoscale startup health probe and stall the deploy. Surface this
    // pre-merge so the author sees it on their branch instead of after
    // a half-applied migration in production. We always log the slowest
    // statement for visibility; we only fail when the budget is set
    // (>0) and at least one statement crossed it.
    const slowest = [...timings].sort(
      (a, b) => b.durationMs - a.durationMs,
    )[0];
    if (slowest) {
      process.stdout.write(
        `migrate-dryrun · slowest statement: ${slowest.name} (${slowest.durationMs.toFixed(1)}ms)\n`,
      );
    }
    if (opts.maxStatementMs > 0) {
      const overBudget = timings.filter(
        (t) => t.durationMs > opts.maxStatementMs,
      );
      if (overBudget.length > 0) {
        const detail = overBudget
          .map((t) => `${t.name}=${t.durationMs.toFixed(1)}ms`)
          .join(", ");
        // Throw inside the try so the existing finally still runs the
        // schema teardown, advisory unlock, client release, and pool
        // end before we exit non-zero in `main().catch(...)`.
        throw new Error(
          `migrate-dryrun: ${overBudget.length} statement(s) exceeded budget of ${opts.maxStatementMs}ms: ${detail}. ` +
            `On a populated production table, this is likely to exceed the Autoscale startup health probe and stall the deploy. ` +
            `Either rewrite the migration to do the heavy work out-of-band (e.g. backfill in batches) or raise --max-statement-ms after confirming the boot probe can absorb it.`,
        );
      }
    }
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
    if (sourcePool) {
      await sourcePool.end().catch((err) => {
        process.stderr.write(
          `migrate-dryrun · WARN: failed to close seed-from pool: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      });
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate-dryrun failed:", err);
  process.exit(1);
});
