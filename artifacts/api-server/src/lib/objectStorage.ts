/**
 * Object storage service — Cloudflare R2 backend.
 *
 * All storage goes through R2 via the S3-compatible API.
 * Replaces the previous Replit GCS sidecar implementation.
 *
 * Required env vars:
 *   CF_ACCOUNT_ID, R2_BUCKET_ASSETS (or OBJECT_STORAGE_BUCKET),
 *   OBJECT_STORAGE_KEY, OBJECT_STORAGE_SECRET
 *
 * Optional:
 *   OBJECT_STORAGE_PUBLIC_URL  — public CDN prefix (e.g. https://assets.grudge-studio.com)
 */
import { Readable } from "stream";
import { randomUUID, createHash } from "crypto";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  type ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  parseAclPolicy,
  serializeAclPolicy,
} from "./objectAcl";

// ── R2 client setup ──────────────────────────────────────────────────

let _client: S3Client | null = null;

function nativeR2Endpoint(): string {
  const accountId = process.env.CF_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
      "R2 not configured: CF_ACCOUNT_ID env var is required.",
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
      "R2 not configured: set OBJECT_STORAGE_KEY and OBJECT_STORAGE_SECRET.",
    );
  }
  _client = new S3Client({
    region: "auto",
    endpoint: nativeR2Endpoint(),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return _client;
}

function bucketName(): string {
  const b = process.env.R2_BUCKET_ASSETS || process.env.OBJECT_STORAGE_BUCKET;
  if (!b) {
    throw new Error(
      "R2 not configured: set R2_BUCKET_ASSETS (or OBJECT_STORAGE_BUCKET).",
    );
  }
  return b;
}

// ── Errors ───────────────────────────────────────────────────────────

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (e.name === "NoSuchKey" || e.name === "NotFound") return true;
  if (e.Code === "NoSuchKey" || e.Code === "NotFound") return true;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (cleaned.length === 0) return "";
  if (cleaned.length <= 64) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  if (dot === -1 || dot < cleaned.length - 10) return cleaned.slice(0, 64);
  const ext = cleaned.slice(dot);
  return cleaned.slice(0, 64 - ext.length) + ext;
}

/** The public-objects prefix used for searching. */
function publicPrefix(): string {
  return process.env.PUBLIC_OBJECT_PREFIX || "public";
}

/** The private-objects prefix used for uploads. */
function privatePrefix(): string {
  return process.env.PRIVATE_OBJECT_PREFIX || "uploads";
}

// ── Service ──────────────────────────────────────────────────────────

export class ObjectStorageService {
  /**
   * Search for a public object by path. Looks under the configured
   * public prefix in the R2 bucket.
   */
  async searchPublicObject(filePath: string): Promise<string | null> {
    const key = `${publicPrefix()}/${filePath}`;
    try {
      await client().send(
        new HeadObjectCommand({ Bucket: bucketName(), Key: key }),
      );
      return key;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Download an object by its R2 key. Returns a web Response with
   * correct Content-Type and Cache-Control headers.
   */
  async downloadObject(key: string, cacheTtlSec: number = 3600): Promise<Response> {
    const out = await client().send(
      new GetObjectCommand({ Bucket: bucketName(), Key: key }),
    );
    if (!out.Body) throw new ObjectNotFoundError();

    const body = out.Body as Readable;
    const webStream = Readable.toWeb(body) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": out.ContentType || "application/octet-stream",
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
    };
    if (out.ContentLength != null) {
      headers["Content-Length"] = String(out.ContentLength);
    }
    return new Response(webStream, { headers });
  }

  /**
   * Generate a pre-signed PUT URL for direct client upload to R2.
   */
  async getObjectEntityUploadURL(opts: {
    projectId?: number;
    assetType?: string;
    originalName?: string;
  } = {}): Promise<string> {
    const objectId = randomUUID();
    const projectFolder = opts.projectId ? String(opts.projectId) : "_loose";
    const typeFolder = opts.assetType?.trim() || "other";
    const safe = sanitizeFilename(opts.originalName || "");
    const leaf = safe ? `${objectId}-${safe}` : objectId;
    const key = `${privatePrefix()}/${projectFolder}/${typeFolder}/${leaf}`;

    const url = await getSignedUrl(
      client(),
      new PutObjectCommand({ Bucket: bucketName(), Key: key }),
      { expiresIn: 900 },
    );
    return url;
  }

  /**
   * Normalize a raw upload URL back to a relative object path the
   * storage routes can serve.
   */
  normalizeObjectEntityPath(rawUrl: string): string {
    try {
      const u = new URL(rawUrl);
      const b = bucketName();
      // Path-style: /<bucket>/<key>
      if (u.pathname.startsWith(`/${b}/`)) {
        const key = u.pathname.slice(b.length + 2);
        return `/objects/${key}`;
      }
    } catch {
      // Not a URL — return as-is.
    }
    return rawUrl;
  }

  /**
   * Resolve an object entity path (e.g. `/objects/<key>`) to its R2 key
   * and verify it exists. Throws ObjectNotFoundError if missing.
   */
  async getObjectEntityKey(objectPath: string): Promise<string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const key = objectPath.slice("/objects/".length);
    if (!key) throw new ObjectNotFoundError();

    try {
      await client().send(
        new HeadObjectCommand({ Bucket: bucketName(), Key: key }),
      );
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError();
      throw err;
    }
    return key;
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    const key = await this.getObjectEntityKey(objectPath);
    await client().send(
      new DeleteObjectCommand({ Bucket: bucketName(), Key: key }),
    );
  }

  /**
   * Set ACL policy metadata on an R2 object via read + rewrite.
   */
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;

    const key = await this.getObjectEntityKey(normalizedPath);
    const meta = serializeAclPolicy(aclPolicy);

    const existing = await client().send(
      new GetObjectCommand({ Bucket: bucketName(), Key: key }),
    );
    if (!existing.Body) throw new ObjectNotFoundError();

    const chunks: Buffer[] = [];
    for await (const chunk of existing.Body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    await client().send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: key,
        Body: body,
        ContentType: existing.ContentType,
        Metadata: { ...(existing.Metadata ?? {}), ...meta },
      }),
    );
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectKey,
    requestedPermission,
  }: {
    userId?: string;
    objectKey: string;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    try {
      const head = await client().send(
        new HeadObjectCommand({ Bucket: bucketName(), Key: objectKey }),
      );
      const aclPolicy = parseAclPolicy(head.Metadata);
      return canAccessObject({
        userId,
        aclPolicy,
        requestedPermission: requestedPermission ?? ObjectPermission.READ,
      });
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  }
}
