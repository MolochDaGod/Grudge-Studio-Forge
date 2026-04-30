import { Router, type IRouter } from "express";
import { verifyPuterToken, PuterAuthError } from "../lib/puterAuth";
import {
  findOrCreateUserByPuter,
  loadUserView,
} from "../lib/authRepo";

const router: IRouter = Router();

/**
 * GET /api/auth/config
 *
 * Public, unauthenticated. Tells the client which Puter endpoint to
 * sign in against, whether cloud-storage features are enabled for this
 * deployment, and the URL of the wider Grudge dashboard. We don't
 * expose any secrets — only the flags and origins the SDK needs to
 * bootstrap.
 */
router.get("/auth/config", (_req, res) => {
  res.json({
    puterSiteOrigin: process.env.PUTER_SITE_ORIGIN ?? "https://puter.com",
    puterBasePath: process.env.PUTER_BASE_PATH ?? "/grudge-gameforge",
    enablePuterCloud: process.env.ENABLE_PUTER_CLOUD === "true",
    grudgeAuthUrl: process.env.GRUDGE_AUTH_URL ?? null,
  });
});

/**
 * POST /api/auth/puter/sync
 *
 * Body: `{ puterAccessToken: string }`
 *
 * Forge is intentionally session-less on the server: Puter Auth manages
 * its own token lifecycle entirely client-side. The only thing the
 * server needs to do when a user signs in (or returns to the editor with
 * an existing Puter session) is make sure the shared `users` table has a
 * row for that Puter identity, so the rest of the Grudge ecosystem can
 * see the user. This endpoint is the entry point for that one-time
 * mirror.
 *
 * Behaviour (idempotent — safe to call on every page load):
 *   1. Verifies the Puter access token by calling Puter's whoami
 *      endpoint server-to-server. The server NEVER trusts a client's
 *      claimed identity — even a malicious client cannot pollute the
 *      shared `users` table with a forged Puter UUID.
 *   2. Upserts a row in the shared `users` table keyed on `puter_uuid`,
 *      refreshing the lightweight profile mirror (display_name, email,
 *      avatar_url) under an advisory lock so concurrent syncs cannot
 *      duplicate.
 *   3. Looks up the user's "official" Grudge ID in the shared
 *      `grudge_accounts` registry (read-only — that table is owned
 *      upstream). When absent, returns a deterministic per-user
 *      ephemeral id so the editor can still show *something*.
 *   4. Returns the resolved user view. The client stashes this in its
 *      Zustand store; there is no cookie, no session row, no follow-up
 *      `/auth/me`.
 */
router.post("/auth/puter/sync", async (req, res) => {
  const body = req.body as { puterAccessToken?: unknown } | undefined;
  const token =
    typeof body?.puterAccessToken === "string" ? body.puterAccessToken : "";
  if (!token) {
    res.status(400).json({ error: "puter_access_token_required" });
    return;
  }

  let identity;
  try {
    identity = await verifyPuterToken(token);
  } catch (err) {
    if (err instanceof PuterAuthError) {
      req.log?.info(
        { err: err.message, status: err.status },
        "puter token verification failed",
      );
      res.status(err.status).json({ error: "puter_token_invalid" });
      return;
    }
    throw err;
  }

  const { userId, created } = await findOrCreateUserByPuter(identity);
  const view = await loadUserView(userId);
  if (!view) {
    // Should be unreachable: we just upserted this row.
    req.log?.error({ userId }, "auth: loadUserView returned null after upsert");
    res.status(500).json({ error: "user_view_unavailable" });
    return;
  }

  res.json({
    user: view,
    created,
    grudgeAccountLinked: view.hasGrudgeAccount,
  });
});

export default router;
