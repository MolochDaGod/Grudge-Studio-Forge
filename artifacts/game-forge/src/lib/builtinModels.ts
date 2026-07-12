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
  // RTS-Grudge Underground Wars PvP arena — R2 only (too large for SPA git bundle)
  "map-underground-wars": "https://assets.grudge-studio.com/builtin/map-underground-wars.glb",
  "map-yard": ensureBaseUrl("builtin/map-yard.glb"),
  "map-winter-base": ensureBaseUrl("builtin/map-winter-base.glb"),
  "forge-scene": ensureBaseUrl("builtin/forge-scene.glb"),
  // Characters / monsters
  "char-lava-sancho": ensureBaseUrl("builtin/char-lava-sancho.glb"),
  "char-boss-orc": ensureBaseUrl("builtin/char-boss-orc.glb"),
  "char-distortus-rex": ensureBaseUrl("builtin/char-distortus-rex.glb"),
  "char-crow": ensureBaseUrl("builtin/char-crow.glb"),
  // VFX / effects
  "vfx-fire-hurricane": ensureBaseUrl("builtin/vfx-fire-hurricane.glb"),
  "vfx-explosion-a": ensureBaseUrl("builtin/vfx-explosion-a.glb"),
  "vfx-explosion-b": ensureBaseUrl("builtin/vfx-explosion-b.glb"),
  "vfx-fire-anim": ensureBaseUrl("builtin/vfx-fire-anim.glb"),
  "vfx-freeze": ensureBaseUrl("builtin/vfx-freeze.glb"),
  // Survivor / skeleton characters
  "char-survivor-male": ensureBaseUrl("builtin/char-survivor-male.glb"),
  "char-skeleton-axe": ensureBaseUrl("builtin/char-skeleton-axe.glb"),
  "char-skeleton-sword": ensureBaseUrl("builtin/char-skeleton-sword.glb"),
  // Animations (standalone clips)
  "anim-sweep-fall": ensureBaseUrl("builtin/anim-sweep-fall.glb"),
  "anim-swimming-to-edge": ensureBaseUrl("builtin/anim-swimming-to-edge.glb"),
  "anim-swimming": ensureBaseUrl("builtin/anim-swimming.glb"),
  // Props
  "prop-survivors-tent": ensureBaseUrl("builtin/prop-survivors-tent.glb"),
  // Modern-era characters (shooters / post-apocalyptic)
  "char-bandit": ensureBaseUrl("builtin/char-bandit.glb"),
  "char-ncr-ranger": ensureBaseUrl("builtin/char-ncr-ranger.glb"),
  // Grudge 6-race locomotion pack (12 clips)
  "loco-idle": ensureBaseUrl("builtin/loco-idle.glb"),
  "loco-walking": ensureBaseUrl("builtin/loco-walking.glb"),
  "loco-running": ensureBaseUrl("builtin/loco-running.glb"),
  "loco-jump": ensureBaseUrl("builtin/loco-jump.glb"),
  "loco-left-strafe": ensureBaseUrl("builtin/loco-left-strafe.glb"),
  "loco-right-strafe": ensureBaseUrl("builtin/loco-right-strafe.glb"),
  "loco-left-strafe-walking": ensureBaseUrl("builtin/loco-left-strafe-walking.glb"),
  "loco-right-strafe-walking": ensureBaseUrl("builtin/loco-right-strafe-walking.glb"),
  "loco-left-turn": ensureBaseUrl("builtin/loco-left-turn.glb"),
  "loco-right-turn": ensureBaseUrl("builtin/loco-right-turn.glb"),
  "loco-left-turn-90": ensureBaseUrl("builtin/loco-left-turn-90.glb"),
  "loco-right-turn-90": ensureBaseUrl("builtin/loco-right-turn-90.glb"),
  // Grudge 6-race magic locomotion pack (16 clips — casting stance movement)
  "magic-standing-idle": ensureBaseUrl("builtin/magic-standing-idle.glb"),
  "magic-standing-jump": ensureBaseUrl("builtin/magic-standing-jump.glb"),
  "magic-standing-jump-running": ensureBaseUrl("builtin/magic-standing-jump-running.glb"),
  "magic-standing-jump-running-landing": ensureBaseUrl("builtin/magic-standing-jump-running-landing.glb"),
  "magic-standing-land-to-standing-idle": ensureBaseUrl("builtin/magic-standing-land-to-standing-idle.glb"),
  "magic-standing-run-forward": ensureBaseUrl("builtin/magic-standing-run-forward.glb"),
  "magic-standing-run-back": ensureBaseUrl("builtin/magic-standing-run-back.glb"),
  "magic-standing-run-left": ensureBaseUrl("builtin/magic-standing-run-left.glb"),
  "magic-standing-run-right": ensureBaseUrl("builtin/magic-standing-run-right.glb"),
  "magic-standing-sprint-forward": ensureBaseUrl("builtin/magic-standing-sprint-forward.glb"),
  "magic-standing-walk-forward": ensureBaseUrl("builtin/magic-standing-walk-forward.glb"),
  "magic-standing-walk-back": ensureBaseUrl("builtin/magic-standing-walk-back.glb"),
  "magic-standing-walk-left": ensureBaseUrl("builtin/magic-standing-walk-left.glb"),
  "magic-standing-walk-right": ensureBaseUrl("builtin/magic-standing-walk-right.glb"),
  "magic-standing-turn-left-90": ensureBaseUrl("builtin/magic-standing-turn-left-90.glb"),
  "magic-standing-turn-right-90": ensureBaseUrl("builtin/magic-standing-turn-right-90.glb"),
  // Stylized nature packs
  "nature-tree-pack": ensureBaseUrl("builtin/nature-tree-pack.glb"),
  "nature-tropical-pack": ensureBaseUrl("builtin/nature-tropical-pack.glb"),
  "nature-autumn-trees": ensureBaseUrl("builtin/nature-autumn-trees.glb"),
  "nature-tree": ensureBaseUrl("builtin/nature-tree.glb"),
  "nature-icicles": ensureBaseUrl("builtin/nature-icicles.glb"),
  // Stylized characters/creatures
  "char-wolf": ensureBaseUrl("builtin/char-wolf.glb"),
  "char-shark": ensureBaseUrl("builtin/char-shark.glb"),
  "anim-combat-demo": ensureBaseUrl("builtin/anim-combat-demo.glb"),
  // Stylized buildings
  "bldg-woodcutter-hut": ensureBaseUrl("builtin/bldg-woodcutter-hut.glb"),
  "bldg-tavern": ensureBaseUrl("builtin/bldg-tavern.glb"),
  // Stylized props/items
  "prop-crystal-gems": ensureBaseUrl("builtin/prop-crystal-gems.glb"),
  "prop-medieval": ensureBaseUrl("builtin/prop-medieval.glb"),
  "prop-survival-items": ensureBaseUrl("builtin/prop-survival-items.glb"),
  "prop-toon-weapons": ensureBaseUrl("builtin/prop-toon-weapons.glb"),
  "mat-sand-procedural": ensureBaseUrl("builtin/mat-sand-procedural.glb"),
  // Stylized VFX
  "vfx-stylized-fire": ensureBaseUrl("builtin/vfx-stylized-fire.glb"),
  "vfx-stylized-fire-tornado": ensureBaseUrl("builtin/vfx-stylized-fire-tornado.glb"),
  // Maps
  "map-pirate-island": ensureBaseUrl("builtin/map-pirate-island.glb"),
  "map-chinese-market": ensureBaseUrl("builtin/map-chinese-market.glb"),
  "map-dude-theft-city": ensureBaseUrl("builtin/map-dude-theft-city.glb"),
  // Chicken Gun maps — hosted on R2 CDN (too large to ship in git)
  "map-mistytown": "https://assets.grudge-studio.com/builtin/map-mistytown.glb",
  "map-town2f": "https://assets.grudge-studio.com/builtin/map-town2f.glb",
  "map-bigfarm": "https://assets.grudge-studio.com/builtin/map-bigfarm.glb",
  "map-western": "https://assets.grudge-studio.com/builtin/map-western.glb",
  // Vehicles (Realistic Car Pack — OBJ→GLB conversion)
  "vehicle-cop": ensureBaseUrl("builtin/vehicle-cop.glb"),
  "vehicle-sedan": ensureBaseUrl("builtin/vehicle-sedan.glb"),
  "vehicle-sedan-2": ensureBaseUrl("builtin/vehicle-sedan-2.glb"),
  "vehicle-sports": ensureBaseUrl("builtin/vehicle-sports.glb"),
  "vehicle-sports-2": ensureBaseUrl("builtin/vehicle-sports-2.glb"),
  "vehicle-suv": ensureBaseUrl("builtin/vehicle-suv.glb"),
  "vehicle-taxi": ensureBaseUrl("builtin/vehicle-taxi.glb"),
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
  // RTS creeps — production template `rts-fort-royale` references
  // `builtin:creature:mutant`. There is no mutant GLB on CDN; alias to
  // skeleton race (absolute CDN URL, always loads) so play mode never
  // 404-crashes Suspense with "not valid JSON" from the SPA fallback.
  "creature:mutant": ensureBaseUrl(getRaceCharacterUrl("skeleton")),
  "creature:creep": ensureBaseUrl(getRaceCharacterUrl("skeleton")),
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

/** Public R2/CDN prefix for large builtins that are not shipped in the SPA. */
export const BUILTIN_R2_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ?.VITE_BUILTIN_CDN) ||
  "https://assets.grudge-studio.com/builtin";

/** Keys that only exist on R2 (never fall back to /builtin/<key>.glb SPA path). */
const R2_ONLY_KEYS = new Set([
  "map-underground-wars",
  "map-mistytown",
  "map-town2f",
  "map-bigfarm",
  "map-western",
]);

/** Never put `:` in R2 object keys — `creature:mutant.glb` is not a valid path
 *  and always 404s, crashing the viewport ErrorBoundary. */
const r2Url = (key: string) =>
  `${BUILTIN_R2_BASE.replace(/\/+$/, "")}/${key.replace(/:/g, "-")}.glb`;

/** Absolute skeleton race GLB — safe fallback for missing RTS creeps etc. */
function skeletonFallbackUrl(): string {
  const known = BUILTIN_MODELS["race:skeleton"];
  if (known && /^https?:\/\//i.test(known)) return known;
  return getRaceCharacterUrl("skeleton");
}

/**
 * Rewrite known-broken absolute CDN / R2 URLs that production templates and
 * older SPA builds still produce (e.g. …/builtin/creature:mutant.glb → 404).
 * Must run before useGLTF so the viewport never fetches a dead object key.
 */
export function rewriteBrokenModelUrl(url: string): string | null {
  if (!url) return null;
  // Literal or encoded colon in creature mutant path
  if (
    /\/builtin\/creature:mutant\.glb/i.test(url) ||
    /\/builtin\/creature%3Amutant\.glb/i.test(url) ||
    /\/builtin\/creature-mutant\.glb/i.test(url) ||
    url === "builtin:creature:mutant" ||
    url.endsWith("creature:mutant.glb")
  ) {
    return skeletonFallbackUrl();
  }
  if (
    /\/builtin\/creature:creep\.glb/i.test(url) ||
    url === "builtin:creature:creep"
  ) {
    return skeletonFallbackUrl();
  }
  return null;
}

/** Resolve `"builtin:foo"` → real URL. Returns null if not a builtin key. */
export function resolveBuiltinModel(url: string): string | null {
  const rewritten = rewriteBrokenModelUrl(url);
  if (rewritten) return rewritten;

  if (!url.startsWith("builtin:")) return null;
  const key = url.slice("builtin:".length);

  // Registry hit — prefer absolute CDN URLs (races, large maps on R2).
  // Relative SPA paths (`/builtin/foo.glb`) stay on the forge origin so
  // demos work even when the asset is not mirrored to assets.grudge-studio.com.
  const known = BUILTIN_MODELS[key];
  if (known) {
    if (/^https?:\/\//i.test(known)) return known;
    // Large map keys that only live on R2 (even if registry has a relative stub).
    if (R2_ONLY_KEYS.has(key)) return r2Url(key);
    return known;
  }

  // Tiny Vite-bundled assets stay on the SPA host.
  if (key === "character" || key === "rifle") {
    return ensureBaseUrl(key === "character" ? characterUrl : rifleUrl);
  }

  // Soft-resolve unknown keys so API templates one deploy ahead of the SPA
  // still load. Prefer CDN for maps; same-origin /builtin/ for the rest.
  if (R2_ONLY_KEYS.has(key) || key.startsWith("map-")) {
    return r2Url(key);
  }

  // creature:* with no registry entry → skeleton (never R2 creature:*.glb)
  if (key.startsWith("creature:") || key.startsWith("creature-")) {
    return skeletonFallbackUrl();
  }

  if (
    key.startsWith("char-") ||
    key.startsWith("vfx-") ||
    key.startsWith("prop-") ||
    key.startsWith("bldg-") ||
    key.startsWith("vehicle-") ||
    key.startsWith("nature-") ||
    key.startsWith("loco-") ||
    key.startsWith("magic-") ||
    key.startsWith("anim-")
  ) {
    return ensureBaseUrl(`builtin/${key}.glb`);
  }
  return null;
}

/** Resolve a model URL for GLTF loaders. Order:
 *   1. Rewrite known-broken absolute CDN paths (mutant creep 404s)
 *   2. `builtin:<key>` → bundled / CDN asset URL
 *   3. absolute http(s)/data/blob → returned as-is
 *   4. anything else → relative to the artifact BASE_URL
 *
 *  Unknown `builtin:` keys must NOT fall through to SPA HTML (drei then
 *  throws "<!doctype … is not valid JSON"). */
export function resolveModelUrl(url: string): string {
  const rewritten = rewriteBrokenModelUrl(url);
  if (rewritten) return rewritten;

  const builtin = resolveBuiltinModel(url);
  if (builtin) return builtin;
  if (url.startsWith("builtin:")) {
    const key = url.slice("builtin:".length);
    const fallback = skeletonFallbackUrl();
    console.warn(
      `[Forge] Unknown builtin "${key}" — using skeleton placeholder. Register it in BUILTIN_MODELS.`,
    );
    return fallback;
  }
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
    // Last chance: still rewrite broken absolute URLs that slipped through
    const again = rewriteBrokenModelUrl(url);
    return again ?? url;
  }
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${url.replace(/^\/+/, "")}`;
}
