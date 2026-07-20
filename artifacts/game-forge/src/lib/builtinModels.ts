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
  // RTS-Grudge Underground Wars PvP arena — hosted on R2 (too large for Vite git bundle)
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
  // Per-race weapons — grudge6 library on CDN (toon-rts weapons/* 404).
  // Durable keys: builtin:race-weapon:<id>
  "race-weapon:warrior": ensureBaseUrl(getRaceWeaponUrl("warrior")),
  "race-weapon:dwarf": ensureBaseUrl(getRaceWeaponUrl("dwarf")),
  "race-weapon:frost-dwarf": ensureBaseUrl(getRaceWeaponUrl("frost-dwarf")),
  "race-weapon:elf": ensureBaseUrl(getRaceWeaponUrl("elf")),
  "race-weapon:orc": ensureBaseUrl(getRaceWeaponUrl("orc")),
  "race-weapon:skeleton": ensureBaseUrl(getRaceWeaponUrl("skeleton")),
  // Template aliases (rts-fort-royale creeps / bosses)
  "creature:mutant": ensureBaseUrl("builtin/char-distortus-rex.glb"),
  "creature:creep": ensureBaseUrl(getRaceCharacterUrl("skeleton")),
  "creature:boss-orc": ensureBaseUrl("builtin/char-boss-orc.glb"),
  // RTS building pack — orc settlement + battle towers on the public CDN
  // (same assets used by RTS-Grudge). Durable `builtin:rts-bldg-*` keys so
  // scenes never bake raw CDN paths.
  "rts-bldg-townhall": "https://assets.grudge-studio.com/models/orc_settlement/Tavern.glb",
  "rts-bldg-barracks": "https://assets.grudge-studio.com/models/orc_settlement/Smithy.glb",
  "rts-bldg-farm": "https://assets.grudge-studio.com/models/orc_settlement/Dwelling_Hut.glb",
  "rts-bldg-mill": "https://assets.grudge-studio.com/models/orc_settlement/Brewery.glb",
  "rts-bldg-alchemy": "https://assets.grudge-studio.com/models/orc_settlement/Alchemist_House.glb",
  "rts-bldg-bakery": "https://assets.grudge-studio.com/models/orc_settlement/Bakery.glb",
  "rts-bldg-tent": "https://assets.grudge-studio.com/models/orc_settlement/Tent_Large.glb",
  "rts-bldg-prison": "https://assets.grudge-studio.com/models/orc_settlement/Prison.glb",
  "rts-bldg-fountain": "https://assets.grudge-studio.com/models/orc_settlement/Fountain_Large.glb",
  "rts-tower-archer": "https://assets.grudge-studio.com/models/battle_towers/Archer_Tower_L1.glb",
  "rts-tower-fire": "https://assets.grudge-studio.com/models/battle_towers/Fire_Tower_L1.glb",
  "rts-tower-ballista": "https://assets.grudge-studio.com/models/battle_towers/Ballista_Tower_L1.glb",
  "rts-tower-cannon": "https://assets.grudge-studio.com/models/battle_towers/Cannon_Tower_L1.glb",
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

/** Resolve a model URL for GLTF loaders. Order:
 *   1. `builtin:<key>` → bundled / CDN asset URL
 *   2. absolute http(s)/data/blob → returned as-is
 *   3. anything else → relative to the artifact BASE_URL
 *
 *  Unknown `builtin:` keys must NOT fall through to (3) — Vercel's SPA
 *  catch-all would return `index.html` and drei would try to parse it as
 *  GLB JSON, producing the opaque "<!doctype … is not valid JSON" error. */
export function resolveModelUrl(url: string): string {
  const builtin = resolveBuiltinModel(url);
  if (builtin) return builtin;
  if (url.startsWith("builtin:")) {
    const key = url.slice("builtin:".length);
    throw new Error(
      `Unknown builtin model "${key}". Register it in BUILTIN_MODELS (lib/builtinModels.ts) or update the scene to use a valid builtin: key.`,
    );
  }
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const base = import.meta.env.BASE_URL || "/";
  return `${base}${url.replace(/^\/+/, "")}`;
}
