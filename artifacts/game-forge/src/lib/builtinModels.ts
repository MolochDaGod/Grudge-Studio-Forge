import characterUrl from "@/assets/models/character.glb?url";
import rifleUrl from "@/assets/models/rifle.glb?url";
import { getRaceCharacterUrl, getRaceWeaponUrl } from "./objectStoreApi";
import type { RaceId } from "./races";

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
 *  path-based routing in dev + prod.
 *
 *  Two flavors live here:
 *   - Vite imports (`character`, `rifle`) — small enough to bundle.
 *   - public/builtin/*.glb (Blake + VFX) — too large to ship through Vite's
 *     asset graph, so they live in `public/` and are served as static files
 *     under the artifact's base path. */
export const BUILTIN_MODELS: Record<string, string> = {
  character: ensureBaseUrl(characterUrl),
  rifle: ensureBaseUrl(rifleUrl),
  blake: ensureBaseUrl("builtin/blake.glb"),
  "vfx-leaves": ensureBaseUrl("builtin/vfx-leaves.glb"),
  "vfx-trail": ensureBaseUrl("builtin/vfx-trail.glb"),
  "vfx-effect": ensureBaseUrl("builtin/vfx-effect.glb"),
  "vfx-circuits": ensureBaseUrl("builtin/vfx-circuits.glb"),
  "vfx-tornado": ensureBaseUrl("builtin/vfx-tornado.glb"),
  "vfx-warning": ensureBaseUrl("builtin/vfx-warning.glb"),
  "map-cyberpunk": ensureBaseUrl("builtin/map-cyberpunk.glb"),
  "map-encampment": ensureBaseUrl("builtin/map-encampment.glb"),
  "map-deserttown": ensureBaseUrl("builtin/map-deserttown.glb"),
  "map-fort-royale": ensureBaseUrl("builtin/map-fort-royale.glb"),
  "map-yard": ensureBaseUrl("builtin/map-yard.glb"),
  "map-winter-base": ensureBaseUrl("builtin/map-winter-base.glb"),
  // Per-race character GLBs from the toon-rts-characters asset pack
  // (CDN, absolute https URL — `ensureBaseUrl` is a no-op for these).
  // Saved scenes reference these via the durable `builtin:race:<id>` key
  // so we never bake CDN URLs into scene JSON.
  "race:warrior": ensureBaseUrl(getRaceCharacterUrl("warrior")),
  "race:dwarf": ensureBaseUrl(getRaceCharacterUrl("dwarf")),
  "race:frost-dwarf": ensureBaseUrl(getRaceCharacterUrl("frost-dwarf")),
  "race:elf": ensureBaseUrl(getRaceCharacterUrl("elf")),
  "race:orc": ensureBaseUrl(getRaceCharacterUrl("orc")),
  "race:skeleton": ensureBaseUrl(getRaceCharacterUrl("skeleton")),
  // Per-race default weapon GLBs from the same toon-rts-characters asset
  // pack (sword/bow/axe/mace/club — see RACE_WEAPON in objectStoreApi.ts).
  // Saved scenes reference these via the durable `builtin:race-weapon:<id>`
  // key so the rpg-village template stays portable when new weapon variants
  // ship in the asset pack.
  "race-weapon:warrior": ensureBaseUrl(getRaceWeaponUrl("warrior")),
  "race-weapon:dwarf": ensureBaseUrl(getRaceWeaponUrl("dwarf")),
  "race-weapon:frost-dwarf": ensureBaseUrl(getRaceWeaponUrl("frost-dwarf")),
  "race-weapon:elf": ensureBaseUrl(getRaceWeaponUrl("elf")),
  "race-weapon:orc": ensureBaseUrl(getRaceWeaponUrl("orc")),
  "race-weapon:skeleton": ensureBaseUrl(getRaceWeaponUrl("skeleton")),
};

export const BUILTIN_MODEL_KEY = (key: keyof typeof BUILTIN_MODELS | string) =>
  `builtin:${key}`;

/** Stable scene-JSON key for a per-race character model.
 *  Saved scenes use this string (e.g. `"builtin:race:orc"`) instead of
 *  the CDN URL so they stay portable across asset-pack versions. */
export function getRaceModelKey(race: RaceId): `builtin:race:${RaceId}` {
  return `builtin:race:${race}` as const;
}

/** Resolve `"builtin:foo"` → real URL. Returns null if not a builtin key. */
export function resolveBuiltinModel(url: string): string | null {
  if (!url.startsWith("builtin:")) return null;
  const key = url.slice("builtin:".length);
  return BUILTIN_MODELS[key] ?? null;
}
