import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/**
 * Global error-handling middleware.
 *
 * Acts as a safety net for any thrown error / rejected promise that escapes
 * a route handler. Express 5 forwards `async` rejections to `next` for us,
 * so route bodies don't need their own `try/catch` just to avoid bare 500s.
 *
 * Behavior:
 *   - ZodError                            → 400 + compact "Invalid request" message
 *   - Error with numeric `status`/`statusCode` in 4xx → that status + err.message
 *   - Anything else                       → 500 + generic "Internal server error"
 *
 * Logs a single structured `req.log.error({ err }, "request failed")` line.
 * If a route already responded (`res.headersSent`) or already logged before
 * calling `next(err)`, we skip duplicate logging — see the per-route
 * convention of logging then forwarding (e.g. polyhaven, grudge, ai).
 */
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Headers already sent (e.g. mid-stream failure): delegate to Express's
  // default handler so the connection is closed cleanly. Do not try to
  // write a JSON body — it would corrupt the in-flight response.
  if (res.headersSent) {
    req.log.error({ err }, "request failed after headers sent");
    return _next(err);
  }

  if (err instanceof ZodError) {
    req.log.warn({ err: { issues: err.issues } }, "request validation failed");
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const candidate = err as { status?: unknown; statusCode?: unknown; message?: unknown };
  const rawStatus =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : undefined;

  if (rawStatus !== undefined && rawStatus >= 400 && rawStatus < 500) {
    const message =
      typeof candidate.message === "string" && candidate.message.length > 0
        ? candidate.message
        : "Bad request";
    req.log.warn({ err, status: rawStatus }, "request failed");
    res.status(rawStatus).json({ error: message });
    return;
  }

  req.log.error({ err }, "request failed");
  const status = rawStatus !== undefined && rawStatus >= 500 ? rawStatus : 500;
  res.status(status).json({ error: "Internal server error" });
};

export default errorHandler;
