import characterUrl from "@/assets/models/character.glb?url";
import rifleUrl from "@/assets/models/rifle.glb?url";
import {
  getRaceCharacterUrl,
  getRaceKitUrl,
  getRaceWeaponUrl,
} from "./objectStoreApi";
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

/**
 * Production builtins MUST load from R2 CDN — never SPA-relative `/builtin/…`.
 * Vercel SPA catch-all returns index.html for missing paths; drei fails and
 * the editor shows wireframe boxes ("everything is shapes").
 */
export const ASSETS_CDN_ORIGIN = "https://assets.grudge-studio.com";

function cdnBuiltin(fileName: string): string {
  const name = fileName.replace(/^\/+/, "").replace(/^builtin\//, "");
  return `${ASSETS_CDN_ORIGIN}/builtin/${name}`;
}

/** Registry of GLB assets bundled with GameForge. Scene data stores stable
 *  keys (e.g. `"builtin:character"`); EntityRenderer resolves them to the
 *  real URL at render time so saved scenes survive rebuilds and work under
 *  path-based routing in dev + prod.
 *
 *  Flavors:
 *   - Vite imports (`character`, `rifle`) — small enough to bundle (hashed /assets).
 *   - Everything else → https://assets.grudge-studio.com/builtin/… (R2). */
export const BUILTIN_MODELS: Record<string, string> = {
  character: ensureBaseUrl(characterUrl),
  rifle: ensureBaseUrl(rifleUrl),
  blake: cdnBuiltin("blake.glb"),
  "vfx-leaves": cdnBuiltin("vfx-leaves.glb"),
  "vfx-trail": cdnBuiltin("vfx-trail.glb"),
  "vfx-effect": cdnBuiltin("vfx-effect.glb"),
  "vfx-circuits": cdnBuiltin("vfx-circuits.glb"),
  "vfx-tornado": cdnBuiltin("vfx-tornado.glb"),
  "vfx-warning": cdnBuiltin("vfx-warning.glb"),
  "map-cyberpunk": cdnBuiltin("map-cyberpunk.glb"),
  "map-encampment": cdnBuiltin("map-encampment.glb"),
  "map-deserttown": cdnBuiltin("map-deserttown.glb"),
  "map-fort-royale": cdnBuiltin("map-fort-royale.glb"),
  // RTS-Grudge Underground Wars PvP arena â€” hosted on R2 (too large for Vite git bundle)
  "map-underground-wars": "https://assets.grudge-studio.com/builtin/map-underground-wars.glb",
  "map-yard": cdnBuiltin("map-yard.glb"),
  "map-winter-base": cdnBuiltin("map-winter-base.glb"),
  "forge-scene": cdnBuiltin("forge-scene.glb"),
  // Characters / monsters
  "char-lava-sancho": cdnBuiltin("char-lava-sancho.glb"),
  "char-boss-orc": cdnBuiltin("char-boss-orc.glb"),
  "char-distortus-rex": cdnBuiltin("char-distortus-rex.glb"),
  "char-crow": cdnBuiltin("char-crow.glb"),
  // VFX / effects
  "vfx-fire-hurricane": cdnBuiltin("vfx-fire-hurricane.glb"),
  "vfx-explosion-a": cdnBuiltin("vfx-explosion-a.glb"),
  "vfx-explosion-b": cdnBuiltin("vfx-explosion-b.glb"),
  "vfx-fire-anim": cdnBuiltin("vfx-fire-anim.glb"),
  "vfx-freeze": cdnBuiltin("vfx-freeze.glb"),
  // Survivor / skeleton characters
  "char-survivor-male": cdnBuiltin("char-survivor-male.glb"),
  "char-skeleton-axe": cdnBuiltin("char-skeleton-axe.glb"),
  "char-skeleton-sword": cdnBuiltin("char-skeleton-sword.glb"),
  // Animations (standalone clips)
  "anim-sweep-fall": cdnBuiltin("anim-sweep-fall.glb"),
  "anim-swimming-to-edge": cdnBuiltin("anim-swimming-to-edge.glb"),
  "anim-swimming": cdnBuiltin("anim-swimming.glb"),
  // Props
  "prop-survivors-tent": cdnBuiltin("prop-survivors-tent.glb"),
  // Modern-era characters (shooters / post-apocalyptic)
  "char-bandit": cdnBuiltin("char-bandit.glb"),
  "char-ncr-ranger": cdnBuiltin("char-ncr-ranger.glb"),
  // Grudge 6-race locomotion pack (12 clips)
  "loco-idle": cdnBuiltin("loco-idle.glb"),
  "loco-walking": cdnBuiltin("loco-walking.glb"),
  "loco-running": cdnBuiltin("loco-running.glb"),
  "loco-jump": cdnBuiltin("loco-jump.glb"),
  "loco-left-strafe": cdnBuiltin("loco-left-strafe.glb"),
  "loco-right-strafe": cdnBuiltin("loco-right-strafe.glb"),
  "loco-left-strafe-walking": cdnBuiltin("loco-left-strafe-walking.glb"),
  "loco-right-strafe-walking": cdnBuiltin("loco-right-strafe-walking.glb"),
  "loco-left-turn": cdnBuiltin("loco-left-turn.glb"),
  "loco-right-turn": cdnBuiltin("loco-right-turn.glb"),
  "loco-left-turn-90": cdnBuiltin("loco-left-turn-90.glb"),
  "loco-right-turn-90": cdnBuiltin("loco-right-turn-90.glb"),
  // Grudge 6-race magic locomotion pack (16 clips â€” casting stance movement)
  "magic-standing-idle": cdnBuiltin("magic-standing-idle.glb"),
  "magic-standing-jump": cdnBuiltin("magic-standing-jump.glb"),
  "magic-standing-jump-running": cdnBuiltin("magic-standing-jump-running.glb"),
  "magic-standing-jump-running-landing": cdnBuiltin("magic-standing-jump-running-landing.glb"),
  "magic-standing-land-to-standing-idle": cdnBuiltin("magic-standing-land-to-standing-idle.glb"),
  "magic-standing-run-forward": cdnBuiltin("magic-standing-run-forward.glb"),
  "magic-standing-run-back": cdnBuiltin("magic-standing-run-back.glb"),
  "magic-standing-run-left": cdnBuiltin("magic-standing-run-left.glb"),
  "magic-standing-run-right": cdnBuiltin("magic-standing-run-right.glb"),
  "magic-standing-sprint-forward": cdnBuiltin("magic-standing-sprint-forward.glb"),
  "magic-standing-walk-forward": cdnBuiltin("magic-standing-walk-forward.glb"),
  "magic-standing-walk-back": cdnBuiltin("magic-standing-walk-back.glb"),
  "magic-standing-walk-left": cdnBuiltin("magic-standing-walk-left.glb"),
  "magic-standing-walk-right": cdnBuiltin("magic-standing-walk-right.glb"),
  "magic-standing-turn-left-90": cdnBuiltin("magic-standing-turn-left-90.glb"),
  "magic-standing-turn-right-90": cdnBuiltin("magic-standing-turn-right-90.glb"),
  // Stylized nature packs
  "nature-tree-pack": cdnBuiltin("nature-tree-pack.glb"),
  "nature-tropical-pack": cdnBuiltin("nature-tropical-pack.glb"),
  "nature-autumn-trees": cdnBuiltin("nature-autumn-trees.glb"),
  "nature-tree": cdnBuiltin("nature-tree.glb"),
  "nature-icicles": cdnBuiltin("nature-icicles.glb"),
  // Stylized characters/creatures
  "char-wolf": cdnBuiltin("char-wolf.glb"),
  "char-shark": cdnBuiltin("char-shark.glb"),
  "anim-combat-demo": cdnBuiltin("anim-combat-demo.glb"),
  // Stylized buildings
  "bldg-woodcutter-hut": cdnBuiltin("bldg-woodcutter-hut.glb"),
  "bldg-tavern": cdnBuiltin("bldg-tavern.glb"),
  // Stylized props/items
  "prop-crystal-gems": cdnBuiltin("prop-crystal-gems.glb"),
  "prop-medieval": cdnBuiltin("prop-medieval.glb"),
  "prop-survival-items": cdnBuiltin("prop-survival-items.glb"),
  "prop-toon-weapons": cdnBuiltin("prop-toon-weapons.glb"),
  "mat-sand-procedural": cdnBuiltin("mat-sand-procedural.glb"),
  // Stylized VFX
  "vfx-stylized-fire": cdnBuiltin("vfx-stylized-fire.glb"),
  "vfx-stylized-fire-tornado": cdnBuiltin("vfx-stylized-fire-tornado.glb"),
  // Maps
  "map-pirate-island": cdnBuiltin("map-pirate-island.glb"),
  /** Production open-world lobby (full multipack scene on CDN). */
  "map-pirate-islands-scene":
    "https://assets.grudge-studio.com/models/lobby/pirate-islands/scene.glb",
  "map-chinese-market": cdnBuiltin("map-chinese-market.glb"),
  "map-dude-theft-city": cdnBuiltin("map-dude-theft-city.glb"),
  // Chicken Gun maps â€” hosted on R2 CDN (too large to ship in git)
  "map-mistytown": "https://assets.grudge-studio.com/builtin/map-mistytown.glb",
  "map-town2f": "https://assets.grudge-studio.com/builtin/map-town2f.glb",
  "map-bigfarm": "https://assets.grudge-studio.com/builtin/map-bigfarm.glb",
  "map-western": "https://assets.grudge-studio.com/builtin/map-western.glb",
  // Vehicles (Realistic Car Pack â€” OBJâ†’GLB conversion)
  "vehicle-cop": cdnBuiltin("vehicle-cop.glb"),
  "vehicle-sedan": cdnBuiltin("vehicle-sedan.glb"),
  "vehicle-sedan-2": cdnBuiltin("vehicle-sedan-2.glb"),
  "vehicle-sports": cdnBuiltin("vehicle-sports.glb"),
  "vehicle-sports-2": cdnBuiltin("vehicle-sports-2.glb"),
  "vehicle-suv": cdnBuiltin("vehicle-suv.glb"),
  "vehicle-taxi": cdnBuiltin("vehicle-taxi.glb"),
  // Per-race character GLBs from the toon-rts-characters asset pack
  // (CDN, absolute https URL â€” `ensureBaseUrl` is a no-op for these).
  // Saved scenes reference these via the durable `builtin:race:<id>` key
  // so we never bake CDN URLs into scene JSON.
  "race:warrior": ensureBaseUrl(getRaceCharacterUrl("warrior")),
  "race:dwarf": ensureBaseUrl(getRaceCharacterUrl("dwarf")),
  "race:frost-dwarf": ensureBaseUrl(getRaceCharacterUrl("frost-dwarf")),
  "race:elf": ensureBaseUrl(getRaceCharacterUrl("elf")),
  "race:orc": ensureBaseUrl(getRaceCharacterUrl("orc")),
  "race:skeleton": ensureBaseUrl(getRaceCharacterUrl("skeleton")),
  // Per-race weapons â€” grudge6 library on CDN (toon-rts weapons/* 404).
  // Durable keys: builtin:race-weapon:<id>
  "race-weapon:warrior": ensureBaseUrl(getRaceWeaponUrl("warrior")),
  "race-weapon:dwarf": ensureBaseUrl(getRaceWeaponUrl("dwarf")),
  "race-weapon:frost-dwarf": ensureBaseUrl(getRaceWeaponUrl("frost-dwarf")),
  "race-weapon:elf": ensureBaseUrl(getRaceWeaponUrl("elf")),
  "race-weapon:orc": ensureBaseUrl(getRaceWeaponUrl("orc")),
  "race-weapon:skeleton": ensureBaseUrl(getRaceWeaponUrl("skeleton")),
  // Modular grudge6 race kits (production GLB on R2) â€” durable builtin:grudge6:<id>
  "grudge6:warrior": getRaceKitUrl("warrior"),
  "grudge6:dwarf": getRaceKitUrl("dwarf"),
  "grudge6:frost-dwarf": getRaceKitUrl("frost-dwarf"),
  "grudge6:elf": getRaceKitUrl("elf"),
  "grudge6:orc": getRaceKitUrl("orc"),
  "grudge6:skeleton": getRaceKitUrl("skeleton"),
  // Template aliases (rts-fort-royale creeps / bosses).
  // Must be absolute assets.grudge-studio.com URLs â€” never SPA-relative /builtin/*
  // (Vercel catch-all returns HTML as "GLB" and demos crash).
  "creature:mutant": getRaceCharacterUrl("orc"),
  "creature:creep": getRaceCharacterUrl("skeleton"),
  "creature:boss-orc": getRaceCharacterUrl("orc"),
  // RTS building pack â€” orc settlement + battle towers on the public CDN
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
 *  three.js' convention â€” and our physics yaw + camera forward â€” assume
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
  // grudge6 Toon RTS kits: art often faces +X; controller/camera expect +Z-ish framing.
  // Half-turn matches race:* until full facePlusZ deploy is shared with arena characterDeploy.
  "grudge6:warrior": Math.PI,
  "grudge6:dwarf": Math.PI,
  "grudge6:frost-dwarf": Math.PI,
  "grudge6:elf": Math.PI,
  "grudge6:orc": Math.PI,
  "grudge6:skeleton": Math.PI,
  "creature:mutant": Math.PI,
  "creature:creep": Math.PI,
  "creature:boss-orc": Math.PI,
};

/** Per-race animation clip names used by the player camera controllers
 *  and the `enemy-rpg` behavior to drive the `__agentClips` crossfade
 *  bridge in `EntityRenderer.LoadedModel`.
 *
 *  Verified by direct CDN probe (parsing the JSON chunk of every GLB
 *  under `â€¦/glb/characters/{human,dwarf,barbarian,elf,orc,undead}.glb`)
 *  that the public toon-rts character pack ships with **zero** baked
 *  animations on each rig â€” `gltf.animations.length === 0` for all six
 *  files (~0.83â€“1.07 MB each). The manifest references separate
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
   *  yet â€” skip publishing"; writer sites must guard with `if (!clip)`. */
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

/** Resolve `"builtin:foo"` â†’ real URL. Returns null if not a builtin key. */
export function resolveBuiltinModel(url: string): string | null {
  if (!url.startsWith("builtin:")) return null;
  const key = url.slice("builtin:".length);
  return BUILTIN_MODELS[key] ?? null;
}

/** Safe CDN hero when a builtin key is missing â€” never SPA HTML-as-GLB. */
const FALLBACK_CHARACTER_URL = getRaceCharacterUrl("warrior");

/** Legacy absolute R2 paths that 404 â€” rewrite to durable race GLBs. */
const BROKEN_CDN_REWRITES: Array<{ match: RegExp; to: string }> = [
  {
    match: /\/builtin\/creature:mutant\.glb$/i,
    to: getRaceCharacterUrl("orc"),
  },
  {
    match: /\/builtin\/creature%3Amutant\.glb$/i,
    to: getRaceCharacterUrl("orc"),
  },
  {
    match: /\/builtin\/char-distortus-rex\.glb$/i,
    to: getRaceCharacterUrl("orc"),
  },
];

/** Resolve a model URL for GLTF loaders. Order:
 *   1. `builtin:<key>` â†’ bundled / CDN asset URL
 *   2. absolute http(s)/data/blob â†’ returned as-is (with broken-path rewrites)
 *   3. anything else â†’ relative to the artifact BASE_URL
 *
 *  Unknown `builtin:` keys must NOT fall through to (3) â€” Vercel's SPA
 *  catch-all would return `index.html` and drei would try to parse it as
 *  GLB JSON, producing the opaque "<!doctype â€¦ is not valid JSON" error.
 *  Instead fall back to a verified race GLB so demos keep running. */
export function resolveModelUrl(url: string): string {
  if (!url || typeof url !== "string") {
    throw new Error("resolveModelUrl: empty model url");
  }
  // Guard pathological junk before loaders (LoadingManager.resolveURL can
  // stack-overflow when path + relative url loop via a broken modifier).
  if (url.length > 4096) {
    throw new Error(`resolveModelUrl: url too long (${url.length})`);
  }
  const builtin = resolveBuiltinModel(url);
  if (builtin) return builtin;
  if (url.startsWith("builtin:")) {
    const key = url.slice("builtin:".length);
    console.warn(
      `[builtinModels] Unknown builtin "${key}" — falling back to race:warrior CDN GLB`,
    );
    return FALLBACK_CHARACTER_URL;
  }

  // Relative SPA /builtin/… paths (saved scenes / old builds) → R2 CDN.
  // Never leave these as same-origin paths: production returns HTML.
  if (
    url.startsWith("/builtin/") ||
    url.startsWith("builtin/") ||
    /^\/?builtin\//i.test(url)
  ) {
    return cdnBuiltin(url.replace(/^\/?builtin\//i, ""));
  }

  // Block known-bad hosts early (agent / pasted URLs)
  if (/^https?:\/\//i.test(url)) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.includes("replit") ||
        host.endsWith(".local")
      ) {
        throw new Error(
          `Blocked model host "${host}" — use builtin: keys or assets.grudge-studio.com (R2)`,
        );
      }
      // Same-host /builtin on forge SPA or Vercel origin → CDN (HTML-as-GLB fix).
      if (
        (host === "forge.grudge-studio.com" ||
          host === "grudge-studio-forge.vercel.app" ||
          host.endsWith(".vercel.app")) &&
        /\/builtin\//i.test(url)
      ) {
        const path = new URL(url).pathname;
        const file = path.replace(/^\/builtin\//i, "");
        return cdnBuiltin(file);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Blocked")) throw e;
    }
    for (const { match, to } of BROKEN_CDN_REWRITES) {
      if (match.test(url)) return to;
    }
    return url;
  }
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  // Same-origin /api/storage/… user uploads — keep relative so edge/API serve them.
  if (url.startsWith("/api/storage")) return url;
  const base = import.meta.env.BASE_URL || "/";
  if (base !== "/" && url.startsWith(base)) return url;
  return `${base}${url.replace(/^\/+/, "")}`;
}

