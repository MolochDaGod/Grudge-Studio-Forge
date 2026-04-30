import { pool } from "@workspace/db";
import { createHmac } from "node:crypto";
import type { PuterIdentity } from "./puterAuth";

/**
 * Reads/writes the **shared** Grudge identity tables.
 *
 * The wider Grudge ecosystem owns the schema — `users`, `accounts`,
 * `grudge_accounts`, etc. are also written by the upstream Grudge auth
 * service (see `GRUDGE_AUTH_URL`) and by sister apps. We deliberately use
 * raw `pool.query` rather than drizzle definitions so this server stays a
 * participant, not the source of truth, for those tables.
 *
 * Forge itself is intentionally session-less: Puter Auth lives entirely
 * client-side via the Puter SDK (which manages its own token storage),
 * and the Forge server only ever needs to verify the user once at sync
 * time to make sure the shared `users` row exists. There is no Forge
 * session cookie, no Forge sessions row, and no Forge link table.
 */

export interface ForgeUserView {
  /** PK of the shared `users` table (UUID). */
  userId: string;
  /** Puter UUID — the canonical client-visible "I am this person" id. */
  puterUuid: string;
  /** "Official" Grudge ID from the shared `grudge_accounts` registry,
   *  or a deterministic per-user mint when no upstream row exists. */
  grudgeId: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  /** True iff a row was found in the shared `grudge_accounts` registry —
   *  the wider Grudge ecosystem (dashboard, marketplace, etc.) recognises
   *  this user. False = this user is signed in via Puter but the upstream
   *  Grudge account hasn't been provisioned yet. Forge clients can use
   *  this flag to gate "more connected" features. */
  hasGrudgeAccount: boolean;
}

/**
 * Find or create a row in the shared `users` table for a given Puter
 * identity. We never overwrite a user's `password` or `wallet_address`
 * if they already exist (those belong to other auth methods). We DO
 * refresh the lightweight profile mirror (display name, email, avatar)
 * because Puter is the source of truth for those when the user signs
 * in via Puter.
 *
 * Concurrency: this routine runs inside a transaction guarded by a
 * Postgres advisory lock keyed on `hashtext(puter_uuid)`. We can't add
 * a UNIQUE constraint to the shared `users.puter_uuid` column (that
 * schema is owned upstream and may carry historical NULLs/duplicates),
 * so the SELECT-then-INSERT pair would otherwise race when the same
 * user opens two tabs and signs in simultaneously, producing two
 * `users` rows for one Puter identity. The advisory lock serializes
 * only on the specific puter_uuid being processed. `pg_advisory_xact_lock`
 * is automatically released at COMMIT/ROLLBACK.
 */
export async function findOrCreateUserByPuter(
  identity: PuterIdentity,
): Promise<{ userId: string; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
      [`puter:${identity.uuid}`],
    );

    const existing = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE puter_uuid = $1 LIMIT 1",
      [identity.uuid],
    );
    if (existing.rows.length > 0) {
      const id = existing.rows[0].id;
      await client.query(
        `UPDATE users
           SET email        = COALESCE($2, email),
               display_name = COALESCE($3, display_name),
               avatar_url   = COALESCE($4, avatar_url),
               last_login_at = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
         WHERE id = $1`,
        [id, identity.email, identity.username, identity.avatarUrl],
      );
      await client.query("COMMIT");
      return { userId: id, created: false };
    }

    // Username collision in the shared `users` table is possible — pick a
    // suffix that we know is unique (the Puter UUID's first 6 chars).
    const baseUsername = `puter_${identity.username}`;
    const safeUsername = `${baseUsername}_${identity.uuid.slice(0, 6)}`;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users
          (username, password, email, display_name, puter_uuid, avatar_url,
           last_login_at, linked_auth_methods)
       VALUES ($1, '', $2, $3, $4, $5,
               (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
               '["puter"]'::jsonb)
       RETURNING id`,
      [
        safeUsername,
        identity.email,
        identity.username,
        identity.uuid,
        identity.avatarUrl,
      ],
    );
    await client.query("COMMIT");
    return { userId: inserted.rows[0].id, created: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up the upstream Grudge ID for a Puter identity, if the user has
 * already been registered with the master Grudge auth service. We never
 * INSERT here — that table is owned upstream.
 */
export async function findGrudgeIdForPuter(
  puterUuid: string,
): Promise<string | null> {
  const r = await pool.query<{ grudge_id: string }>(
    "SELECT grudge_id FROM grudge_accounts WHERE puter_user_id = $1 LIMIT 1",
    [puterUuid],
  );
  return r.rows[0]?.grudge_id ?? null;
}

/**
 * Mint a stable per-user `grudge_id` for clients that have signed into
 * Forge via Puter but do not yet have a row in the shared
 * `grudge_accounts` registry. Format mirrors the existing rows:
 * `GRUDGE-<13digits>-<HEX>`. Deterministic in the seed so the surfaced
 * id is identical across sync calls and across browser tabs for the
 * same user.
 */
function mintEphemeralGrudgeId(seed: string): string {
  const secret =
    process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "forge-fallback";
  const digest = createHmac("sha256", secret)
    .update(`grudge-id:${seed}`)
    .digest();
  const span = 9_000_000_000_000n;
  const base = 1_000_000_000_000n;
  const numeric = (digest.readBigUInt64BE(0) % span) + base;
  const hex = digest.subarray(8, 12).toString("hex").toUpperCase();
  return `GRUDGE-${numeric.toString()}-${hex}`;
}

/** Resolve the full client-facing user view from the user PK alone. */
export async function loadUserView(
  userId: string,
): Promise<ForgeUserView | null> {
  const u = await pool.query<{
    id: string;
    username: string;
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
    puter_uuid: string | null;
  }>(
    `SELECT id, username, display_name, email, avatar_url, puter_uuid
       FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = u.rows[0];
  if (!row || !row.puter_uuid) return null;

  const upstreamGrudgeId = await findGrudgeIdForPuter(row.puter_uuid);
  const grudgeId =
    upstreamGrudgeId ?? mintEphemeralGrudgeId(`user:${row.id}`);

  return {
    userId: row.id,
    puterUuid: row.puter_uuid,
    grudgeId,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    hasGrudgeAccount: upstreamGrudgeId !== null,
  };
}
