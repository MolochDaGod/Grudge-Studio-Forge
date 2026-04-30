import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachUser } from "./middlewares/auth";
import { describeOriginPolicy, isOriginAllowed } from "./lib/originPolicy";

const app: Express = express();

/**
 * Disable Express's default ETag generation.
 *
 * Conditional caching gives us nothing useful for this internal JSON API:
 * every list response is a few KB, changes frequently as the user edits the
 * project, and we already get most of the wire savings from gzip + keep-alive.
 * The added complexity of revalidation (`If-None-Match` round-trips, `304
 * Not Modified` responses with empty bodies, browser/proxy cache races) only
 * creates opportunities for client-side bugs in shapes consumers don't expect
 * — most notably empty-body cases sliding past `data = []` destructure
 * defaults, which only fire on `undefined`, not `null`.
 *
 * Disabling ETag at the app level is fine here because this Express instance
 * serves only `/api/*` JSON; if a future endpoint genuinely benefits from
 * conditional caching (e.g., a large static catalog), it should opt in
 * locally with explicit `Cache-Control` + `ETag` headers rather than relying
 * on the framework default.
 */
app.disable("etag");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
/**
 * CORS allow-list. Same-origin in production (the proxy serves both the
 * SPA and the API on `localhost:80`), and in development the request
 * Origin is the Replit preview iframe domain. We deliberately do NOT
 * reflect arbitrary Origins back: combined with HttpOnly auth cookies
 * and `credentials: "include"`, a reflective policy would let any
 * attacker page mount login-CSRF against `/api/auth/puter/exchange`.
 *
 * `isOriginAllowed` accepts Replit preview/deployment hosts, localhost,
 * anything explicitly listed in `REPLIT_DOMAINS` (set automatically on
 * Replit deployments), and anything in the `EXTRA_ALLOWED_ORIGINS`
 * environment escape hatch. Unknown Origins produce a CORS-rejected
 * response, which the browser surfaces as a network error rather than
 * silently letting credentials leak.
 */
logger.info({ originPolicy: describeOriginPolicy() }, "CORS allow-list active");
app.use(
  cors({
    origin: (origin, cb) => {
      // For allowed origins: reflect the Origin and emit
      // Access-Control-Allow-Credentials so cookies ride along.
      // For disallowed origins: cb(null, false) — the cors lib will
      // simply omit the Access-Control-Allow-Origin header. Browsers
      // then block the response from reaching the attacker page (which
      // is the real defense), and any state-changing auth route also
      // runs `requireTrustedOrigin` for a clean 403 server-side.
      if (isOriginAllowed(origin)) {
        cb(null, origin ?? true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve req.user from the session cookie (best-effort, never blocks).
app.use(attachUser);

app.use("/api", router);

export default app;
