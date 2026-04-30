/**
 * Built-in scene templates ("example maps") REST endpoints.
 *
 *   GET /api/templates         → manifest (key, label, byteSize, entityCount, …)
 *   GET /api/templates/:key    → streams the SceneData JSON from object storage
 *
 * The download endpoint pipes from the same `ObjectStorageService.downloadObject`
 * helper the public-objects route uses, so it gets the proper
 * `Content-Length` + `Cache-Control` headers automatically — that
 * `Content-Length` is what powers the editor's determinate progress bar.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { getCachedManifest, templatesObjectKey } from "../lib/seedTemplates";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/templates", (req: Request, res: Response) => {
  const manifest = getCachedManifest();
  if (!manifest) {
    // Boot ordering bug — the seeder should have populated the cache
    // before the server started accepting connections. Return 503 so
    // clients can retry rather than caching an empty list.
    req.log.warn("Template manifest requested before seeder finished");
    res
      .status(503)
      .setHeader("Retry-After", "2")
      .json({ error: "Template manifest not ready yet — try again." });
    return;
  }
  res.json(manifest);
});

router.get("/templates/:key", async (req: Request, res: Response) => {
  const rawKey = req.params.key;
  // Express 5 types `req.params` values as `string | string[]` to allow
  // for repeated wildcard patterns; for a single named param it's
  // always a string at runtime, but we narrow defensively.
  const key = Array.isArray(rawKey) ? rawKey.join("/") : rawKey;
  // Defense-in-depth: the OpenAPI pattern already restricts this, but
  // routes can be hit outside the spec'd client. Keep the regex tight to
  // avoid traversal.
  if (!/^[a-z0-9-]+$/.test(key)) {
    res.status(400).json({ error: "Invalid template key" });
    return;
  }

  // Verify the key is one we actually seeded — prevents probing for
  // arbitrary objects via the /templates path.
  const manifest = getCachedManifest();
  if (!manifest) {
    // Distinguish "seeder hasn't finished" (503, retryable) from
    // "key isn't in the catalog" (404, definitive). Without this,
    // racing the boot would surface a misleading 404 to the editor.
    req.log.warn({ key }, "Template requested before seeder finished");
    res
      .status(503)
      .setHeader("Retry-After", "2")
      .json({ error: "Template manifest not ready yet — try again." });
    return;
  }
  const entry = manifest.find((e) => e.key === key);
  if (!entry) {
    res.status(404).json({ error: "Unknown template" });
    return;
  }

  try {
    const objectKey = templatesObjectKey(key);
    const file = await storage.searchPublicObject(objectKey);
    if (!file) {
      // Seeder claimed success but the object isn't there — most likely
      // a transient storage error during boot. Surface 503 so the
      // editor can retry instead of caching a 404.
      req.log.error({ key, objectKey }, "Seeded template missing in object storage");
      res
        .status(503)
        .setHeader("Retry-After", "5")
        .json({ error: "Template temporarily unavailable" });
      return;
    }

    const response = await storage.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, headerKey) => {
      res.setHeader(headerKey, value);
    });
    // `downloadObject` infers Cache-Control from the GCS ACL, which
    // marks our seeded objects as `private` (we never call
    // `setObjectAclPolicy` on them). Templates are versioned + immutable
    // by URL convention, so override here. Browser AND CDN caching
    // matters: a fresh tab should hit local cache instantly on reload.
    res.setHeader(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    req.log.error({ err, key }, "Error serving template");
    res.status(500).json({ error: "Failed to serve template" });
  }
});

export default router;
