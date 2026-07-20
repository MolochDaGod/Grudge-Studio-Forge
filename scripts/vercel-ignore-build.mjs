#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step".
 *
 * Exit codes (Vercel convention):
 *   0 → SKIP this deployment (do not build)
 *   1 → CONTINUE with install/build
 *
 * Standard 8 GB Vercel builders OOM on the Forge Vite graph. Automatic
 * Git deploys therefore fail red on every push. We skip those and rely on:
 *   - GitHub Actions `.github/workflows/deploy-spa.yml` (swap + prebuilt)
 *   - Local `pnpm run deploy:forge`
 *
 * Opt back into Vercel-side builds only with Enhanced Builds (16 GB+) AND:
 *   VERCEL_FORCE_BUILD=1
 *
 * Docs: https://vercel.com/docs/project-configuration/git-settings#ignored-build-step
 */
const force = process.env.VERCEL_FORCE_BUILD === "1";
const mem = Number(process.env.VERCEL_BUILD_MEMORY_GB || 8);

if (force || mem >= 14) {
  console.log(
    `[vercel-ignore] CONTINUE build (force=${force} mem≈${mem}G)`,
  );
  process.exit(1); // do not ignore — run build
}

console.log(
  `[vercel-ignore] SKIP automatic Vercel build (would OOM on ~${mem}G). Deploy via GitHub Actions deploy-spa.yml or pnpm run deploy:forge.`,
);
process.exit(0); // ignore / skip deployment
