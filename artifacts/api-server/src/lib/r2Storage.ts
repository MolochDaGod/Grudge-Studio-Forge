/**
 * Cloudflare R2 (Grudge Studio's bucket) storage adapter.
 *
 * R2 is S3-compatible, so we use `@aws-sdk/client-s3` pointed at the
 * R2 endpoint. This module replaces the Replit GCS sidecar pathway for
 * the things we care about controlling — built-in scene templates
 * ("example maps") — so the user's data lives where they actually own
 * the infrastructure (R2 bucket they pay for) instead of leaking into
 * Replit's managed GCS bucket.
 *
 * What this does NOT replace:
 *   - User-uploaded asset signing (`getObjectEntityUploadURL`,
 *     ACL/permission flows in `objectStorage.ts`). Those are tied to
 *     Replit's auth model and a deeper migration; not in scope for the
 *     "stop putting maps on Replit" complaint.
 *
 * Required env vars (already present as Replit secrets):
 *   OBJECT_STORAGE_ENDPOINT     https://<account-id>.r2.cloudflarestorage.com
 *   OBJECT_STORAGE_BUCKET       bucket name (e.g. "grudge-objectstore")
 *   OBJECT_STORAGE_KEY          R2 access key ID
 *   OBJECT_STORAGE_SECRET       R2 secret access key
 *   OBJECT_STORAGE_REGION       "auto" for R2 (also accepted: us-east-1)
 *
 * Optional:
 *   OBJECT_STORAGE_PUBLIC_URL   public URL prefix (e.g. r2.dev or custom
 *                               domain). Not currently used because the
 *                               templates route streams through the API
 *                               server — but exposed via
 *                               `getPublicUrl()` for future direct-link
 *                               flows that want to bypass the proxy.
 */

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { createHash } from "crypto";

let _client: S3Client | null = null;

function client(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const accessKeyId = process.env.OBJECT_STORAGE_KEY;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 not configured: set OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_KEY, " +
        "and OBJECT_STORAGE_SECRET (Cloudflare R2 credentials).",
    );
  }
  _client = new S3Client({
    region: process.env.OBJECT_STORAGE_REGION || "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 supports both virtual-hosted and path-style. Path-style is the
    // safer default when bucket names include characters that don't
    // play nicely with DNS subdomains.
    forcePathStyle: true,
  });
  return _client;
}

function bucket(): string {
  const b = process.env.OBJECT_STORAGE_BUCKET;
  if (!b) {
    throw new Error(
      "R2 not configured: OBJECT_STORAGE_BUCKET env var must name the " +
        "Cloudflare R2 bucket to read/write.",
    );
  }
  return b;
}

export class R2NotFoundError extends Error {
  constructor(key: string) {
    super(`R2 object not found: ${key}`);
    this.name = "R2NotFoundError";
    Object.setPrototypeOf(this, R2NotFoundError.prototype);
  }
}

/**
 * Stream metadata returned by {@link getPublicObjectStream}.
 * Headers are returned separately from the stream so the caller (an
 * Express route) can set them on the response *before* piping bytes —
 * crucial for `Content-Length` since the editor's progress bar is
 * driven by the response's `Content-Length` header.
 */
export interface R2ObjectStream {
  body: Readable;
  contentType: string;
  contentLength: number | null;
  etag: string | null;
}

export class R2StorageService {
  /**
   * Idempotently write a JSON payload to a public R2 object key.
   *
   * Returns `{ written, byteSize }` — `written: false` when the object
   * already exists with matching MD5 content, so callers can skip the
   * upload and avoid re-paying R2's per-write cost.
   *
   * R2's `ETag` for non-multipart uploads is the MD5 of the object in
   * hex (same convention as S3). We compute the local MD5 in hex and
   * compare against `HeadObject`'s ETag (with quote stripping); a
   * match means the existing object is byte-identical to what we'd
   * upload. MD5 here is a content fingerprint, not a security
   * primitive — collisions across template revisions are not a concern.
   *
   * On miss, we PUT with `Cache-Control: public, max-age=<ttl>,
   * immutable` so the eventual public URL (or proxied response) is
   * heavily cacheable downstream.
   */
  async ensurePublicJson(
    key: string,
    payload: string,
    opts: { cacheTtlSec?: number } = {},
  ): Promise<{ written: boolean; byteSize: number }> {
    const buf = Buffer.from(payload, "utf8");
    const cacheTtlSec = opts.cacheTtlSec ?? 31_536_000; // 1y
    const expectedMd5Hex = createHash("md5").update(buf).digest("hex");

    // Probe existence + fingerprint.
    const existingEtag = await this.headEtag(key);
    if (existingEtag && existingEtag === expectedMd5Hex) {
      return { written: false, byteSize: buf.byteLength };
    }

    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: buf,
        ContentType: "application/json; charset=utf-8",
        // ContentMD5 lets R2 verify the upload server-side; same field
        // S3 uses. Sent as base64 per spec.
        ContentMD5: createHash("md5").update(buf).digest("base64"),
        CacheControl: `public, max-age=${cacheTtlSec}, immutable`,
      }),
    );
    return { written: true, byteSize: buf.byteLength };
  }

  /**
   * HEAD an object and return its ETag (lowercase hex, quotes stripped),
   * or `null` if the object doesn't exist. Other errors propagate so
   * boot-time seeding loudly fails on auth/network problems instead of
   * silently re-uploading.
   */
  async headEtag(key: string): Promise<string | null> {
    try {
      const head = await client().send(
        new HeadObjectCommand({ Bucket: bucket(), Key: key }),
      );
      const raw = head.ETag;
      if (!raw) return null;
      return raw.replace(/^"|"$/g, "").toLowerCase();
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Open a streaming read of a public object. Express routes use this
   * to pipe straight to the response — no buffering of the full payload
   * in API memory, which matters for large GLBs even though templates
   * themselves are KBs.
   *
   * Throws {@link R2NotFoundError} on 404; bubbles other errors.
   */
  async getPublicObjectStream(key: string): Promise<R2ObjectStream> {
    let out: GetObjectCommandOutput;
    try {
      out = await client().send(
        new GetObjectCommand({ Bucket: bucket(), Key: key }),
      );
    } catch (err) {
      if (isNotFoundError(err)) throw new R2NotFoundError(key);
      throw err;
    }
    if (!out.Body) throw new R2NotFoundError(key);
    // The SDK returns Node's Readable in Node runtimes (it returns a
    // web ReadableStream in browsers / Cloudflare workers — we always
    // run in Node here, but the typing is the lowest common
    // denominator, so we narrow defensively).
    const body = out.Body as Readable;
    return {
      body,
      contentType: out.ContentType ?? "application/octet-stream",
      contentLength:
        typeof out.ContentLength === "number" ? out.ContentLength : null,
      etag: out.ETag ? out.ETag.replace(/^"|"$/g, "").toLowerCase() : null,
    };
  }

  /**
   * Public URL for an object, when one is configured. Returns `null`
   * when `OBJECT_STORAGE_PUBLIC_URL` is unset — callers should fall
   * back to proxying through the API server in that case.
   *
   * Currently unused by the templates route (we proxy so we control
   * cache headers + CORS), but exposed for future direct-link flows.
   */
  getPublicUrl(key: string): string | null {
    const base = process.env.OBJECT_STORAGE_PUBLIC_URL;
    if (!base) return null;
    return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
  }
}

/**
 * Detect an S3 "key does not exist" error across the SDK's various
 * error shapes (NoSuchKey for GetObject, NotFound for HeadObject,
 * plus the bare HTTP 404 some R2 endpoints surface).
 *
 * R2 sometimes returns a non-XML body for HEAD/GET 404s (a Cloudflare
 * edge JSON error page rather than the S3 XML envelope). The SDK's
 * fast-xml-parser then throws *before* it can construct a typed
 * `NotFoundException`, leaving us with a generic `Error` that still
 * carries the correct `$metadata.httpStatusCode = 404`. We also
 * pattern-match the parser's error message as a defence in depth so
 * the check works even on SDK versions that fail to attach metadata
 * to the rewrapped error.
 */
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    Code?: string;
    message?: string;
    httpStatusCode?: number;
    $metadata?: { httpStatusCode?: number };
    $response?: { statusCode?: number };
  };
  if (e.name === "NoSuchKey" || e.name === "NotFound") return true;
  if (e.Code === "NoSuchKey" || e.Code === "NotFound") return true;
  const status =
    e.$metadata?.httpStatusCode ?? e.httpStatusCode ?? e.$response?.statusCode;
  if (status === 404) return true;
  // fxp parser error from R2's non-XML 404 body. The exact prefix is
  // "char '{' is not expected." or similar — match the stable suffix.
  if (typeof e.message === "string" && /is not expected\./.test(e.message)) {
    return true;
  }
  return false;
}
