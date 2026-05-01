/**
 * Cloudflare R2 (Grudge Studio's bucket) storage adapter.
 *
 * R2 is S3-compatible, so we use `@aws-sdk/client-s3` pointed at R2's
 * **native** S3 endpoint at
 *   https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com
 *
 * We deliberately do NOT use `OBJECT_STORAGE_ENDPOINT` —
 * `objectstore.grudge-studio.com` is a Cloudflare Worker proxy that
 * speaks its own JSON API rather than the S3 protocol, and the AWS SDK
 * fails to deserialize its responses. The Worker is fine for app code
 * that knows its contract, but for S3-style reads/writes from this
 * service we go to native R2 directly.
 *
 * Required env vars (Replit secrets):
 *   CF_ACCOUNT_ID            Cloudflare account ID (used to build the
 *                            native R2 S3 endpoint).
 *   R2_BUCKET_ASSETS         R2 bucket name (e.g. "grudge-assets").
 *   OBJECT_STORAGE_KEY       R2 S3 API access key ID.
 *   OBJECT_STORAGE_SECRET    R2 S3 API secret access key.
 *
 * Optional:
 *   OBJECT_STORAGE_PUBLIC_URL    Public read prefix (custom domain,
 *                                e.g. https://assets.grudge-studio.com).
 *   OBJECT_STORAGE_PUBLIC_R2_URL Native R2 public URL fallback
 *                                (https://pub-<id>.r2.dev).
 *
 * What this does NOT replace:
 *   - User-uploaded asset signing (`getObjectEntityUploadURL`,
 *     ACL/permission flows in `objectStorage.ts`). Those are tied to
 *     Replit's auth model and a deeper migration; not in scope for the
 *     "stop putting maps on Replit" complaint.
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

function nativeR2Endpoint(): string {
  const accountId = process.env.CF_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
      "R2 not configured: CF_ACCOUNT_ID env var is required to construct " +
        "the native R2 S3 endpoint (https://<account>.r2.cloudflarestorage.com).",
    );
  }
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function client(): S3Client {
  if (_client) return _client;
  const accessKeyId = process.env.OBJECT_STORAGE_KEY;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 not configured: set OBJECT_STORAGE_KEY and OBJECT_STORAGE_SECRET " +
        "(Cloudflare R2 S3 API credentials).",
    );
  }
  _client = new S3Client({
    // R2's native S3 endpoint requires region "auto" (it ignores the
    // value but the SDK requires one for SigV4).
    region: "auto",
    endpoint: nativeR2Endpoint(),
    credentials: { accessKeyId, secretAccessKey },
    // Path-style works against the native R2 endpoint and avoids any
    // DNS-subdomain weirdness with bucket names that have hyphens.
    forcePathStyle: true,
  });
  return _client;
}

/**
 * Resolve the R2 bucket name for templates. Prefers the explicit
 * `R2_BUCKET_ASSETS` (the user's canonical asset bucket); falls back to
 * the legacy `OBJECT_STORAGE_BUCKET` for compatibility with older
 * configs.
 */
function bucket(): string {
  const b = process.env.R2_BUCKET_ASSETS || process.env.OBJECT_STORAGE_BUCKET;
  if (!b) {
    throw new Error(
      "R2 not configured: set R2_BUCKET_ASSETS (or OBJECT_STORAGE_BUCKET) " +
        "to the R2 bucket that should hold scene templates.",
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

    // NOTE: Do NOT set `ContentMD5` here. The AWS SDK's
    // flexible-checksums middleware (enabled by default in v3.730+)
    // automatically attaches a CRC32 checksum, and R2 rejects requests
    // that carry both an explicit MD5 *and* the SDK's default checksum
    // with `InvalidRequest: You can only specify one non-default
    // checksum at a time`. Integrity is still guaranteed end-to-end via
    // the CRC32 the SDK sends.
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: buf,
        ContentType: "application/json; charset=utf-8",
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
    // Prefer the custom domain (assets.grudge-studio.com) over the
    // r2.dev public URL — same bucket, but the custom domain is
    // CDN-fronted with the user's branding.
    const base =
      process.env.OBJECT_STORAGE_PUBLIC_URL ||
      process.env.OBJECT_STORAGE_PUBLIC_R2_URL;
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
