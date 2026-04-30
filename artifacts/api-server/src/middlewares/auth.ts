import type { NextFunction, Request, RequestHandler, Response } from "express";
import { readSessionId } from "../lib/sessionCookie";
import { loadSessionUser, type ForgeUserView } from "../lib/authRepo";

// Augment Express's Request type so handlers can read `req.user` safely.
// `@types/express` exposes the canonical augmentation point under the
// `Express` global namespace; both `express` and the transitive
// `express-serve-static-core` use it for the Request shape.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `attachUser` when a valid session cookie is present. */
      user?: ForgeUserView;
    }
  }
}

/**
 * Best-effort: resolve the session cookie and attach `req.user`. Never
 * blocks the request — anonymous traffic (health checks, asset listings,
 * the editor in guest mode) must keep flowing. Endpoints that *need* a
 * user should compose `requireUser` after this.
 */
export const attachUser: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const sid = readSessionId(req);
    if (sid) {
      const user = await loadSessionUser(sid);
      if (user) req.user = user;
    }
  } catch (err) {
    // Surface as a request-scoped log line but don't fail the request.
    req.log?.warn({ err }, "auth: session lookup failed");
  }
  next();
};

/** Hard gate for endpoints that mutate per-user state. */
export const requireUser: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  next();
};
