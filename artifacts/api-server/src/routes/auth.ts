import { Router, type IRouter } from "express";
import { verifyPuterToken, PuterAuthError } from "../lib/puterAuth";
import {
  findOrCreateUserByPuter,
  findGrudgeIdForPuter,
  loadSessionUser,
  loadUserView,
  createSession,
  deleteSession,
  recordSessionLink,
} from "../lib/authRepo";
import {
  buildCookieValue,
  clearSessionCookie,
  mintEphemeralGrudgeId,
  newSessionId,
  readSessionId,
  setSessionCookie,
} from "../lib/sessionCookie";
import { requireUser } from "../middlewares/auth";
import { isOriginAllowed } from "../lib/originPolicy";
import type { Request, Response, NextFunction } from "express";

const router: IRouter = Router();

/**
 * Defense-in-depth Origin check for cookie-mutating routes.
 *
 * The CORS middleware already rejects unknown origins, but a CORS
 * misconfiguration (or a future change to the allow-list) shouldn't be
 * the only barrier between an attacker page and a forged session
 * cookie. This middleware blocks any state-changing auth request whose
 * Origin (or, failing that, Referer) we don't recognise. Same-origin
 * requests typically omit `Origin` on safe methods but include it on
 * POST in modern browsers, so requiring it here is appropriate.
 */
function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin : null;
  if (origin) {
    if (!isOriginAllowed(origin)) {
      req.log?.warn({ origin }, "auth: rejecting untrusted Origin");
      res.status(403).json({ error: "untrusted_origin" });
      return;
    }
    next();
    return;
  }
  // No Origin header. Fall back to Referer when present so we still get
  // some assurance for browser-issued POSTs that strip Origin (rare).
  const referer =
    typeof req.headers.referer === "string" ? req.headers.referer : null;
  if (referer) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
    if (refererOrigin && !isOriginAllowed(refererOrigin)) {
      req.log?.warn({ referer }, "auth: rejecting untrusted Referer");
      res.status(403).json({ error: "untrusted_origin" });
      return;
    }
  }
  // No Origin and no/trusted Referer → likely same-origin or non-browser
  // (curl, server-side caller). Allow.
  next();
}

/**
 * GET /api/auth/config
 *
 * Public, unauthenticated. Tells the client which Puter endpoint to
 * sign in against and whether the cloud-storage features are enabled
 * for this deployment. We don't expose secrets — only the flags and
 * origins the SDK needs to bootstrap.
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
 * GET /api/auth/me
 *
 * Returns the active user, or `{ user: null }` for anonymous sessions.
 * The client polls this on app boot to rehydrate the auth store.
 */
router.get("/auth/me", async (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
    return;
  }
  // attachUser middleware should have populated req.user already; this
  // fallback keeps the endpoint robust if it's ever mounted before
  // attachUser, or if attachUser silently swallowed a transient error.
  const sid = readSessionId(req);
  if (!sid) {
    res.json({ user: null });
    return;
  }
  const user = await loadSessionUser(sid);
  res.json({ user: user ?? null });
});

/**
 * POST /api/auth/puter/exchange
 *
 * Body: `{ puterAccessToken: string }`
 *
 * Trades a fresh Puter access token for a server-side session cookie.
 * We verify the token by calling Puter's whoami endpoint server-to-
 * server — the client cannot lie about its Puter identity.
 *
 * Side effects (all idempotent on retry):
 *   - Upserts a row in the shared `users` table keyed by `puter_uuid`.
 *   - Reads the upstream `grudge_accounts` registry to find the user's
 *     "official" Grudge ID. If absent, mints a deterministic ephemeral
 *     `GRUDGE-<ms>-<HEX>` id and records the mapping in
 *     `forge_session_links` (Forge-owned).
 *   - Inserts a row in the shared `sessions` table with a fresh UUID
 *     `session_id`, a ~30-day expiry, and the request's IP/User-Agent
 *     for audit.
 *   - Sets a HttpOnly, SameSite=Lax cookie carrying the signed session id.
 */
router.post("/auth/puter/exchange", requireTrustedOrigin, async (req, res) => {
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

  const upstreamGrudgeId = await findGrudgeIdForPuter(identity.uuid);
  const grudgeId =
    upstreamGrudgeId ?? mintEphemeralGrudgeId(`user:${userId}`);
  if (!upstreamGrudgeId) {
    // Persist the ephemeral mapping so subsequent cookie lookups can
    // reverse it back to the user. No-op if a row already exists.
    await recordSessionLink(grudgeId, userId);
  }

  const sessionId = newSessionId();
  const cookieValue = buildCookieValue(sessionId);
  const ip =
    typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0]?.trim() ?? null
      : req.ip ?? null;
  const ua =
    typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"].slice(0, 1024)
      : null;

  await createSession(sessionId, grudgeId, cookieValue, ip, ua);
  setSessionCookie(res, sessionId);

  const view = await loadUserView(userId);
  res.json({
    user: view,
    created,
    grudgeAccountLinked: upstreamGrudgeId !== null,
  });
});

/**
 * POST /api/auth/logout
 *
 * Tears down the session row and clears the cookie. Idempotent — calling
 * it without a session is a no-op success.
 */
router.post("/auth/logout", requireTrustedOrigin, async (req, res) => {
  const sid = readSessionId(req);
  if (sid) {
    try {
      await deleteSession(sid);
    } catch (err) {
      // Even if the row is gone, we still want to clear the cookie so
      // the user lands in a clean anonymous state.
      req.log?.warn({ err }, "auth: deleteSession failed");
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

/**
 * GET /api/auth/whoami
 *
 * Authenticated echo endpoint — useful for debugging cookie/CORS plumbing
 * during development and integrations testing.
 */
router.get("/auth/whoami", requireUser, (req, res) => {
  res.json({ user: req.user });
});

export default router;
