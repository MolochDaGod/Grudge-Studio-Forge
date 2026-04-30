import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID, createHash } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  /**
   * Get a `File` handle for a public object at `<firstSearchPath>/<filePath>`.
   * Useful when we want to *write* to a known, deterministic public path
   * (e.g. seeding bundled templates) rather than searching for an existing
   * one. Does NOT check existence — call `.exists()` on the returned File
   * if you need that.
   */
  publicFileHandle(filePath: string): File {
    const searchPaths = this.getPublicObjectSearchPaths();
    const fullPath = `${searchPaths[0]}/${filePath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return objectStorageClient.bucket(bucketName).file(objectName);
  }

  /**
   * Idempotently write a JSON payload to a public object path. Returns
   * `{ written, byteSize }` — `written: false` when the existing
   * object's CONTENTS already match (verified via MD5), so callers can
   * skip the upload.
   *
   * Why MD5 instead of just byte size: a different scene with the same
   * serialized length would collide on size alone and silently serve
   * stale content. GCS computes md5Hash on every upload as part of
   * normal object storage — comparing against the freshly-built
   * payload's md5 is a strong correctness check at zero extra storage
   * cost.
   *
   * Note: MD5 is used here as a *content fingerprint*, not for
   * security. Cryptographic strength isn't relevant — we just need
   * collisions to be vanishingly unlikely between revisions of the
   * same template.
   */
  async ensurePublicJson(
    filePath: string,
    payload: string,
    opts: { cacheTtlSec?: number } = {},
  ): Promise<{ written: boolean; byteSize: number }> {
    const file = this.publicFileHandle(filePath);
    const buf = Buffer.from(payload, "utf8");
    const cacheTtlSec = opts.cacheTtlSec ?? 31_536_000; // 1y default — versioned URLs are immutable
    const expectedMd5 = createHash("md5").update(buf).digest("base64");
    const [exists] = await file.exists();
    if (exists) {
      const [meta] = await file.getMetadata();
      const existingMd5 = typeof meta.md5Hash === "string" ? meta.md5Hash : null;
      if (existingMd5 === expectedMd5) {
        return { written: false, byteSize: buf.byteLength };
      }
      // Size matches but MD5 doesn't — could be a corrupt or stale
      // object with the same byte length. Overwrite (we have the
      // immutability invariant via versioned URL paths, so this only
      // ever runs when the *content itself* changed without the
      // version key being bumped — typically a dev iteration before a
      // version bump).
    }
    await file.save(buf, {
      contentType: "application/json; charset=utf-8",
      // Set cache headers up front so clients/CDNs cache aggressively.
      // Versioned URLs (e.g. /templates/<version>/<key>.json) are safe to
      // mark immutable.
      metadata: {
        cacheControl: `public, max-age=${cacheTtlSec}, immutable`,
      },
      // resumable=false avoids the unnecessary multipart dance for small
      // payloads (templates are KBs).
      resumable: false,
    });
    return { written: true, byteSize: buf.byteLength };
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(opts: {
    projectId?: number;
    assetType?: string;
    originalName?: string;
  } = {}): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const projectFolder = opts.projectId ? String(opts.projectId) : "_loose";
    const typeFolder = opts.assetType?.trim() || "other";
    const safe = sanitizeFilename(opts.originalName || "");
    const leaf = safe ? `${objectId}-${safe}` : objectId;
    const fullPath = `${privateObjectDir}/uploads/${projectFolder}/${typeFolder}/${leaf}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async deleteObjectEntity(objectPath: string): Promise<void> {
    const objectFile = await this.getObjectEntityFile(objectPath);
    await objectFile.delete({ ignoreNotFound: true });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

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

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}
