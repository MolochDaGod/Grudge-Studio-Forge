/**
 * AI Worker storage routes.
 *
 * Three endpoints the in-browser AI Worker calls so its tools can:
 *   1. Persist the current scene as a sharable JSON snapshot in R2
 *      (`POST /ai-storage/scene-snapshot`).
 *   2. Pull a remote asset (image, GLB, audio, …) into the project's
 *      private R2 namespace and hand back a URL the editor can drop
 *      straight into `add_model_entity` / `set_environment.skyTexture`
 *      (`POST /ai-storage/import-asset`).
 *   3. List everything the AI has previously stashed for the current
 *      project so it can recall + reuse on later turns
 *      (`GET /ai-storage/list/:projectId`).
 *
 * All three are deliberately *project-scoped* — keys are namespaced by
 * `<projectId>` so one user's AI session can't list / overwrite another
 * user's saved snapshots.
 *
 * Storage backend: the same Cloudflare R2 bucket the templates seeder
 * already uses (`R2StorageService`). We surface a stable public URL by
 * proxying through this server (`GET /api/ai-storage/object/<key>`),
 * which keeps cache-control and CORS in our hands and means the route
 * works whether or not `OBJECT_STORAGE_PUBLIC_URL` is configured.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { createHash } from "crypto";
import { R2NotFoundError, R2StorageService } from "../lib/r2Storage";

const router: IRouter = Router();
const storage = new R2StorageService();

/** Hard cap so a hostile / runaway AI can't paste a 4GB GLB URL and
 *  bill us for the bandwidth. 25 MB covers every plausible game asset
 *  (large GLBs, 4k PBR textures, multi-second audio loops). */
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** Project ids are short slugs from the editor (`p_xxxxxxx` etc.).
 *  Lock them to safe S3 path characters so no caller can escape their
 *  namespace via `..` or absolute paths.
 *
 *  AUTHZ NOTE: like the rest of this app's API surface (`/api/projects`,
 *  `/api/scripts`, `/api/scenes`), these routes trust the client-supplied
 *  `projectId`. The whole app is currently single-tenant
 *  localStorage-pseudo-auth — there is no per-user session a server-side
 *  ownership check could attach to. When real auth lands (Clerk / Replit
 *  Auth), add a `project_owner_id` join here and reject mismatches; the
 *  per-prefix key layout already supports that without a key migration. */
const SAFE_PROJECT_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** 30s per-import timeout. Pairs with the transfer-time byte cap below
 *  so a slow-loris upstream can't pin a request indefinitely. */
const IMPORT_TIMEOUT_MS = 30_000;

/** Slugify arbitrary user/AI-supplied strings into key-safe segments. */
function slug(s: string, max = 48): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "untitled"
  );
}

/** Map a content-type to a safe file extension. We keep the allowlist
 *  short — every entry is something the editor's loaders can actually
 *  consume. Unknown types fall back to `.bin` so storage still works
 *  but the editor knows it's opaque. */
const EXT_BY_CT: Record<string, string> = {
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/ktx2": "ktx2",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/json": "json",
  "text/plain": "txt",
};

function extForContentType(ct: string): string {
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXT_BY_CT[base] ?? "bin";
}

/** Best-effort SSRF check on a URL string (pre-DNS).
 *
 *  We block:
 *   - non-http(s) schemes
 *   - obvious loopback / link-local / RFC1918 / cloud-metadata literals
 *   - reserved local TLDs
 *   - bare IPv6 link-local / unique-local prefixes
 *
 *  This is **defence in depth** stacked on top of `redirect: "error"`
 *  and a strict transfer-time byte cap. It is NOT a substitute for a
 *  real outbound network policy — a hostname that resolves to an
 *  internal IP at fetch time will still slip through. For the AI
 *  Worker's threat model (Anthropic-driven URLs from the public web)
 *  this is the right tradeoff. */
function isAllowedOutboundUrl(u: URL): boolean {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  // Strip IPv6 brackets if present.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (
    host === "localhost" ||
    host === "0" ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "::" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  ) {
    return false;
  }
  // IPv4 literal in private / link-local / multicast / reserved ranges.
  if (/^(10|127)\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return false; // CGNAT 100.64.0.0/10
  if (/^(22[4-9]|23\d)\./.test(host)) return false; // multicast
  // IPv6 link-local (fe80::/10), unique-local (fc00::/7), loopback,
  // unspecified, and IPv4-mapped private ranges.
  if (/^fe[89ab][0-9a-f]:/.test(host)) return false;
  if (/^f[cd][0-9a-f][0-9a-f]:/.test(host)) return false;
  if (/^::ffff:(10|127|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\./.test(host)) return false;
  return true;
}

function publicUrlFor(key: string): string {
  const direct = storage.getPublicUrl(key);
  if (direct) return direct;
  // Fall back to proxying through this server when no public R2 URL is
  // configured. The proxy route is defined below.
  return `/api/ai-storage/object/${encodeURI(key)}`;
}

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
      "Object storage is not configured on this server (missing R2 env vars). Ask an operator to set CF_ACCOUNT_ID + OBJECT_STORAGE_KEY/SECRET + R2_BUCKET_ASSETS.",
  });
  return true;
}

/* ─────────────────────────────────────────────────────────────────── *
 *  POST /ai-storage/scene-snapshot
 *
 *  Body: { projectId, name, sceneData }
 *  Writes JSON to `ai-snapshots/<projectId>/<ts>-<slug>.gfscene.json`,
 *  returns { key, url, byteSize, written }.
 * ─────────────────────────────────────────────────────────────────── */
router.post("/ai-storage/scene-snapshot", async (req: Request, res: Response) => {
  if (rejectIfR2Missing(res)) return;
  const body = (req.body ?? {}) as {
    projectId?: unknown;
    name?: unknown;
    sceneData?: unknown;
  };
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const name = typeof body.name === "string" && body.name ? body.name : "snapshot";
  if (!SAFE_PROJECT_ID.test(projectId)) {
    res.status(400).json({ error: "Invalid or missing projectId" });
    return;
  }
  if (!body.sceneData || typeof body.sceneData !== "object") {
    res.status(400).json({ error: "sceneData must be an object" });
    return;
  }
  const json = JSON.stringify(body.sceneData);
  if (json.length > 8 * 1024 * 1024) {
    res.status(413).json({ error: "Scene snapshot exceeds 8 MB cap" });
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `ai-snapshots/${projectId}/${ts}-${slug(name)}.gfscene.json`;
  try {
    const result = await storage.ensurePublicJson(key, json, {
      // Snapshots are immutable per timestamp — long cache is fine.
      cacheTtlSec: 31_536_000,
    });
    res.json({
      key,
      url: publicUrlFor(key),
      byteSize: result.byteSize,
      written: result.written,
    });
  } catch (err) {
    req.log.error({ err, key }, "Scene snapshot write failed");
    res.status(500).json({ error: "Failed to write snapshot to storage" });
  }
});

/* ─────────────────────────────────────────────────────────────────── *
 *  POST /ai-storage/import-asset
 *
 *  Body: { projectId, sourceUrl, name?, contentType? }
 *  Downloads `sourceUrl` (must be http(s)), uploads to R2 under
 *  `user-assets/<projectId>/<sha256-12>-<slug>.<ext>`, returns
 *  { key, url, contentType, byteSize, written }.
 * ─────────────────────────────────────────────────────────────────── */
router.post("/ai-storage/import-asset", async (req: Request, res: Response) => {
  if (rejectIfR2Missing(res)) return;
  const body = (req.body ?? {}) as {
    projectId?: unknown;
    sourceUrl?: unknown;
    name?: unknown;
    contentType?: unknown;
  };
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  const name = typeof body.name === "string" && body.name ? body.name : "asset";
  const overrideCt = typeof body.contentType === "string" ? body.contentType : "";

  if (!SAFE_PROJECT_ID.test(projectId)) {
    res.status(400).json({ error: "Invalid or missing projectId" });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    res.status(400).json({ error: "sourceUrl must be a valid URL" });
    return;
  }
  if (!isAllowedOutboundUrl(parsed)) {
    res.status(400).json({ error: "sourceUrl is not allowed (scheme/host)" });
    return;
  }

  // SSRF hardening: disable redirect following entirely. A naive
  // pre-flight host check is meaningless if the upstream can 302 us to
  // 169.254.169.254 (cloud metadata) or an internal RFC1918 address.
  // Rather than re-validate every hop (which is fiddly and still
  // racy against DNS rebinding), we surface the redirect to the AI as
  // an error and let it pick a different source.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMPORT_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = (await fetch(parsed.toString(), {
      redirect: "error",
      signal: ac.signal,
      headers: { "User-Agent": "GrudgeGameForge-AIWorker/1.0" },
    })) as unknown as Response;
  } catch (err) {
    clearTimeout(timer);
    req.log.warn({ err, host: parsed.hostname }, "Asset import fetch failed");
    res.status(502).json({
      error:
        "Failed to fetch sourceUrl (network error, redirect, or timeout). Try a direct, redirect-free URL.",
    });
    return;
  }
  const fetchRes = upstream as unknown as {
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    body: ReadableStream<Uint8Array> | null;
  };
  if (!fetchRes.ok) {
    clearTimeout(timer);
    res.status(502).json({ error: `Upstream returned ${fetchRes.status}` });
    return;
  }
  const declaredLen = Number(fetchRes.headers.get("content-length") ?? "0");
  if (declaredLen && declaredLen > MAX_IMPORT_BYTES) {
    clearTimeout(timer);
    res.status(413).json({
      error: `Asset is ${declaredLen} bytes, max is ${MAX_IMPORT_BYTES}`,
    });
    return;
  }
  // Stream into memory with a running byte budget so a hostile upstream
  // that lies about content-length (or refuses to send one) can't force
  // us to buffer multi-GB before we notice. We abort the underlying
  // fetch the moment we cross MAX_IMPORT_BYTES.
  let buf: Buffer;
  try {
    if (!fetchRes.body) {
      clearTimeout(timer);
      res.status(502).json({ error: "Upstream returned an empty body" });
      return;
    }
    const reader = fetchRes.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let oversize = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMPORT_BYTES) {
        oversize = true;
        await reader.cancel().catch(() => {});
        ac.abort();
        break;
      }
      chunks.push(value);
    }
    clearTimeout(timer);
    if (oversize) {
      res.status(413).json({
        error: `Asset exceeded ${MAX_IMPORT_BYTES} bytes during transfer`,
      });
      return;
    }
    buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  } catch (err) {
    clearTimeout(timer);
    req.log.warn({ err, host: parsed.hostname }, "Asset import body read failed");
    res.status(502).json({ error: "Failed to read asset body" });
    return;
  }
  const contentType =
    overrideCt || fetchRes.headers.get("content-type") || "application/octet-stream";
  const ext = extForContentType(contentType);
  const fingerprint = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const key = `user-assets/${projectId}/${fingerprint}-${slug(name)}.${ext}`;
  try {
    const result = await storage.ensurePublicBytes(key, buf, { contentType });
    res.json({
      key,
      url: publicUrlFor(key),
      contentType,
      byteSize: result.byteSize,
      written: result.written,
    });
  } catch (err) {
    req.log.error({ err, key }, "Asset import write failed");
    res.status(500).json({ error: "Failed to write asset to storage" });
  }
});

/* ─────────────────────────────────────────────────────────────────── *
 *  GET /ai-storage/list/:projectId?kind=assets|snapshots|all
 * ─────────────────────────────────────────────────────────────────── */
router.get("/ai-storage/list/:projectId", async (req: Request, res: Response) => {
  if (rejectIfR2Missing(res)) return;
  const projectId = req.params.projectId;
  if (typeof projectId !== "string" || !SAFE_PROJECT_ID.test(projectId)) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }
  const kindRaw = (req.query.kind ?? "all") as string;
  const kind: "assets" | "snapshots" | "all" =
    kindRaw === "assets" || kindRaw === "snapshots" ? kindRaw : "all";

  const prefixes: Array<{ prefix: string; kind: "asset" | "snapshot" }> = [];
  if (kind === "assets" || kind === "all") {
    prefixes.push({ prefix: `user-assets/${projectId}/`, kind: "asset" });
  }
  if (kind === "snapshots" || kind === "all") {
    prefixes.push({ prefix: `ai-snapshots/${projectId}/`, kind: "snapshot" });
  }

  try {
    const all = await Promise.all(
      prefixes.map(async ({ prefix, kind: k }) => {
        const items = await storage.listObjects(prefix, { maxKeys: 200 });
        return items.map((it) => ({
          kind: k,
          key: it.key,
          url: publicUrlFor(it.key),
          sizeBytes: it.sizeBytes,
          lastModified: it.lastModified,
        }));
      }),
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ projectId, items: all.flat() });
  } catch (err) {
    req.log.error({ err, projectId }, "AI storage list failed");
    res.status(500).json({ error: "Failed to list objects" });
  }
});

/* ─────────────────────────────────────────────────────────────────── *
 *  GET /ai-storage/object/<key…>
 *
 *  Streams a previously-written object back to the caller. Used as the
 *  fallback `url` returned by the upload routes when no public R2
 *  domain is configured. Restricted to the `ai-snapshots/` and
 *  `user-assets/` prefixes so this can't be turned into a generic
 *  bucket-download endpoint.
 * ─────────────────────────────────────────────────────────────────── */
router.get("/ai-storage/object/*key", async (req: Request, res: Response) => {
  if (rejectIfR2Missing(res)) return;
  const raw = req.params.key;
  const key = Array.isArray(raw) ? raw.join("/") : raw;
  if (
    typeof key !== "string" ||
    !(key.startsWith("ai-snapshots/") || key.startsWith("user-assets/")) ||
    key.includes("..")
  ) {
    res.status(400).json({ error: "Invalid object key" });
    return;
  }
  try {
    const stream = await storage.getPublicObjectStream(key);
    res.status(200);
    res.setHeader("Content-Type", stream.contentType);
    if (stream.contentLength != null) {
      res.setHeader("Content-Length", String(stream.contentLength));
    }
    if (stream.etag) res.setHeader("ETag", `"${stream.etag}"`);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    (stream.body as Readable).pipe(res);
  } catch (err) {
    if (err instanceof R2NotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err, key }, "AI storage object read failed");
    res.status(500).json({ error: "Failed to read object" });
  }
});

export default router;
