#!/usr/bin/env node
/**
 * Reliable production deploy for forge.grudge-studio.com.
 *
 * Builds the SPA locally (or uses existing dist), then uploads
 * artifacts/game-forge/dist/public as a static Vercel deployment.
 * Avoids Vercel git-integration OOM on 8 GB builders.
 *
 *   pnpm run build:forge
 *   pnpm run deploy:forge
 *
 * Requires: vercel CLI logged in (or VERCEL_TOKEN + ORG/PROJECT ids).
 */
import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "artifacts/game-forge/dist/public");
const index = resolve(dist, "index.html");
const vercelJsonSrc = resolve(root, "artifacts/game-forge/public/vercel.json");
const vercelJsonDst = resolve(dist, "vercel.json");

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: opts.cwd || root,
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(index) || process.argv.includes("--rebuild")) {
  console.log("[deploy:forge] Building SPA…");
  run("pnpm", ["--filter", "@workspace/game-forge", "run", "build"], {
    env: {
      NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192",
      BASE_PATH: "/",
    },
  });
}

if (!existsSync(index)) {
  console.error("[deploy:forge] missing", index);
  process.exit(1);
}

// Ensure SPA rewrites exist in the upload root
if (existsSync(vercelJsonSrc)) {
  copyFileSync(vercelJsonSrc, vercelJsonDst);
} else if (!existsSync(vercelJsonDst)) {
  console.error("[deploy:forge] missing vercel.json in dist — re-run build");
  process.exit(1);
}

// Drop stale link to wrong project if present
const badLink = resolve(dist, ".vercel");
// keep .vercel if linked to grudge-studio-forge — vercel deploy uses it

console.log("[deploy:forge] Deploying", dist, "→ production…");
run(
  "npx",
  [
    "vercel",
    "deploy",
    "--prod",
    "--yes",
    "--scope",
    process.env.VERCEL_SCOPE || "grudgenexus",
  ],
  { cwd: dist },
);

console.log("[deploy:forge] Smoke…");
run("node", ["scripts/smoke-forge-prod.mjs"], { cwd: root });
