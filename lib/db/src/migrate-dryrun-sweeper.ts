/**
 * Reaper for stale `forge_migrate_dryrun_*` schemas.
 *
 * `migrate-dryrun-cli.ts` creates a uniquely-named temp schema
 * (`forge_migrate_dryrun_<pid>_<rand>`) and `DROP SCHEMA … CASCADE`s it
 * in a `finally`. That cleanup runs in 99% of cases. The 1% it doesn't
 * is when the Node process is taken out hard between the `CREATE SCHEMA`
 * and the `finally` — SIGKILL from an OOM, container eviction, the CI
 * runner being yanked, or a hung pg client that survives the implicit
 * `pool.end()` timeout. In those cases the schema is left behind in the
 * shared Grudge DB.
 *
 * The leftover schema is harmless on its own (every table inside lives
 * under the temp schema, isolated from `public.forge_*`), but they
 * accumulate over months of CI runs and clutter `\dn` output.
 *
 * `sweepStaleDryRunSchemas()` finds every `forge_migrate_dryrun_*`
 * schema and drops the ones that are not currently owned by a live
 * dry-run. "Currently owned" is detected via a Postgres advisory lock
 * keyed on the schema name (`lockKeyForSchema`): the live dry-run
 * grabs the lock for the lifetime of its session, so if the sweeper
 * can `pg_try_advisory_lock` the same key, no live owner exists and
 * the schema is safe to drop.
 *
 * Failures are downgraded to a warn — same posture as the in-line
 * `DROP SCHEMA` in the dry-run's own `finally`. The sweeper is
 * housekeeping, not a gate; a transient connection blip while reaping
 * must not block a dry-run that would otherwise pass.
 */
import type { Pool } from "pg";

export interface SweepResult {
  readonly scanned: number;
  readonly dropped: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { schema: string; error: string }[];
}

export async function sweepStaleDryRunSchemas(
  pool: Pool,
  options: { log?: (msg: string) => void } = {},
): Promise<SweepResult> {
  const log = options.log ?? (() => {});

  const client = await pool.connect();
  const dropped: string[] = [];
  const skipped: string[] = [];
  const failed: { schema: string; error: string }[] = [];
  let scanned = 0;
  try {
    const { rows } = await client.query<{ nspname: string }>(
      `SELECT nspname
         FROM pg_catalog.pg_namespace
        WHERE nspname LIKE 'forge_migrate_dryrun\\_%' ESCAPE '\\'`,
    );
    scanned = rows.length;

    for (const { nspname } of rows) {
      // A live dry-run holds an advisory lock keyed on its own schema
      // name for its whole session. If we can grab the same lock, no
      // live owner exists and the schema is orphaned. If we can't, the
      // run is still in flight and we must leave it alone.
      const lockKey = lockKeyForSchema(nspname);
      const lockRes = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [lockKey],
      );
      if (!lockRes.rows[0]?.locked) {
        skipped.push(nspname);
        log(`sweeper · skip ${nspname} (in use)`);
        continue;
      }
      try {
        await client.query(`DROP SCHEMA "${nspname}" CASCADE`);
        dropped.push(nspname);
        log(`sweeper · dropped ${nspname}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push({ schema: nspname, error: msg });
        log(`sweeper · WARN failed to drop ${nspname}: ${msg}`);
      } finally {
        await client
          .query("SELECT pg_advisory_unlock($1)", [lockKey])
          .catch(() => {
            /* best-effort */
          });
      }
    }
  } finally {
    client.release();
  }

  return { scanned, dropped, skipped, failed };
}

/**
 * Stable 64-bit advisory lock key derived from the schema name. The
 * live dry-run uses this to claim its own schema; the sweeper uses it
 * to test whether a candidate schema is still owned.
 */
export function lockKeyForSchema(schemaName: string): string {
  // FNV-1a 64-bit, returned as a signed bigint string (pg advisory
  // locks accept bigint). Deterministic and dependency-free.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < schemaName.length; i++) {
    hash ^= BigInt(schemaName.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  const signed =
    hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash;
  return signed.toString();
}
