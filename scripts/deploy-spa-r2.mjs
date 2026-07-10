#!/usr/bin/env node
/**
 * Upload artifacts/game-forge/dist/public → R2 prefix `forge-spa/`.
 * Served later via assets CDN or Worker ASSETS_ORIGIN rewrite.
 *
 * Required env (same pattern as upload-maps-r2.mjs):
 *   CF_ACCOUNT_ID
 *   OBJECT_STORAGE_KEY / R2_ACCESS_KEY_ID
 *   OBJECT_STORAGE_SECRET / R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_ASSETS  (default grudge-assets)
 *   FORGE_SPA_PREFIX  (default forge-spa)
 *
 * Usage:
 *   node scripts/deploy-spa-r2.mjs
 */

import { createReadStream, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "artifacts", "game-forge", "dist", "public");

const accountId = process.env.CF_ACCOUNT_ID;
const accessKeyId =
  process.env.OBJECT_STORAGE_KEY || process.env.R2_ACCESS_KEY_ID;
const secretAccessKey =
  process.env.OBJECT_STORAGE_SECRET || process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_ASSETS || "grudge-assets";
const prefix = (process.env.FORGE_SPA_PREFIX || "forge-spa").replace(
  /^\/|\/$/g,
  "",
);

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error(
    "Missing CF_ACCOUNT_ID + OBJECT_STORAGE_KEY + OBJECT_STORAGE_SECRET",
  );
  process.exit(1);
}

function contentType(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map = {
    html: "text/html; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    ico: "image/x-icon",
    wasm: "application/wasm",
    glb: "model/gltf-binary",
    woff2: "font/woff2",
    woff: "font/woff",
    map: "application/json",
    webmanifest: "application/manifest+json",
    txt: "text/plain",
  };
  return map[ext] || "application/octet-stream";
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function main() {
  let files;
  try {
    files = walk(DIST);
  } catch {
    console.error(`No dist at ${DIST} — run scripts/build-spa.sh first`);
    process.exit(1);
  }

  console.log(`Uploading ${files.length} files → s3://${bucket}/${prefix}/`);
  let n = 0;
  for (const file of files) {
    const rel = relative(DIST, file).split("\\").join("/");
    const key = `${prefix}/${rel}`;
    const isHtml = rel.endsWith(".html");
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(file),
        ContentType: contentType(file),
        CacheControl: isHtml
          ? "public, max-age=0, must-revalidate"
          : "public, max-age=31536000, immutable",
      }),
    );
    n++;
    if (n % 25 === 0 || n === files.length) {
      console.log(`  ${n}/${files.length}  ${key}`);
    }
  }
  console.log("Done.");
  console.log(
    `Public (if bucket public via assets CDN): https://assets.grudge-studio.com/${prefix}/index.html`,
  );
  console.log(
    "For forge.grudge-studio.com prefer VPS nginx or point Worker ORIGIN at a host that serves this prefix at /.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
