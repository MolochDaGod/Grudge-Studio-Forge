/**
 * Navmesh blob persistence routes.
 *
 * The editor bakes Recast navmeshes client-side (see
 * `artifacts/game-forge/src/lib/navmesh.ts`) and uploads the resulting
 * `Uint8Array` here so it survives a page reload, follows the project
 * across machines, and can be lazily fetched by the agent runtime
 * without re-baking.
 *
 *   POST /navmesh/blob   body: { projectId, bytes (base64) } → { id, key, byteSize, written }
 *   GET  /navmesh/blob/:id?projectId=…                       → octet-stream
 *
 * Storage: Cloudflare R2 (same `R2StorageService` the templates and
 * AI snapshots use). Keys are namespaced by project id so one
 * project's bake can't be read by another.
 *
 * Auth: this app is currently single-tenant (localStorage pseudo-auth
 * — see `aiStorage.ts` for the same caveat). When real auth lands,
 * stitch a project-owner check at the top of both handlers; the key
 * layout already supports it without a key migration.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { createHash } from "crypto";
import { R2NotFoundError, R2StorageService } from "../lib/r2Storage";

const router: IRouter = Router();
const storage = new R2StorageService();

const SAFE_PROJECT_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_BLOB_ID = /^[a-zA-Z0-9_-]{1,64}$/;
/** Recast bakes are KB-MB. 16 MB cap is generous for a 1km² scene at
 *  the default 0.2m voxel size and stops a malicious client from
 *  parking a multi-GB blob in our bucket. */
const MAX_BLOB_BYTES = 16 * 1024 * 1024;

function r2Configured(): boolean {
  return Boolean(
    process.env.CF_ACCOUNT_ID &&
      process.env.OBJECT_STORAGE_KEY &&
      process.env.OBJECT_STORAGE_SECRET &&
      (process.env.R2_BUCKET_ASSETS || process.env.OBJECT_STORAGE_BUCKET),
  );
}

function rejectIfR2Missing(res: Response): boolean {
  if (r2Configured()) return false;
  res.status(503).json({
    error:
      "Object storage is not configured on this server (missing R2 env vars).",
  });
  return true;
}

function keyFor(projectId: string, id: string): string {
  return `navmesh/${projectId}/${id}.bin`;
}

router.post("/navmesh/blob", async (req: Request, res: Response) => {
  if (rejectIfR2Missing(res)) return;
  const body = (req.body ?? {}) as {
    projectId?: unknown;
    bytes?: unknown;
  };
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const b64 = typeof body.bytes === "string" ? body.bytes : "";
  if (!SAFE_PROJECT_ID.test(projectId)) {
    res.status(400).json({ error: "Invalid or missing projectId" });
    return;
  }
  if (!b64) {
    res.status(400).json({ error: "bytes (base64-encoded) is required" });
    return;
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    res.status(400).json({ error: "bytes must be valid base64" });
    return;
  }
  if (buf.byteLength === 0) {
    res.status(400).json({ error: "decoded bytes are empty" });
    return;
  }
  if (buf.byteLength > MAX_BLOB_BYTES) {
    res
      .status(413)
      .json({ error: `Navmesh blob exceeds ${MAX_BLOB_BYTES} byte cap` });
    return;
  }
  // Content-addressed id so re-baking the same scene short-circuits to
  // the existing R2 object (R2StorageService already does the ETag
  // dance on top of that).
  const id = createHash("sha1").update(buf).digest("hex").slice(0, 16);
  const key = keyFor(projectId, id);
  try {
    const result = await storage.ensurePublicBytes(key, buf, {
      contentType: "application/octet-stream",
      cacheTtlSec: 31_536_000,
    });
    res.json({ id, key, byteSize: result.byteSize, written: result.written });
  } catch (err) {
    req.log.error({ err, key }, "Navmesh blob write failed");
    res.status(500).json({ error: "Failed to write navmesh to storage" });
  }
});

router.get("/navmesh/blob/:id", async (req: Request, res: Response) => {
  if (rejectIfR2Missing(res)) return;
  const id = typeof req.params.id === "string" ? req.params.id : "";
  const projectId =
    typeof req.query.projectId === "string" ? req.query.projectId : "";
  if (!id || !SAFE_BLOB_ID.test(id)) {
    res.status(400).json({ error: "Invalid blob id" });
    return;
  }
  if (!SAFE_PROJECT_ID.test(projectId)) {
    res.status(400).json({ error: "Invalid or missing projectId" });
    return;
  }
  const key: string = keyFor(projectId, id);
  try {
    const obj = await storage.getPublicObjectStream(key);
    res.setHeader("Content-Type", "application/octet-stream");
    if (obj.contentLength != null) {
      res.setHeader("Content-Length", String(obj.contentLength));
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    (obj.body as Readable).pipe(res);
  } catch (err) {
    if (err instanceof R2NotFoundError) {
      res.status(404).json({ error: "Navmesh blob not found" });
      return;
    }
    req.log.error({ err, key }, "Navmesh blob read failed");
    res.status(500).json({ error: "Failed to read navmesh from storage" });
  }
});

export default router;
