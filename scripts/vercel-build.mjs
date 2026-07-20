#!/usr/bin/env node
/**
 * Vercel git-integration build for game-forge SPA.
 *
 * Default Vercel builders (8 GB) OOM on this monorepo's Vite graph.
 * Prefer GitHub Actions deploy-spa.yml (16G swap + prebuilt upload).
 *
 * This script:
 *  1. Builds only @workspace/game-forge with low-RAM Rollup settings
 *  2. Skips player prebuild (7MB singlefile — optional on R2)
 *  3. Fails with a clear message if OOM is likely (detected env)
 *
 * Enhanced Builds (16 GB+): set VERCEL_FORCE_BUILD=1 or enable in dashboard.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const memGb = Number(process.env.VERCEL_BUILD_MEMORY_GB || process.env.BUILD_MEMORY_GB || 8);
const force = process.env.VERCEL_FORCE_BUILD === "1";

if (memGb < 14 && !force) {
  console.error(`
[vercel-build] Refusing to run Vite on a ~${memGb} GB builder.

  The Forge SPA regularly OOMs on standard 8 GB Vercel builders
  (SIGKILL during "vite build"). Deploy instead via:

    1) GitHub Actions: .github/workflows/deploy-spa.yml
       (ubuntu-latest + 16G swap → vercel deploy --prod of dist)

    2) Local:
       pnpm install --filter @workspace/game-forge...
       pnpm --filter @workspace/game-forge run build
       pnpm run deploy:forge

  To force a Vercel-side build anyway (needs Enhanced Builds 16 GB+):
    vercel env add VERCEL_FORCE_BUILD production   # value: 1

  Docs: DEPLOYMENT.md
`);
  // Exit 0 with ignoreCommand path is preferred; if this script is the
  // buildCommand, exit non-zero so the failure message is visible once.
  // Prefer skip: see vercel.json ignoreCommand.
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=12288",
  BASE_PATH: "/",
};

console.log("[vercel-build] Building @workspace/game-forge (high-RAM mode)…");
const r = spawnSync(
  "pnpm",
  ["--filter", "@workspace/game-forge", "exec", "vite", "build", "--config", "vite.config.ts"],
  { stdio: "inherit", env, shell: process.platform === "win32" },
);

if (r.status !== 0) {
  process.exit(r.status ?? 1);
}

const out = "artifacts/game-forge/dist/public/index.html";
if (!existsSync(out)) {
  console.error(`[vercel-build] missing ${out}`);
  process.exit(1);
}
console.log("[vercel-build] OK", out);
