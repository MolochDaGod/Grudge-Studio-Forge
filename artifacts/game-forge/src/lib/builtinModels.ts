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
  // Neutral NPC mutant — bundled in `public/builtin/` (10.25 MB Draco-
  // compressed). Mixamo-rigged, ships with real GLB-baked clips
  // (idle / walk / run / attack / death / jump / breathing_idle / flex /
  // turn_left / turn_right) authored against the source FBX pack, so
  // `synthesizeBipedClips` is a silent no-op for this model.
  "creature:mutant": ensureBaseUrl("builtin/creature-mutant.glb"),
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

/** Decide whether a mesh inside a builtin race GLB should be visible.
 *
 *  The toon-rts-characters pack GLBs are MODULAR variant rigs — each
 *  character file (~870 KB – 1.1 MB) contains every body / head / arms /
 *  legs / shoulderpads variant the source Unity asset shipped (typically
 *  4–9 variants per slot, named `<PREFIX>_Units_Body_A` … `_I`,
 *  `<PREFIX>_Units_head_A` … `_I`, etc.) PLUS every weapon mesh
 *  (`<PREFIX>_weapon_sword_A`, `_axe_B`, `_bow`, …), every shield
 *  (`<PREFIX>_Shield_A` … `_D`), and a few "Xtra" props (quiver, bag,
 *  wood). The pack expects the consumer to toggle visibility per-variant
 *  in Unity — nothing in the GLB does it for us, so by default every
 *  one of the ~42–50 meshes renders simultaneously, all bound to the
 *  same skeleton. The visual result: each "character" looks like a
 *  pile of overlapping body parts holding 15 weapons at once — exactly
 *  the "holding every mesh instead of just a weapon and one set" bug
 *  reported against the rpg-village template.
 *
 *  Rules (applied to any mesh inside a `builtin:race:<id>` model):
 *    - Hide every mesh whose name matches /weapon|shield|xtra/i.
 *      The held weapon is provided by a separate parented child entity
 *      using the `builtin:race-weapon:<id>` model key, so the in-rig
 *      weapon meshes are pure clutter.
 *    - For body-part meshes (`*_A` … `*_I` or `*_01` … `*_09`), keep
 *      only the FIRST variant encountered per category prefix. GLB
 *      mesh order is deterministic (set when the artist exported), so
 *      this is stable across loads — and across races, since every
 *      race has a Body, head, Arms, Legs, and shoulderpads category
 *      under its own prefix (WK_/DWF_/ELF_/ORC_/UD_/BRB_).
 *
 *  Pure: takes the mesh name and a per-call `seen` set so the caller can
 *  walk a cloned scene once. Returns true to keep the mesh visible. */
export function shouldShowRaceVariantMesh(meshName: string | undefined, seen: Set<string>): boolean {
  const n = (meshName ?? "").toLowerCase();
  if (!n) return true;
  if (/weapon|shield|xtra/.test(n)) return false;
  // Strip a trailing _<letter> or _<two-digit-number> variant tag so the
  // remaining prefix names the slot category ("wk_units_body", etc.).
  const m = n.match(/^(.*)_(?:[a-z]|[0-9]{2})$/);
  if (!m) return true; // No recognized variant suffix → always show.
  const cat = m[1];
  if (seen.has(cat)) return false;
  seen.add(cat);
  return true;
}

/** True when a model URL key is a race rig that needs variant filtering
 *  via {@link shouldShowRaceVariantMesh}. Centralized so EntityRenderer
 *  and any future consumer (e.g. a prefab editor preview) stay in sync. */
export function isRaceVariantModel(url: string): boolean {
  return url.startsWith("builtin:race:");
}

/** Per-builtin-model Y rotation offset (radians) applied at render time
 *  inside the entity's rigidbody/group, so the visual model faces the
 *  same direction as the physics body's "forward". The toon-rts character
 *  GLBs (the six `race:*` keys below) were authored facing +Z, while
 *  three.js' convention — and our physics yaw + camera forward — assume
 *  -Z, so they need a half-turn to look the right way. The original
 *  `builtin:character` rig already faces -Z, so it is intentionally
 *  absent from this map (its effective offset is 0). EntityRenderer's
 *  resolution order is: `entity.model.yawOffset` ?? this map ?? 0.
 *
 *  Note (task #121): an attempt to remove these offsets was tested by
 *  the user and the bug remained, proving the +π is NOT the cause of
 *  the "player facing camera" regression. The real culprit is somewhere
 *  else in the spawn pipeline — see the live investigation in
 *  EntityRenderer / Hierarchy / scene-templates. */
export const BUILTIN_MODEL_YAW_OFFSETS: Record<string, number> = {
  "race:warrior": Math.PI,
  "race:dwarf": Math.PI,
  "race:frost-dwarf": Math.PI,
  "race:elf": Math.PI,
  "race:orc": Math.PI,
  "race:skeleton": Math.PI,
  // Mixamo source characters export facing +Z (same as the toon-rts
  // race rigs), so the mutant needs the same half-turn so its forward
  // matches the physics body's -Z forward.
  "creature:mutant": Math.PI,
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
  /** Optional weapon-pose variants. When the entity has a non-unarmed
   *  EquippedWeapon, `pickClipName(baseClipName, pose)` returns the
   *  matching variant from this map (e.g. `"walk"` + `"rifle"` →
   *  `"rifle_walk"`). When a variant is absent, callers fall back to
   *  the base clip — so equipping an unsupported weapon never produces
   *  a missing-clip crossfade. */
  weapons?: Partial<Record<WeaponPose, WeaponClipSet>>;
}

/** Weapon poses the engine knows about. `unarmed` is the implicit
 *  default — `pickClipName(name, "unarmed")` returns `name` unchanged
 *  so callers don't need to special-case it. New weapon kinds become
 *  one new entry here + a new entry in `WEAPON_CLIP_NAMES` + matching
 *  procedural synthesizer (e.g. `proceduralRifleClips.ts`). */
export type WeaponPose = "unarmed" | "rifle";

export interface WeaponClipSet {
  idle: string;
  walk: string;
  run: string;
  /** Held aim / sight-picture loop. Optional — entities that just
   *  equip the weapon for visual flair can omit it. */
  aim?: string;
  /** One-shot fire / strike. */
  fire?: string;
  /** One-shot reload. */
  reload?: string;
}

/** Canonical clip names per weapon pose. Mirrors the names emitted
 *  by `proceduralRifleClips.ts` so a procedurally-synthesized rifle
 *  clip resolves through this table without a renaming step. */
export const WEAPON_CLIP_NAMES: Record<Exclude<WeaponPose, "unarmed">, Required<WeaponClipSet>> = {
  rifle: {
    idle: "rifle_idle",
    walk: "rifle_walk",
    run: "rifle_run",
    aim: "rifle_aim",
    fire: "rifle_fire",
    reload: "rifle_reload",
  },
};
// Names mirror `PROCEDURAL_BIPED_CLIP_NAMES` in `proceduralBipedAnimations.ts`.
// `death` resolves to the procedural one-shot collapse pose (the renderer
// detects the "death" clip name and switches the AnimationAction to
// LoopOnce + clampWhenFinished so the final pose holds).
//
// Every race shares the same `weapons.rifle` set because the procedural
// rifle synthesizer (`proceduralRifleClips.ts`) emits identical clip
// NAMES for every race — only the per-bone deltas differ via the per-
// race `BipedAnimProfile`. Drop-in Mixamo retargets follow the same
// convention via the asset-browser tagger so adding real authored
// rifle content for one race doesn't require editing this table.
const RIFLE_CLIPS: WeaponClipSet = WEAPON_CLIP_NAMES.rifle;
export const BUILTIN_MODEL_CLIPS: Record<string, RaceClipSet> = {
  "race:warrior":     { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death", weapons: { rifle: RIFLE_CLIPS } },
  "race:dwarf":       { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death", weapons: { rifle: RIFLE_CLIPS } },
  "race:frost-dwarf": { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death", weapons: { rifle: RIFLE_CLIPS } },
  "race:elf":         { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death", weapons: { rifle: RIFLE_CLIPS } },
  "race:orc":         { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death", weapons: { rifle: RIFLE_CLIPS } },
  "race:skeleton":    { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death", weapons: { rifle: RIFLE_CLIPS } },
  // Mutant neutral NPC — clip names are baked into the merged GLB by
  // `scripts/merge_creature_animations.mjs` (FBX→GLB → animation merge
  // → Draco) using the canonical idle / walk / run / attack / death
  // names so the same crossfade bridge in `LoadedModel` drives both
  // race characters and the mutant uniformly.
  "creature:mutant":  { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
};

/** Resolve a base clip name + a weapon pose to the actual clip name
 *  the renderer should crossfade to.
 *
 *  - `unarmed` is the identity case — returns `baseClipName` unchanged
 *    so writers can call this unconditionally without wrapping.
 *  - For armed poses, looks up the variant in the race's `weapons[pose]`
 *    table. Falls back to `baseClipName` when the variant is missing
 *    (e.g. a race with rifle-walk but no rifle-attack), so an unknown
 *    base clip never produces an undefined crossfade target.
 *
 *  Pure: no I/O, no store reads. Both the player camera controllers
 *  and the enemy-rpg behavior call this just before writing into
 *  `__agentClips`, keeping the pose-resolution logic out of every
 *  writer site. */
export function pickClipName(
  baseClipName: string,
  pose: WeaponPose,
  raceClips: RaceClipSet | undefined,
): string {
  if (pose === "unarmed" || !raceClips?.weapons) return baseClipName;
  const variants = raceClips.weapons[pose];
  if (!variants) return baseClipName;
  switch (baseClipName) {
    case "idle":   return variants.idle;
    case "walk":   return variants.walk;
    case "run":    return variants.run;
    case "attack": return variants.fire ?? baseClipName;
    case "aim":    return variants.aim ?? baseClipName;
    case "fire":   return variants.fire ?? baseClipName;
    case "reload": return variants.reload ?? baseClipName;
    default:       return baseClipName;
  }
}

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
