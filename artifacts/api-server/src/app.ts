import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
