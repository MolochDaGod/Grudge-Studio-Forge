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
 * Always targets project **grudge-studio-forge** (never "public").
 * Requires: vercel CLI logged in (or VERCEL_TOKEN + ORG/PROJECT ids).
 */
import { spawnSync } from "node:child_process";
import { existsSync, copyFileSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "artifacts/game-forge/dist/public");
const index = resolve(dist, "index.html");
const vercelJsonSrc = resolve(root, "artifacts/game-forge/public/vercel.json");
const vercelJsonDst = resolve(dist, "vercel.json");
const PROJECT = process.env.VERCEL_PROJECT || "grudge-studio-forge";
const SCOPE = process.env.VERCEL_SCOPE || "grudgenexus";
// From repo .vercel/project.json when present
const ROOT_PROJECT = resolve(root, ".vercel/project.json");

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

// Force link to grudge-studio-forge — never the accidental "public" project
const distVercel = resolve(dist, ".vercel");
const distProjectJson = resolve(distVercel, "project.json");
let linkedOk = false;
if (existsSync(distProjectJson)) {
  try {
    const j = JSON.parse(readFileSync(distProjectJson, "utf8"));
    if (j.projectName === PROJECT || j.projectId) {
      // Prefer verifying name when present
      if (!j.projectName || j.projectName === PROJECT) linkedOk = j.projectName === PROJECT;
    }
  } catch {
    linkedOk = false;
  }
}
if (!linkedOk) {
  if (existsSync(distVercel)) {
    rmSync(distVercel, { recursive: true, force: true });
  }
  // Copy root link if it points at the right project
  if (existsSync(ROOT_PROJECT)) {
    try {
      const rootLink = JSON.parse(readFileSync(ROOT_PROJECT, "utf8"));
      if (rootLink.projectName === PROJECT || rootLink.projectName === undefined) {
        mkdirSync(distVercel, { recursive: true });
        // Prefer explicit project name
        const payload = {
          projectId: rootLink.projectId,
          orgId: rootLink.orgId,
          projectName: PROJECT,
        };
        writeFileSync(distProjectJson, JSON.stringify(payload), "utf8");
        linkedOk = true;
        console.log("[deploy:forge] Linked dist →", PROJECT, "(from repo .vercel)");
      }
    } catch {
      /* fall through to vercel link */
    }
  }
}
if (!linkedOk) {
  console.log(`[deploy:forge] Linking dist to ${SCOPE}/${PROJECT}…`);
  run(
    "npx",
    ["vercel", "link", "--project", PROJECT, "--yes", "--scope", SCOPE],
    { cwd: dist },
  );
}

// Verify before upload
if (existsSync(distProjectJson)) {
  const j = JSON.parse(readFileSync(distProjectJson, "utf8"));
  console.log("[deploy:forge] target", j.projectName || j.projectId, j.orgId);
  if (j.projectName && j.projectName !== PROJECT) {
    console.error(
      `[deploy:forge] REFUSING to deploy to project "${j.projectName}" — expected "${PROJECT}"`,
    );
    process.exit(1);
  }
}

console.log("[deploy:forge] Deploying", dist, "→ production…");
run(
  "npx",
  ["vercel", "deploy", "--prod", "--yes", "--scope", SCOPE],
  { cwd: dist },
);

console.log("[deploy:forge] Smoke…");
run("node", ["scripts/smoke-forge-prod.mjs"], { cwd: root });
