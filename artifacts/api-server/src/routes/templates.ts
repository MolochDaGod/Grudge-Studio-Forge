/**
 * Built-in scene templates ("example maps") REST endpoints.
 *
 *   GET /api/templates         → manifest (key, label, byteSize, entityCount, …)
 *   GET /api/templates/:key    → streams the SceneData JSON from Cloudflare R2
 *
 * Storage backend: Grudge Studio's Cloudflare R2 bucket via
 * {@link R2StorageService}. The download endpoint streams the R2
 * `GetObject` body straight to the response with a forwarded
 * `Content-Length` — that header is what powers the editor's
 * determinate progress bar.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getCachedManifest, templatesObjectKey } from "../lib/seedTemplates";
import { R2NotFoundError, R2StorageService } from "../lib/r2Storage";

const router: IRouter = Router();
const storage = new R2StorageService();

router.get("/templates", (req: Request, res: Response) => {
  // The manifest is dynamic (new templates can be seeded on each boot)
  // and small. Disable browser/CDN caching so editor clients always see
  // the fresh list. Without this header, browsers heuristically cache
  // the response — which can be catastrophic if the route was ever
  // missing during earlier development (the SPA-fallback HTML response
  // gets cached as the "canonical" /api/templates payload until the
  // user hard-refreshes).
  res.setHeader("Cache-Control", "no-store");
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
    const stream = await storage.getPublicObjectStream(objectKey);

    // Set headers BEFORE piping. The editor uses Content-Length for the
    // progress bar; without it the dialog would stay indeterminate.
    res.setHeader("Content-Type", stream.contentType);
    if (stream.contentLength != null) {
      res.setHeader("Content-Length", String(stream.contentLength));
    }
    // Versioned URLs are immutable by convention. We set the same
    // Cache-Control on the R2 object during seeding, but R2 doesn't
    // always return CacheControl on GetObject — pin it here so
    // browsers + Cloudflare CDN cache aggressively regardless.
    res.setHeader(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    if (stream.etag) {
      // Quote per RFC 7232. Lets browsers do conditional requests on
      // re-visit even though we mark the response immutable (some
      // clients revalidate anyway).
      res.setHeader("ETag", `"${stream.etag}"`);
    }

    stream.body.on("error", (err) => {
      req.log.error({ err, key }, "R2 stream errored mid-pipe");
      // Headers already sent; best we can do is close the socket so
      // the client sees a truncated transfer rather than hanging.
      res.destroy(err instanceof Error ? err : new Error(String(err)));
    });
    stream.body.pipe(res);
  } catch (err) {
    if (err instanceof R2NotFoundError) {
      // Seeder claimed success but the object isn't in R2 — most
      // likely a transient storage error during boot. Surface 503 so
      // the editor can retry instead of caching a 404.
      req.log.error({ key }, "Seeded template missing in R2");
      res
        .status(503)
        .setHeader("Retry-After", "5")
        .json({ error: "Template temporarily unavailable" });
      return;
    }
    req.log.error({ err, key }, "Error serving template from R2");
    res.status(500).json({ error: "Failed to serve template" });
  }
});

export default router;
