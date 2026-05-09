import characterUrl from "@/assets/models/character.glb?url";
import rifleUrl from "@/assets/models/rifle.glb?url";
import { getRaceCharacterUrl } from "./objectStoreApi";
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
  // Per-race default weapon slots — the toon-rts-characters asset pack's
  // weapon sub-pack (sword/bow/axe/mace/club/staff) is referenced in the
  // manifest but no GLB files are actually deployed at the CDN under
  // `…/glb/weapons/<weapon>.glb` (every URL 404s, verified by HEAD probe).
  // Production was crash-looping on these missing fetches from the
  // rpg-village template, so each race-weapon key is aliased to the
  // bundled `rifle.glb` placeholder until the upstream pack ships real
  // per-race weapon meshes. Saved scenes still reference the durable
  // `builtin:race-weapon:<id>` key, so the day real weapons ship the only
  // change needed is to swap these six URLs back to `getRaceWeaponUrl(...)`.
  "race-weapon:warrior": ensureBaseUrl(rifleUrl),
  "race-weapon:dwarf": ensureBaseUrl(rifleUrl),
  "race-weapon:frost-dwarf": ensureBaseUrl(rifleUrl),
  "race-weapon:elf": ensureBaseUrl(rifleUrl),
  "race-weapon:orc": ensureBaseUrl(rifleUrl),
  "race-weapon:skeleton": ensureBaseUrl(rifleUrl),
};

/** Per-builtin-model Y rotation offset (radians) applied at render time
 *  inside the entity's rigidbody/group, so the visual model faces the
 *  same direction as the physics body's "forward". The toon-rts character
 *  GLBs (the six `race:*` keys below) were authored facing +Z, while
 *  three.js' convention — and our physics yaw + camera forward — assume
 *  -Z, so they need a half-turn to look the right way. The original
 *  `builtin:character` rig already faces -Z, so it is intentionally
 *  absent from this map (its effective offset is 0). EntityRenderer's
 *  resolution order is: `entity.model.yawOffset` ?? this map ?? 0. */
export const BUILTIN_MODEL_YAW_OFFSETS: Record<string, number> = {
  "race:warrior": Math.PI,
  "race:dwarf": Math.PI,
  "race:frost-dwarf": Math.PI,
  "race:elf": Math.PI,
  "race:orc": Math.PI,
  "race:skeleton": Math.PI,
};

/** Per-race animation clip names used by the player camera controllers
 *  and the `enemy-rpg` behavior to drive the `__agentClips` crossfade
 *  bridge in `EntityRenderer.LoadedModel`.
 *
 *  Verified by direct CDN probe (parsing the JSON chunk of every GLB
 *  under `…/glb/characters/{human,dwarf,barbarian,elf,orc,undead}.glb`)
 *  that the public toon-rts character pack ships with **zero** baked
 *  animations on each rig — `gltf.animations.length === 0` for all six
 *  files (~0.83–1.07 MB each). The manifest references separate
 *  `animationsweapons/male_locomotion/` packs but those URLs return 404
 *  on the same host today.
 *
 *  Workaround: `LoadedModel` calls `synthesizeBipedClips(gltf.scene)`
 *  whenever a GLB has zero baked clips AND its rig matches the Max
 *  biped naming convention (`Bip001 Pelvis / R UpperArm / L Thigh`).
 *  That synthesizer emits `idle / walk / run / attack` AnimationClips
 *  procedurally against the shared skeleton, which the names below
 *  point at. Once the asset pack re-exports real locomotion clips
 *  into the character GLBs, the synthesizer becomes a silent no-op
 *  (the GLB-baked clips win) and these names continue to resolve.
 *
 *  The drift guard test in `__tests__/builtinModels.test.ts` enforces
 *  the equivalent embedded table in the enemy-rpg behavior string
 *  stays consistent. */
export interface RaceClipSet {
  /** Clip names. Empty string `""` means "no verified clip in the GLB
   *  yet — skip publishing"; writer sites must guard with `if (!clip)`. */
  idle: string;
  walk: string;
  run: string;
  attack?: string;
  death?: string;
}
// Names mirror `PROCEDURAL_BIPED_CLIP_NAMES` in `proceduralBipedAnimations.ts`.
// `death` resolves to the procedural one-shot collapse pose (the renderer
// detects the "death" clip name and switches the AnimationAction to
// LoopOnce + clampWhenFinished so the final pose holds).
export const BUILTIN_MODEL_CLIPS: Record<string, RaceClipSet> = {
  "race:warrior":     { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  "race:dwarf":       { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  "race:frost-dwarf": { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  "race:elf":         { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  "race:orc":         { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  "race:skeleton":    { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
};

/** Look up the clip set for an entity's `raceId`. Returns undefined for
 *  entities with no race (e.g. the legacy `builtin:character` player) so
 *  callers can skip the `__agentClips` write and let LoadedModel's
 *  idle/loop heuristic pick a clip. */
export function getRaceClips(raceId: string | undefined | null): RaceClipSet | undefined {
  if (!raceId) return undefined;
  return BUILTIN_MODEL_CLIPS[`race:${raceId}`];
}

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
