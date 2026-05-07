/**
 * Puter integration endpoints (non-auth).
 *
 * `POST /api/puter/exchange`
 *   Body: `{ token: string }`
 *   Verifies a Puter access token by calling Puter's whoami server-to-server
 *   and returns a public-safe identity (`uuid`, `username`, `email`). The
 *   editor uses this to confirm a token is valid before stashing it; the
 *   richer `POST /api/auth/puter/sync` is what actually upserts the shared
 *   `users` row.
 *
 *   This is intentionally separate from `/auth/puter/sync` so callers that
 *   only want to validate a token (e.g. the AI provider switch, future
 *   Marketplace links) don't trigger a write to the shared identity tables.
 */
import { Router, type IRouter } from "express";
import { exchangePuterToken } from "../lib/puterServerClient";
import { PuterAuthError } from "../lib/puterAuth";

const router: IRouter = Router();

router.post("/puter/exchange", async (req, res) => {
  const body = req.body as { token?: unknown } | undefined;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) {
    res.status(400).json({ error: "token_required" });
    return;
  }
  try {
    const identity = await exchangePuterToken(token);
    res.json({ ok: true, user: identity });
  } catch (err) {
    if (err instanceof PuterAuthError) {
      req.log?.info(
        { err: err.message, status: err.status },
        "puter token exchange failed",
      );
      res.status(err.status).json({ ok: false, error: "puter_token_invalid" });
      return;
    }
    throw err;
  }
});

export default router;
