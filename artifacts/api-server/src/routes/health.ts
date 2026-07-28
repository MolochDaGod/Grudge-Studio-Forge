import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function ok(_req: unknown, res: { json: (b: unknown) => void }) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
}

/** Canonical liveness for Railway + CF edge probes. */
router.get("/healthz", ok);
/** Alias used by fleet dashboards (`/api/health`). Always keep in sync with healthz. */
router.get("/health", ok);
/** Extra aliases if a reverse-proxy strips or double-prefixes the /api mount. */
router.get("/api/health", ok);
router.get("/api/healthz", ok);

export default router;
