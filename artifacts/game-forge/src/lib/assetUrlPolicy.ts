/**
 * Production asset URL policy for Forge + agentic creation.
 *
 * Agents and scene JSON may only reference durable production locations:
 *   - builtin:<key>  (BUILTIN_MODELS → R2 / same-origin)
 *   - https://assets.grudge-studio.com/…
 *   - Poly Haven CDN (import pipeline)
 *   - same-origin /api/storage/… (user R2 uploads)
 *
 * Reject: localhost, replit, blob: (except transient editor), random hosts.
 */

import { BUILTIN_MODELS, resolveBuiltinModel } from "@/lib/builtinModels";

/** Hosts allowed for absolute model / texture URLs in saved scenes. */
export const ALLOWED_ASSET_HOSTS = new Set([
  "assets.grudge-studio.com",
  "cdn.polyhaven.com",
  "dl.polyhaven.org",
  // ObjectStore GH pages mirror (read-only catalogs; prefer assets. CDN for binaries)
  "molochdagod.github.io",
]);

export type AssetUrlCheck =
  | { ok: true; kind: "builtin" | "cdn" | "polyhaven" | "storage" | "data"; url: string }
  | { ok: false; error: string };

/**
 * Normalize + validate a model URL for agent tools / scene persistence.
 * Prefer `builtin:` keys when the CDN path is registered in BUILTIN_MODELS.
 */
export function checkAssetUrl(raw: string | null | undefined): AssetUrlCheck {
  if (raw == null || typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Empty asset URL" };
  }
  const url = raw.trim();
  if (url.length > 2048) {
    return { ok: false, error: "Asset URL too long" };
  }

  if (url.startsWith("builtin:")) {
    const key = url.slice("builtin:".length);
    if (!key || !(key in BUILTIN_MODELS)) {
      return {
        ok: false,
        error: `Unknown builtin "${key}". Use list_builtin_models or list_fast_assets.`,
      };
    }
    return { ok: true, kind: "builtin", url };
  }

  if (url.startsWith("data:")) {
    return { ok: true, kind: "data", url };
  }

  // Transient browser blobs are ok in-session but never for agent-authored scenes
  if (url.startsWith("blob:")) {
    return {
      ok: false,
      error: "blob: URLs are not durable — import to R2 or use builtin:/assets.grudge-studio.com",
    };
  }

  if (url.startsWith("/api/storage/") || url.startsWith("/builtin/")) {
    return { ok: true, kind: "storage", url };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      error: `Invalid URL "${url.slice(0, 80)}". Prefer builtin:<key> or https://assets.grudge-studio.com/…`,
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: `Unsupported protocol ${parsed.protocol}` };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local") ||
    host.includes("replit")
  ) {
    return {
      ok: false,
      error: "Localhost / Replit URLs are not allowed in production scenes",
    };
  }

  if (host === "assets.grudge-studio.com") {
    // Canonicalize: if this CDN path maps to a builtin key, prefer durable key
    const path = parsed.pathname.replace(/^\//, "");
    for (const [key, resolved] of Object.entries(BUILTIN_MODELS)) {
      if (typeof resolved === "string" && resolved.includes(path) && path.length > 8) {
        // only rewrite when exact file match
        if (resolved === url || resolved.endsWith(parsed.pathname)) {
          return { ok: true, kind: "builtin", url: `builtin:${key}` };
        }
      }
    }
    return { ok: true, kind: "cdn", url: parsed.toString() };
  }

  if (host === "cdn.polyhaven.com" || host === "dl.polyhaven.org") {
    return { ok: true, kind: "polyhaven", url: parsed.toString() };
  }

  if (ALLOWED_ASSET_HOSTS.has(host)) {
    return { ok: true, kind: "cdn", url: parsed.toString() };
  }

  return {
    ok: false,
    error:
      `Host "${host}" is not allowlisted. Use builtin:<key>, https://assets.grudge-studio.com/…, or Poly Haven CDN.`,
  };
}

/** Assert URL for AI tool executors — returns normalized url or throws error string. */
export function requireAgentAssetUrl(raw: string | null | undefined): string {
  const c = checkAssetUrl(raw);
  if (!c.ok) throw new Error(c.error);
  return c.url;
}

/** True if a resolved runtime URL is safe to load (after builtin expansion). */
export function isRuntimeLoadAllowed(resolvedUrl: string): boolean {
  if (resolvedUrl.startsWith("data:") || resolvedUrl.startsWith("blob:")) return true;
  if (resolvedUrl.startsWith("/") && !resolvedUrl.startsWith("//")) return true;
  try {
    const u = new URL(resolvedUrl);
    if (u.hostname === "assets.grudge-studio.com") return true;
    if (u.hostname === "cdn.polyhaven.com" || u.hostname === "dl.polyhaven.org") return true;
    // same-origin relative already handled
    return ALLOWED_ASSET_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Production-safe resolve: expand builtin, then optionally warn/block bad hosts.
 * Used by EntityRenderer path via resolveModelUrl enhancement.
 */
export function assertResolvedAssetUrl(url: string): string {
  const builtin = resolveBuiltinModel(url);
  if (builtin) {
    if (!isRuntimeLoadAllowed(builtin) && !builtin.startsWith("/")) {
      // relative builtin paths under /builtin/ are OK after base join
    }
    return builtin;
  }
  if (url.startsWith("builtin:")) {
    throw new Error(`Unknown builtin model (policy): ${url}`);
  }
  const check = checkAssetUrl(url);
  if (!check.ok) {
    // Allow relative public paths (BASE_URL + file)
    if (!url.startsWith("http") && !url.startsWith("blob:") && !url.startsWith("data:")) {
      return url;
    }
    throw new Error(check.error);
  }
  return check.url.startsWith("builtin:")
    ? resolveBuiltinModel(check.url) ?? check.url
    : check.url;
}
