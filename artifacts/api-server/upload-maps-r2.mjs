/**
 * Upload chicken gun maps to R2.
 * Run from repo root: node artifacts/api-server/upload-maps-r2.mjs
 */
import { readFileSync, createReadStream, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .env ────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(__dir, "..", "..", ".env");
  try {
    const text = readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* .env optional */
  }
}

loadEnv();

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const ACCESS_KEY = process.env.OBJECT_STORAGE_KEY;
const SECRET_KEY = process.env.OBJECT_STORAGE_SECRET;
const BUCKET =
  process.env.R2_BUCKET_ASSETS ?? process.env.OBJECT_STORAGE_BUCKET;
const PUBLIC_URL =
  process.env.OBJECT_STORAGE_PUBLIC_URL ?? "https://assets.grudge-studio.com";

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
  console.error("Missing R2 env vars.");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

const MAPS = [
  [
    "C:\\Users\\nugye\\Documents\\chicken_gun_mistytown.glb",
    "builtin/map-mistytown.glb",
    "map-mistytown",
  ],
  [
    "C:\\Users\\nugye\\Documents\\chicken_gun_town2f_reupload.glb",
    "builtin/map-town2f.glb",
    "map-town2f",
  ],
  [
    "C:\\Users\\nugye\\Documents\\chicken_gun_bigfarm_full_map.glb",
    "builtin/map-bigfarm.glb",
    "map-bigfarm",
  ],
  [
    "C:\\Users\\nugye\\Documents\\chicken_gun_western_reupload.glb",
    "builtin/map-western.glb",
    "map-western",
  ],
];

async function headExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function upload(srcPath, r2Key, name) {
  let stat;
  try {
    stat = statSync(srcPath);
  } catch {
    console.warn(`  SKIP ${name}: not found at ${srcPath}`);
    return;
  }
  if (await headExists(r2Key)) {
    console.log(`  EXISTS  ${name}  →  ${PUBLIC_URL}/${r2Key}`);
    return;
  }
  const mb = (stat.size / 1024 / 1024).toFixed(1);
  process.stdout.write(`  UPLOADING ${name} (${mb} MB)...`);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: r2Key,
      Body: createReadStream(srcPath),
      ContentType: "model/gltf-binary",
      ContentLength: stat.size,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  console.log(` done → ${PUBLIC_URL}/${r2Key}`);
}

console.log(`\nUploading chicken gun maps → R2 bucket: ${BUCKET}\n`);
for (const [src, key, name] of MAPS) await upload(src, key, name);
console.log("\nAll done!");
