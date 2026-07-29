/**
 * Public fleet endpoints for Forge SPA (safe to ship in the client).
 * Secrets never live here — free-ai Worker + ObjectStore hold API keys.
 */

export const FLEET = {
  /** Production CDN for GLBs / textures (R2 custom domain). */
  assetsCdn: "https://assets.grudge-studio.com",
  /** Public R2.dev fallback (prefer assetsCdn). */
  assetsR2Dev:
    "https://pub-e7fcf1fd4c9946ecb84b3766bbc7b50d.r2.dev",
  /** ObjectStore catalog + upload API. */
  objectStore: "https://objectstore.grudge-studio.com",
  /** Bucket name (index / docs only — not a secret). */
  r2BucketAssets: "grudge-assets",
  /** Studio SSO. */
  grudgeId: "https://id.grudge-studio.com",
  /** Forge production host. */
  forge: "https://forge.grudge-studio.com",
  /** Free AI + catalog + agent jobs (same-origin under forge). */
  freeAiStatusPath: "/api/free-ai/status",
  freeAiChatPath: "/api/free-ai/chat",
  catalogStatusPath: "/api/catalog/status",
  agentJobsPath: "/api/agent/jobs",
  /** Local editor storage: Puter KV/FS when signed in, else localStorage. */
  projectBackend: "puter-or-local" as const,
} as const;

/** Absolute HTTPS URL on assets CDN (no leading slash on key). */
export function assetsUrl(objectKey: string): string {
  const key = objectKey.replace(/^\/+/, "");
  return `${FLEET.assetsCdn}/${key}`;
}
