import { pool } from "@workspace/db";
import { mintEphemeralGrudgeId, SESSION_TTL_MS } from "./sessionCookie";
import type { PuterIdentity } from "./puterAuth";

/**
 * Reads/writes the **shared** Grudge identity tables.
 *
 * These tables (`users`, `accounts`, `grudge_accounts`, `sessions`) are
 * also written by the upstream Grudge Studio auth service (see
 * `GRUDGE_AUTH_URL`) and by sister apps in the wider ecosystem. We
 * deliberately use raw `pool.query` rather than drizzle definitions so
 * the schema stays solely managed by whoever owns the master migration
 * pipeline — this server is a participant, not the source of truth, for
 * those tables.
 *
 * For Forge-specific data we DO own (e.g., per-user editor preferences,
 * project ownership links) we add new tables in our own drizzle schema —
 * but none are needed for the auth handshake itself.
 */

export interface ForgeUserView {
  /** PK of the shared `users` table (UUID). */
  userId: string;
  /** Puter UUID — what we surface to the client as the canonical "Grudge ID"
   *  when the user has no row in `grudge_accounts` yet. */
  puterUuid: string;
  /** "Official" Grudge ID from the shared `grudge_accounts` registry,
   *  or the per-user mint we generated for this session. */
  grudgeId: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  /** True iff a row was found in the shared `grudge_accounts` registry —
   *  the wider Grudge ecosystem (dashboard, marketplace, etc.) recognises
   *  this user. False = this Forge sign-in created the local user but the
   *  upstream account hasn't been provisioned yet. */
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
 * user opens two browser tabs and clicks "Sign in" simultaneously,
 * producing two `users` rows for one Puter identity. The advisory lock
 * serializes only on the specific puter_uuid being processed, so it
 * has no effect on unrelated sign-ins. `pg_advisory_xact_lock` is
 * automatically released at COMMIT/ROLLBACK.
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

/** Resolve the full client-facing user view from the user PK alone.
 *
 *  Resolution order for the surfaced `grudgeId`:
 *    1. The upstream `grudge_accounts` row (canonical, set by the wider
 *       Grudge ecosystem).
 *    2. A previously-recorded `forge_session_links` row for this user
 *       (covers the case where the deterministic mint was generated
 *       once at sign-in time and we want to keep returning the same
 *       value across tabs/sessions).
 *    3. A fresh deterministic mint via `mintEphemeralGrudgeId(userId)`
 *       — same input always yields the same output, so even if the
 *       link row hasn't been written yet (or was deleted) the value
 *       stays stable per user.
 */
export async function loadUserView(userId: string): Promise<ForgeUserView | null> {
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
  let grudgeId: string;
  if (upstreamGrudgeId) {
    grudgeId = upstreamGrudgeId;
  } else {
    const link = await pool.query<{ grudge_id: string }>(
      `SELECT grudge_id FROM forge_session_links
        WHERE user_id = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [row.id],
    );
    grudgeId =
      link.rows[0]?.grudge_id ?? mintEphemeralGrudgeId(`user:${row.id}`);
  }

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

/**
 * Insert a row in the shared `sessions` table and return the session_id
 * that should be embedded in the cookie.
 *
 * NOTE on the `token` column: existing rows store opaque ~300-char tokens
 * (likely JWTs from the upstream auth service). Forge sessions don't have
 * an upstream JWT to store, so we put the cookie's HMAC-signature there
 * as a debug breadcrumb — it's never read on the hot path (we always
 * verify via the cookie's own signature) but lets ops scripts that grep
 * the table tell apart Forge sessions from upstream ones.
 */
export async function createSession(
  sessionId: string,
  grudgeId: string,
  cookieValue: string,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions
        (session_id, grudge_id, token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, grudgeId, cookieValue, ip, userAgent, expiresAt],
  );
}

/** Resolve a cookie session_id back to the user. Returns null when the
 *  session is unknown or expired (the latter rows are pruned lazily). */
export async function loadSessionUser(
  sessionId: string,
): Promise<ForgeUserView | null> {
  const s = await pool.query<{ grudge_id: string; expires_at: Date }>(
    `SELECT grudge_id, expires_at FROM sessions WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  );
  const row = s.rows[0];
  if (!row) return null;
  if (row.expires_at.getTime() < Date.now()) {
    // Best-effort cleanup; ignore errors so a read failure on a
    // stale session never blocks the user from re-authenticating.
    void pool
      .query("DELETE FROM sessions WHERE session_id = $1", [sessionId])
      .catch(() => undefined);
    return null;
  }

  // The fastest lookup is via the upstream `grudge_accounts.puter_user_id`,
  // but Forge-minted sessions reference an ephemeral `GRUDGE-<ms>-<HEX>`
  // grudge_id that won't appear in `grudge_accounts`. Fall back to looking
  // up the user via the ephemeral id we encoded inside the grudge_id mint
  // — but the simpler robust path is to look up by the session row's
  // associated user. We inferred the user at session-creation time, so
  // we reverse it by joining `users` ↔ `grudge_accounts` first.
  const viaGrudge = await pool.query<{ id: string }>(
    `SELECT u.id
       FROM users u
       JOIN grudge_accounts g ON g.puter_user_id = u.puter_uuid
      WHERE g.grudge_id = $1
      LIMIT 1`,
    [row.grudge_id],
  );
  if (viaGrudge.rows[0]) {
    return loadUserView(viaGrudge.rows[0].id);
  }

  // Forge-minted ephemeral id: `GRUDGE-<ms>-<HEX>` is keyed off
  // HMAC(JWT_SECRET, "grudge-id:user:<userId>"). We can't reverse the
  // HMAC, so we instead store the user_id <-> grudge_id linkage in a
  // small Forge-owned table populated at session creation time. See
  // `forge_session_links`.
  const link = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM forge_session_links WHERE grudge_id = $1 LIMIT 1`,
    [row.grudge_id],
  );
  if (link.rows[0]) {
    return loadUserView(link.rows[0].user_id);
  }
  return null;
}

/** Tear down a session row by its cookie session_id. */
export async function deleteSession(sessionId: string): Promise<void> {
  await pool.query(
    `DELETE FROM sessions WHERE session_id = $1`,
    [sessionId],
  );
}

/** Persist the (user_id ↔ ephemeral grudge_id) mapping created when a
 *  Forge session is minted for a user that has no upstream
 *  `grudge_accounts` row yet. This is the ONLY auth-related write to a
 *  Forge-owned table. */
export async function recordSessionLink(
  grudgeId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO forge_session_links (grudge_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (grudge_id) DO NOTHING`,
    [grudgeId, userId],
  );
}
