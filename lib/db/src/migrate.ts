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

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const { name, sql } of STATEMENTS) {
      process.stdout.write(`migrate · ${name} … `);
      await client.query(sql);
      process.stdout.write("ok\n");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate failed:", err);
  process.exit(1);
});
