import characterUrl from "@/assets/models/character.glb?url";
import rifleUrl from "@/assets/models/rifle.glb?url";

/** Vite quirk: in dev mode `?url` returns a source path like
 *  `/src/assets/models/character.glb` WITHOUT the `base` prefix, while in a
 *  production build it returns the hashed asset path WITH the prefix. Under
 *  path-based routing the proxy only forwards URLs under our base, so we
 *  re-prepend BASE_URL when the resolved URL doesn't already include it. */
function ensureBaseUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = import.meta.env.BASE_URL || "/";
  if (base !== "/" && url.startsWith(base)) return url;
  return `${base}${url.replace(/^\/+/, "")}`;
}

/** Registry of GLB assets bundled with GameForge. Scene data stores stable
 *  keys (e.g. `"builtin:character"`); EntityRenderer resolves them to the
 *  real URL at render time so saved scenes survive rebuilds and work under
 *  path-based routing in dev + prod. */
export const BUILTIN_MODELS: Record<string, string> = {
  character: ensureBaseUrl(characterUrl),
  rifle: ensureBaseUrl(rifleUrl),
};

export const BUILTIN_MODEL_KEY = (key: keyof typeof BUILTIN_MODELS | string) =>
  `builtin:${key}`;

/** Resolve `"builtin:foo"` → real URL. Returns null if not a builtin key. */
export function resolveBuiltinModel(url: string): string | null {
  if (!url.startsWith("builtin:")) return null;
  const key = url.slice("builtin:".length);
  return BUILTIN_MODELS[key] ?? null;
}
