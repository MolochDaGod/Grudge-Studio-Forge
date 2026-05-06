/**
 * Forge schema migration runner.
 *
 * We deliberately avoid `drizzle-kit push` here. The Forge dev/prod
 * databases are shared with the rest of the Grudge ecosystem (warlord,
 * openrts, mmo, store, etc. — ~65 tables), and `drizzle-kit push`'s
 * heuristic interprets every unrelated table that doesn't match our
 * schema as a candidate for being *renamed* into one of ours. With
 * stdin closed (post-merge), it would either hang or accept a
 * catastrophic rename, wiping data for the other apps.
 *
 * Instead we ship a flat list of `CREATE TABLE IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS` statements. They are idempotent, can
 * never drop or rename anything, and use the same `pg` pool the app
 * uses at runtime (so any connectivity / TLS / pool sizing config is
 * automatically picked up).
 *
 * Workflow when adding a column / table:
 *   1. Update the drizzle schema in `lib/db/src/schema/*.ts`.
 *   2. Append the matching `ALTER TABLE … ADD COLUMN IF NOT EXISTS` or
 *      `CREATE TABLE IF NOT EXISTS` statement below.
 *   3. Run `pnpm --filter @workspace/db run migrate` locally to verify.
 *
 * Each statement MUST be idempotent. If you need a destructive change
 * (drop column, rename), write an explicit guarded statement and call
 * it out in a comment.
 */
import { pool } from "./index.js";

const STATEMENTS: ReadonlyArray<{ name: string; sql: string }> = [
  {
    name: "forge_projects",
    sql: `
      CREATE TABLE IF NOT EXISTS forge_projects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "forge_scenes",
    sql: `
      CREATE TABLE IF NOT EXISTS forge_scenes (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES forge_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "forge_scripts",
    sql: `
      CREATE TABLE IF NOT EXISTS forge_scripts (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES forge_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'js',
        code TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "forge_assets",
    sql: `
      CREATE TABLE IF NOT EXISTS forge_assets (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES forge_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        source TEXT NOT NULL DEFAULT 'url',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "forge_prefabs",
    sql: `
      CREATE TABLE IF NOT EXISTS forge_prefabs (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES forge_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "forge_scenes_project_id_idx",
    sql: `CREATE INDEX IF NOT EXISTS forge_scenes_project_id_idx ON forge_scenes(project_id);`,
  },
  {
    name: "forge_scripts_project_id_idx",
    sql: `CREATE INDEX IF NOT EXISTS forge_scripts_project_id_idx ON forge_scripts(project_id);`,
  },
  {
    name: "forge_assets_project_id_idx",
    sql: `CREATE INDEX IF NOT EXISTS forge_assets_project_id_idx ON forge_assets(project_id);`,
  },
  {
    name: "forge_prefabs_project_id_idx",
    sql: `CREATE INDEX IF NOT EXISTS forge_prefabs_project_id_idx ON forge_prefabs(project_id);`,
  },
];

/**
 * Apply all idempotent migration statements using the shared pool.
 * Safe to call on every server boot. Does NOT close the pool — callers
 * that own the process lifetime (e.g. the CLI below) are responsible
 * for `pool.end()`.
 *
 * Stable 64-bit advisory lock key for the Forge migration runner.
 *
 * `CREATE TABLE IF NOT EXISTS` is NOT safe under concurrency in
 * Postgres: two processes that race past the existence check both try
 * to create the underlying sequence, and the loser hits a
 * `pg_class_relname_nsp_index` unique-constraint violation. That bites
 * us at boot when a workflow restart leaves the previous process
 * briefly overlapping with the new one. A session-level advisory lock
 * serializes concurrent runners cheaply (no rows, no DDL of its own).
 */
const MIGRATION_ADVISORY_LOCK_KEY = 0x46_4f_52_47_45_4d_49_47n; // "FORGEMIG"

export interface RunMigrationsOptions {
  /**
   * If set, the migration runner issues `SET search_path TO "<schema>"`
   * on its acquired session before applying any STATEMENTS. Used by the
   * pre-merge dry-run (see `migrate-dryrun-cli.ts`) to apply the same
   * SQL against an ephemeral schema in the same physical DB, so a
   * broken migration is caught on the author's branch without touching
   * the real `forge_*` tables in `public`.
   *
   * Schema name MUST be a safe identifier — the runner double-quotes it
   * but does not otherwise escape it. Callers generate it themselves.
   */
  searchPath?: string;
}

export async function runMigrations(
  log: (name: string, ok: boolean, durationMs: number) => void = () => {},
  options: RunMigrationsOptions = {},
): Promise<void> {
  const client = await pool.connect();
  try {
    if (options.searchPath !== undefined) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.searchPath)) {
        throw new Error(
          `runMigrations: unsafe searchPath identifier ${JSON.stringify(options.searchPath)}`,
        );
      }
      await client.query(`SET search_path TO "${options.searchPath}"`);
    }
    await client.query("SELECT pg_advisory_lock($1)", [
      MIGRATION_ADVISORY_LOCK_KEY.toString(),
    ]);
    try {
      for (const { name, sql } of STATEMENTS) {
        const startedAt = process.hrtime.bigint();
        try {
          await client.query(sql);
          const durationMs =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          log(name, true, durationMs);
        } catch (err) {
          const durationMs =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          log(name, false, durationMs);
          throw err;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [
        MIGRATION_ADVISORY_LOCK_KEY.toString(),
      ]);
    }
  } finally {
    client.release();
  }
}

