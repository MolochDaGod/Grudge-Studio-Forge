import type {
  SceneData,
  SceneEntity,
  ControllerKind,
  LayerName,
  SurfaceKind,
} from "@workspace/scene-schema";
import { DEFAULT_ENV } from "@workspace/scene-schema";

// Deterministic ID generator: a per-builder counter, reset by `withIdScope`.
// We need stable bytes-out so the api-server's md5 idempotency check skips
// re-uploading templates whose content hasn't actually changed across boots.
// Using nanoid here would make every boot's serialized JSON different even
// when the template definition is unchanged.
let __idCounter = 0;
let __idScope = "ent";
const id = () => `${__idScope}-${(__idCounter++).toString(36).padStart(4, "0")}`;

/** Run `fn` with a fresh, deterministic ID counter scoped by `scope`.
 *  Used by both the api-server seeder and any in-process re-builds so the
 *  same template version always produces byte-identical JSON.
 *
 *  ⚠️ `fn` MUST be synchronous and return a non-Promise value. The scope
 *  is restored in `finally` immediately after `fn()` returns; an async
 *  callback would resume after the scope has been restored, allocating
 *  IDs against the WRONG scope (or interleaving with another scope) and
 *  silently breaking determinism. We enforce this at runtime: returning
 *  a Promise throws so the misuse is loud, not silent. The generic is
 *  also constrained to exclude Promise types at compile time.
 */
type NotPromise<T> = T extends Promise<unknown> ? never : T;
export function withIdScope<T>(scope: string, fn: () => NotPromise<T>): T {
  const prevCounter = __idCounter;
  const prevScope = __idScope;
  __idCounter = 0;
  __idScope = scope;
  try {
    const result = fn() as T;
    if (
      result != null &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      throw new Error(
        "withIdScope: callback must be synchronous; got a thenable. Async work would run AFTER the ID scope is restored, breaking determinism.",
      );
    }
    return result;
  } finally {
    __idCounter = prevCounter;
    __idScope = prevScope;
  }
}

/** Stable references to bundled GLB assets. EntityRenderer resolves the
 *  `builtin:` scheme to the actual Vite-hashed URL at render time, so saved
 *  scenes survive rebuilds and work under path-based routing. */
export const ASSETS = {
  character: "builtin:character",
  rifle: "builtin:rifle",
} as const;

interface BuildOpts {
  name: string;
  type: SceneEntity["type"];
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  parentId?: string | null;
  color?: string;
  emissive?: string;
  metalness?: number;
  roughness?: number;
  fixed?: boolean;
  controllerKind?: ControllerKind;
  light?: SceneEntity["light"];
  modelUrl?: string;
  noPhysics?: boolean;
  /** Tri-axis tagging — written verbatim onto the entity so the
   *  navmesh baker, AI perception, and the inspector inheritance
   *  chips all see them. Templates that omit these still inherit
   *  from the parent group via `resolveInheritedFields`. */
  layer?: LayerName;
  surface?: SurfaceKind;
  behavior?: SceneEntity["behavior"];
}

const ent = (o: BuildOpts): SceneEntity => {
  const e: SceneEntity = {
    id: id(),
    name: o.name,
    type: o.type,
    transform: {
      position: o.position ?? [0, 0, 0],
      rotation: o.rotation ?? [0, 0, 0],
      scale: o.scale ?? [1, 1, 1],
    },
    parentId: o.parentId ?? null,
  };
  if (o.color || o.emissive || o.metalness !== undefined || o.roughness !== undefined) {
    e.material = {
      color: o.color,
      emissive: o.emissive,
      metalness: o.metalness ?? 0.1,
      roughness: o.roughness ?? 0.6,
    };
  }
  if (o.light) e.light = o.light;
  if (o.modelUrl) e.model = { url: o.modelUrl };
  if (o.controllerKind) e.controllerKind = o.controllerKind;
  if (o.layer) e.layer = o.layer;
  if (o.surface) e.surface = o.surface;
  if (o.behavior) e.behavior = o.behavior;
  if (!o.noPhysics && o.type !== "light" && o.type !== "camera" && o.type !== "empty") {
    e.physics = o.fixed
      ? { bodyType: "fixed", colliderType: "cuboid", mass: 0, restitution: 0.2, friction: 1 }
      : { bodyType: "dynamic", colliderType: o.type === "sphere" ? "ball" : "cuboid", mass: 1, restitution: 0.4, friction: 0.6 };
  }
  return e;
};

/** Empty grouping node used as a hierarchy header — purely organisational
 *  (no physics, no visuals). The Hierarchy panel collapses these into
 *  folder-like rows; child entities inherit Layer/Surface from the
 *  closest set ancestor via `resolveInheritedFields`, so giving the
 *  group a `layer` cascades it to every descendant that doesn't set
 *  its own. Used by every template to organise:
 *    Map / Players / Enemies / Spawns / Lighting / GameLogic. */
const group = (
  groupId: string,
  name: string,
  opts: { parentId?: string | null; layer?: LayerName; surface?: SurfaceKind } = {},
): SceneEntity => {
  const g: SceneEntity = {
    id: groupId,
    name,
    type: "empty",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: opts.parentId ?? null,
  };
  if (opts.layer) g.layer = opts.layer;
  if (opts.surface) g.surface = opts.surface;
  return g;
};

/** Third-person zombie shooter sandbox inspired by YetAnotherZombieHorror
 *  and Mugen87/dive. Player rigged character with a parented rifle; the
 *  player runs the same `player-deathmatch` behavior as the dm-* maps so
 *  LMB raycasts, hit feedback, headshots, health, respawn, and the full
 *  HUD (crosshair, kill feed, scoreboard) all light up automatically.
 *  Zombies use `enemy-deathmatch` (Yuka WanderBehavior + SeekBehavior +
 *  FSM with line-of-sight checks). */
export function tpsZombieDemoScene(): SceneData {
  const entities: SceneEntity[] = [];

  // Real GLB map (encampment — fits the "zombie ambush at a war camp"
  // mood). Loaded from public/builtin/map-encampment.glb via the
  // `builtin:` scheme, same way the dm-* templates load their maps.
  // No physics on the visible map — collision is handled by the
  // invisible Ground plane below so the player can't fall through.
  entities.push({
    id: id(),
    name: "Map",
    type: "model",
    model: { url: "builtin:map-encampment" },
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    parentId: null,
  });

  // Invisible collision ground — keeps the player from falling through
  // the map. Dark plane that mostly disappears against the GLB textures.
  entities.push(
    ent({
      name: "Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [200, 200, 1],
      color: "#1a1a26",
      roughness: 1,
      metalness: 0,
      fixed: true,
    }),
  );

  // Player root: rigged character GLB drives the visuals; a kinematic cylinder
  // collider drives movement/contacts (independent of the mesh). The
  // `player-deathmatch` behavior reads LMB + camera ray each frame and
  // sends 'damage' messages to whoever the cursor is over (HUD subscribes
  // to playerHealth / hit / kill / playerScore events emitted by it).
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "model",
    model: { url: ASSETS.character },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    controllerKind: "thirdPerson",
    behavior: "player-deathmatch",
    parentId: null,
  });

  // Rifle parented to player — inherits player transform (held weapon).
  // Position approximates a right-hand hold; rotated to point forward.
  const rifleId = id();
  entities.push({
    id: rifleId,
    name: "Rifle",
    type: "model",
    model: { url: ASSETS.rifle },
    transform: { position: [0.32, 1.25, 0.25], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
    parentId: playerId,
  });
  // Muzzle marker parented to the rifle — child of a child.
  entities.push(
    ent({
      name: "Muzzle",
      type: "sphere",
      parentId: rifleId,
      position: [0, 0, 0.55],
      scale: [0.05, 0.05, 0.05],
      color: "#ff8a3d",
      emissive: "#ff5500",
      noPhysics: true,
    }),
  );

  // Spawn points (six on a ring). The deathmatch behaviors look these
  // up by name prefix `Spawn_` so respawn after death works. r=14
  // matches the comparable dm-encampment template (same map, same
  // scale) and gives better spacing than the previous r=10 cluster.
  const SPAWN_R = 14;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 12;
    entities.push({
      id: id(),
      name: `Spawn_${i + 1}`,
      type: "empty",
      transform: {
        position: [Math.cos(a) * SPAWN_R, 0, Math.sin(a) * SPAWN_R],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      behavior: "spawnpoint",
      parentId: null,
    });
  }

  // Six zombie enemies in a ring — rigged character with red tint,
  // running the same `enemy-deathmatch` AI as the dm-* maps. They patrol
  // when they don't see you, chase + shoot when they do.
  //
  // Note: enemy lookup in deathmatchBehaviors uses
  // `behavior === "enemy-deathmatch"` (not the name), so the historical
  // "Zombie 1..6" naming is no longer required. We use "Enemy_*" to
  // match the kill-feed convention from the dm-* maps.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    // Slightly inside the spawn ring so the zombies are visible to the
    // player on first load (player spawns near origin / at a Spawn_*).
    const r = 11;
    const s = 0.92 + (i % 3) * 0.07;
    entities.push({
      id: id(),
      name: `Enemy_${i + 1}`,
      type: "model",
      model: { url: ASSETS.character, tint: "#5cb85c" }, // sickly green = zombie tint
      transform: {
        position: [Math.cos(angle) * r, 0, Math.sin(angle) * r],
        rotation: [0, angle + Math.PI, 0], // face the player
        scale: [s, s, s],
      },
      physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0.2, friction: 0.8 },
      behavior: "enemy-deathmatch",
      parentId: null,
    });
  }

  // Mood lights — two warm braziers above the camp give the scene
  // depth on top of the hemisphere fill + sun. The encampment GLB
  // already provides plenty of cover geometry, so we don't need the
  // old procedural Crypt walls anymore.
  entities.push(
    ent({
      name: "Brazier Light L",
      type: "light",
      position: [8, 4, 6],
      light: { kind: "point", color: "#ff8a3d", intensity: 16, distance: 24 },
    }),
  );
  entities.push(
    ent({
      name: "Brazier Light R",
      type: "light",
      position: [-8, 4, -6],
      light: { kind: "point", color: "#ff8a3d", intensity: 16, distance: 24 },
    }),
  );

  // Hidden game manager — listens to `kill` events and tracks score so
  // the HUD's win/lose banner fires when either side reaches scoreLimit.
  entities.push({
    id: id(),
    name: "GameManager",
    type: "empty",
    transform: { position: [0, -50, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    behavior: "gamemode-deathmatch",
    parentId: null,
  });

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      // Bumped lighting so the rigged characters and crypt actually read
      // (the old 0.18 ambient + 0.45 sun was too dim — combined with the
      // new hemisphere light in Viewport.tsx the scene now matches what
      // YAZH shows in its night-graveyard preset).
      skyColor: "#0c0c1c",
      groundColor: "#241a18",
      ambientIntensity: 0.45,
      sunIntensity: 0.85,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      // Frame the camp from behind / above the player so the user
      // immediately sees the spawn ring of zombies. Seeds the TPS
      // controller's yaw to ~0 (player facing -Z toward the +X/-Z
      // half of the ring on Play press) — see deriveOrbitFromCameraStart.
      cameraStart: { position: [0, 6, 12], target: [0, 1, 0] },
      playerMoveSpeed: 6,
      gameMode: "deathmatch",
      scoreLimit: 10,
      respawnDelay: 5,
    },
  };
}

/** First-person arena — closed room with player, weapon mount,
 *  three turret enemies, and a few crates. The player runs the
 *  `player-deathmatch` behavior (LMB raycast shooting, full HUD with
 *  crosshair, kill feed, scoreboard) and the turrets run
 *  `enemy-deathmatch` (Yuka FSM with line-of-sight via the surrounding
 *  walls / crates). FPS feel is inspired by Mugen87/dive — tight room,
 *  spotlight overhead, real GLB rifle parented to the camera body. */
export function fpsArenaScene(): SceneData {
  const entities: SceneEntity[] = [];

  // Arena radius is still useful for placing spawns + crates relative to
  // the player, even though we no longer build procedural walls — the
  // GLB castle map below provides those.
  const arenaR = 15;

  // Real GLB map (Fort Royale — small medieval-style castle, smallest of
  // the shooter maps so it loads fast and reads well at FPS scale).
  // Loaded from public/builtin/map-fort-royale.glb via the `builtin:`
  // scheme, identical to how the dm-* templates load their maps. No
  // physics on the visible map — collision is on the invisible Ground
  // plane below so the player can't fall through.
  entities.push({
    id: id(),
    name: "Map",
    type: "model",
    model: { url: "builtin:map-fort-royale" },
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.6, 0.6, 0.6],
    },
    parentId: null,
  });

  // Invisible collision ground (replaces the old procedural Arena Floor +
  // 4 walls — the GLB castle has its own walls that will block
  // line-of-sight, and the open layout is more interesting than a sealed
  // box).
  entities.push(
    ent({
      name: "Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [200, 200, 1],
      color: "#1a1a24",
      roughness: 1,
      metalness: 0,
      fixed: true,
    }),
  );

  // Player. Cylinder body (you don't see your own avatar in FPS) + the
  // `player-deathmatch` behavior so LMB shoots, the HUD/crosshair shows,
  // and respawn/kill tracking works.
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "cylinder",
    transform: { position: [0, 1, 6], rotation: [0, 0, 0], scale: [0.5, 1.7, 0.5] },
    material: { color: "#d4af37", metalness: 0.3, roughness: 0.5, emissive: "#3a2a08" },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    controllerKind: "firstPerson",
    behavior: "player-deathmatch",
    parentId: null,
  });
  // FPS rifle: real GLB rifle mounted in front of the player camera.
  // Player keeps a cylinder body since you don't see your own avatar in FPS.
  const rifleId = id();
  entities.push({
    id: rifleId,
    name: "Rifle",
    type: "model",
    model: { url: ASSETS.rifle },
    transform: { position: [0.3, 0.1, -0.6], rotation: [0, Math.PI, 0], scale: [1, 1, 1] },
    parentId: playerId,
  });
  entities.push(
    ent({
      name: "Muzzle Flash",
      type: "sphere",
      parentId: rifleId,
      position: [0, 0, -0.55],
      scale: [0.06, 0.06, 0.06],
      color: "#ffd070",
      emissive: "#ff7a2a",
      noPhysics: true,
    }),
  );

  // Spawn points (4 in arena corners). Player + enemies use these for
  // initial spawn-after-death placement (deathmatch behaviors look up
  // entities whose name starts with `Spawn_`).
  const spawnSpots: [number, number, number][] = [
    [arenaR - 2, 0, arenaR - 2],
    [-(arenaR - 2), 0, arenaR - 2],
    [arenaR - 2, 0, -(arenaR - 2)],
    [-(arenaR - 2), 0, -(arenaR - 2)],
  ];
  for (let i = 0; i < spawnSpots.length; i++) {
    entities.push({
      id: id(),
      name: `Spawn_${i + 1}`,
      type: "empty",
      transform: { position: spawnSpots[i], rotation: [0, 0, 0], scale: [1, 1, 1] },
      behavior: "spawnpoint",
      parentId: null,
    });
  }

  // Three roving enemies in a triangle (formerly static turrets — they
  // now run the `enemy-deathmatch` Yuka FSM, so they patrol when you're
  // not in line-of-sight, chase + shoot when they spot you, and use the
  // crates and walls below as cover for LoS breaks).
  const enemyPositions: [number, number, number][] = [
    [0, 0, -10],
    [-9, 0, -4],
    [9, 0, -4],
  ];
  for (let i = 0; i < enemyPositions.length; i++) {
    entities.push({
      id: id(),
      name: `Enemy_${i + 1}`,
      type: "model",
      model: { url: ASSETS.character, tint: "#ff5050" },
      transform: { position: enemyPositions[i], rotation: [0, 0, 0], scale: [1, 1, 1] },
      physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0.2, friction: 0.8 },
      behavior: "enemy-deathmatch",
      parentId: null,
    });
  }

  // 5 crates scattered as line-of-sight cover.
  for (let i = 0; i < 5; i++) {
    entities.push(
      ent({
        name: `Crate ${i + 1}`,
        type: "box",
        position: [(i - 2) * 2.5, 0.5, -1],
        scale: [0.9, 0.9, 0.9],
        color: "#7a5e2e",
        roughness: 0.85,
        fixed: true,
      }),
    );
  }

  // Spotlight from above (kept for arena flavor; the new hemisphere light
  // in Viewport.tsx handles fill so the spotlight reads as a hot key
  // instead of being the only thing in the room).
  entities.push(
    ent({
      name: "Arena Spot",
      type: "light",
      position: [0, 8, 0],
      light: { kind: "spot", color: "#fff5d8", intensity: 18, distance: 35 },
    }),
  );

  // Hidden game manager — score tracking + win/lose banner.
  entities.push({
    id: id(),
    name: "GameManager",
    type: "empty",
    transform: { position: [0, -50, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    behavior: "gamemode-deathmatch",
    parentId: null,
  });

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      // Bumped from the old (0.14 ambient / 0.3 sun) — combined with the
      // hemisphere light those low values left the FPS arena pitch black
      // outside the spotlight cone. Now the room has a soft cool fill +
      // overhead spot, so you can actually navigate.
      skyColor: "#1a1a24",
      groundColor: "#15151c",
      ambientIntensity: 0.4,
      sunIntensity: 0.35,
      cameraMode: "firstPerson",
      cameraTargetEntityId: playerId,
      // Editor view: behind-and-above the cylinder player so the user
      // sees the arena before pressing Play. The FPS controller only
      // extracts yaw/pitch from this — `target - position` points into
      // -Z (toward the enemy triangle at z=-10/-4), so Play opens with
      // the camera looking at the action instead of snapping to +Z.
      cameraStart: { position: [0, 6, 14], target: [0, 1, -4] },
      playerMoveSpeed: 7,
      gameMode: "deathmatch",
      scoreLimit: 10,
      respawnDelay: 5,
    },
  };
}

/** Minimal showcase: a single rigged character holding the rifle, on a lit
 *  ground plane. Useful as a quick reference of the bundled assets and as a
 *  starting point for posing / animation work. */
export function characterShowcaseScene(): SceneData {
  const entities: SceneEntity[] = [];

  entities.push(
    ent({
      name: "Showcase Floor",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [20, 20, 1],
      color: "#1a1a26",
      roughness: 0.9,
      fixed: true,
    }),
  );

  const charId = id();
  entities.push({
    id: charId,
    name: "Character",
    type: "model",
    model: { url: ASSETS.character },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: null,
  });
  entities.push({
    id: id(),
    name: "Rifle",
    type: "model",
    model: { url: ASSETS.rifle },
    transform: { position: [0.32, 1.25, 0.25], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
    parentId: charId,
  });

  entities.push(
    ent({
      name: "Key Light",
      type: "light",
      position: [3, 4, 3],
      light: { kind: "point", color: "#fff5d8", intensity: 16, distance: 18 },
    }),
  );
  entities.push(
    ent({
      name: "Rim Light",
      type: "light",
      position: [-3, 3, -2],
      light: { kind: "point", color: "#d4af37", intensity: 10, distance: 14 },
    }),
  );

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      skyColor: "#0a0a14",
      groundColor: "#1a1a26",
      ambientIntensity: 0.35,
      sunIntensity: 0.6,
      cameraMode: "editor",
      cameraTargetEntityId: null,
    },
  };
}

/** RPG starter — a small desert-town village populated with one of each
 *  race (warrior / dwarf / frost-dwarf / elf / orc / skeleton). The
 *  Player is the Warrior at center plaza holding a sword and running
 *  the RPG-flavored `player-rpg` behavior (LMB melee swing, E to
 *  interact, no respawn). Friendlies (dwarf / frost-dwarf / elf) stand
 *  idle nearby with cylinder colliders, each carrying their per-race
 *  weapon (axe / mace / bow). Enemies (orc / skeleton) wander peacefully
 *  under `enemy-rpg` carrying their per-race melee weapon (club / sword)
 *  and only become hostile if the player attacks them or gets too close
 *  — no kill-feed, no respawn, just an adventure plaza.
 *
 *  This template references each race via its durable
 *  `builtin:race:<id>` model key — `EntityRenderer.resolveBuiltinModel`
 *  resolves that to the per-race CDN URL at render time, so saved
 *  scenes stay portable across asset-pack versions. The matching weapon
 *  is parented under each character via the `builtin:race-weapon:<id>`
 *  key (resolved against the same toon-rts-characters CDN pack). */
export function rpgVillageScene(): SceneData {
  const entities: SceneEntity[] = [];

  // Same six-group skeleton as the deathmatch templates (Map / Players /
  // Friendlies / Enemies / Lighting / GameLogic). Spawns group is
  // omitted — the RPG starter doesn't respawn anyone, the player and
  // NPCs all start at fixed plaza positions.
  //
  // Map choice: we use map-encampment (war-camp tents + crates, scale
  // 0.5) here instead of map-deserttown. The deserttown GLB has stray
  // underground geometry (foundation meshes, dropped props, ladder
  // pieces) extending hundreds of units below the visible terrain, so
  // EntityRenderer's `dropToGround` (which lifts the model so its
  // bbox.min.y == 0) ends up pushing the visible ground way above
  // world Y=0 — characters spawn at Y=0 and end up buried under the
  // desert floor. map-encampment has clean geometry that drop-aligns
  // correctly at scale 0.5, and is the same map the proven
  // tps-zombie-demo template uses with characters at Y=0.
  const mapGroupId = id();
  entities.push(group(mapGroupId, "Map", { layer: "Terrain", surface: "Walk" }));
  entities.push({
    id: id(),
    name: "MapModel",
    type: "model",
    model: { url: "builtin:map-encampment" },
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    parentId: mapGroupId,
    physics: { bodyType: "fixed", colliderType: "trimesh", mass: 0, restitution: 0.1, friction: 1 },
  });

  // Invisible safety ground (catches off-map falls).
  entities.push(
    ent({
      name: "Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [200, 200, 1],
      color: "#b08754",
      roughness: 1,
      metalness: 0,
      fixed: true,
      parentId: mapGroupId,
      layer: "Terrain",
      surface: "Walk",
    }),
  );

  // Per-race weapon names mirror RACE_WEAPON in
  // artifacts/game-forge/src/lib/objectStoreApi.ts (kept inline here so
  // the scene-templates package stays free of game-forge imports).
  const WEAPON_NAME = {
    warrior: "Sword",
    elf: "Bow",
    dwarf: "Axe",
    "frost-dwarf": "Mace",
    orc: "Club",
    skeleton: "Sword",
  } as const;
  // Local-space transform for the held weapon, parented under each
  // character. Same offset/rotation the deathmatch templates use for the
  // rifle so the weapon sits in the right hand for every race.
  const WEAPON_HELD: SceneEntity["transform"] = {
    position: [0.32, 1.25, 0.25],
    rotation: [0, Math.PI / 2, 0],
    scale: [1, 1, 1],
  };

  // Players group + the warrior. raceId stamps the warrior's baseStats
  // (HP 100, speed 5.0, damage 12) onto the player so player-rpg + the
  // camera controller use them.
  const playersGroupId = id();
  entities.push(group(playersGroupId, "Players", { layer: "Player" }));
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "model",
    model: { url: "builtin:race:warrior" },
    raceId: "warrior",
    // Map is at scale 0.5 so characters at scale 1.0 are 2× too tall
    // for the buildings. Match the map scale so plaza interiors and
    // door frames look proportional.
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    physics: {
      bodyType: "kinematicPosition",
      colliderType: "cylinder",
      mass: 1,
      restitution: 0,
      friction: 0.6,
    },
    controllerKind: "thirdPerson",
    behavior: "player-rpg",
    parentId: playersGroupId,
    // After mount, raycast down against the encampment trimesh and
    // snap Y to the dirt — characters spawned at literal Y=0 float
    // (or sink) on any map whose visible ground isn't exactly at Y=0.
    pendingTerrainSnap: true,
  });
  entities.push({
    id: id(),
    name: WEAPON_NAME.warrior,
    type: "model",
    model: { url: "builtin:race-weapon:warrior" },
    transform: WEAPON_HELD,
    parentId: playerId,
  });

  // Friendlies — placed around the plaza as idle NPCs (no behavior
  // script for v1, just visible characters with cylinder colliders).
  // Each carries its proper per-race builtin key so EntityRenderer
  // resolves the matching CDN GLB, with the matching weapon parented
  // underneath (axe / mace / bow).
  const FRIENDLIES: {
    race: "dwarf" | "frost-dwarf" | "elf";
    name: string;
    pos: [number, number, number];
    line: string;
  }[] = [
    { race: "dwarf", name: "Dwarf", pos: [-3.5, 0, -2.5], line: "Welcome to the village, traveler. Mind the orcs across the plaza." },
    { race: "frost-dwarf", name: "Frost Dwarf", pos: [-4.5, 0, 1.5], line: "Cold steel and colder ale — that's the dwarven way." },
    { race: "elf", name: "Elf", pos: [-2.5, 0, 3.5], line: "Tread softly. Even the desert stones remember." },
  ];
  // Friendlies group — quest-giver / chatter NPCs. Layer "NPC" since
  // they're characters but not enemies; the dialog behavior makes them
  // approachable.
  const friendliesGroupId = id();
  entities.push(group(friendliesGroupId, "Friendlies", { layer: "NPC" }));
  for (const f of FRIENDLIES) {
    const npcId = id();
    entities.push({
      id: npcId,
      name: f.name,
      type: "model",
      model: { url: `builtin:race:${f.race}` },
      raceId: f.race,
      transform: {
        position: f.pos,
        rotation: [0, Math.atan2(-f.pos[0], -f.pos[2]), 0], // face plaza center
        scale: [0.5, 0.5, 0.5],
      },
      physics: {
        bodyType: "kinematicPosition",
        colliderType: "cylinder",
        mass: 1,
        restitution: 0.2,
        friction: 0.8,
      },
      // Press E nearby to pop a one-line speech bubble (handled by
      // PlayHUD's npcDialog subscriber).
      behavior: "npc-dialog",
      npcLine: f.line,
      parentId: friendliesGroupId,
      pendingTerrainSnap: true,
    });
    entities.push({
      id: id(),
      name: WEAPON_NAME[f.race],
      type: "model",
      model: { url: `builtin:race-weapon:${f.race}` },
      transform: WEAPON_HELD,
      parentId: npcId,
    });
  }

  // Enemies — orc + skeleton across the plaza, running the RPG-flavored
  // enemy-rpg behavior (peaceful Yuka wander → only hostile when the
  // player attacks them or gets close → melee chase, no respawn). Each
  // holds their per-race melee weapon (club / sword).
  const ENEMIES: { race: "orc" | "skeleton"; name: string; pos: [number, number, number] }[] = [
    { race: "orc", name: "Orc", pos: [4.5, 0, -2.0] },
    { race: "skeleton", name: "Skeleton", pos: [3.5, 0, 3.0] },
  ];
  // Enemies group — hostile NPCs across the plaza.
  const enemiesGroupId = id();
  entities.push(group(enemiesGroupId, "Enemies", { layer: "NPC" }));
  for (const e of ENEMIES) {
    const enemyId = id();
    entities.push({
      id: enemyId,
      name: e.name,
      type: "model",
      model: { url: `builtin:race:${e.race}` },
      raceId: e.race,
      transform: {
        position: e.pos,
        rotation: [0, Math.atan2(-e.pos[0], -e.pos[2]), 0],
        scale: [0.5, 0.5, 0.5],
      },
      physics: {
        bodyType: "kinematicPosition",
        colliderType: "cylinder",
        mass: 1,
        restitution: 0.2,
        friction: 0.8,
      },
      behavior: "enemy-rpg",
      parentId: enemiesGroupId,
      pendingTerrainSnap: true,
    });
    entities.push({
      id: id(),
      name: WEAPON_NAME[e.race],
      type: "model",
      model: { url: `builtin:race-weapon:${e.race}` },
      transform: WEAPON_HELD,
      parentId: enemyId,
    });
  }

  // Lighting group — warm directional sun + soft hemisphere ambient
  // (matches the deserttown tone). The sun is encoded as a directional
  // light entity; ambient/hemisphere is driven by the environment
  // fields.
  const lightingGroupId = id();
  entities.push(group(lightingGroupId, "Lighting"));
  entities.push(
    ent({
      name: "Sun",
      type: "light",
      position: [12, 18, 8],
      light: { kind: "directional", color: "#ffe6b8", intensity: 4 },
      parentId: lightingGroupId,
    }),
  );

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      skyColor: "#e6c489",
      groundColor: "#b08754",
      ambientIntensity: 0.55,
      sunIntensity: 1.4,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      // Plaza framing: slightly behind-left of player so both the
      // friendlies (-X side) and the enemies (+X side) are visible
      // in one shot. Seeded TPS yaw ≈ -0.24 rad — Play start rotates
      // the warrior to face slightly +X / mostly -Z (toward the
      // orc + skeleton across the plaza).
      cameraStart: { position: [-2, 6, 10], target: [1, 1, 0] },
      // Warm desert vibe: subtle bloom for the bright sun, gentle
      // vignette for plaza framing, no SSAO (the open plaza doesn't
      // benefit and SSAO costs perf on weaker GPUs).
      visuals: {
        ...DEFAULT_ENV.visuals,
        postFX: {
          ...DEFAULT_ENV.visuals!.postFX,
          bloom: { enabled: true, intensity: 0.35, threshold: 0.9 },
          vignette: { enabled: true, intensity: 0.2 },
          colorGrade: { contrast: 1.05, saturation: 1.1, temperature: 0.15 },
        },
      },
    },
  };
}

// ─── Deathmatch starter scenes ───────────────────────────────────────────────
// Three first-to-10-kills deathmatch maps, each built from one of the bundled
// large-format GLB maps. Players spawn at random Spawn_* points, AI enemies
// (Yuka SeekBehavior) chase the player, both sides respawn after 5s. The HUD
// (kill counter, damage flash, hit indicator, win/lose banner) is wired up
// automatically when `environment.gameMode === "deathmatch"`.
//
// Each scene shares the same authoring shape:
//   • Map model entity at origin, no physics (decorative only)
//   • Large flat ground plane (fixed cuboid) at y=0 so the player + AI have
//     real collision while the map model provides the visuals
//   • 1 Player entity (rigged character GLB) with controllerKind:thirdPerson
//     and behavior:player-deathmatch
//   • 6 enemy entities (rigged character GLB) with behavior:enemy-deathmatch
//   • 6 Spawn_<N> empties scattered around the play area
//   • 1 GameManager empty with behavior:gamemode-deathmatch
//   • Lighting tuned per setting (cyberpunk = neon, encampment = warm, desert = harsh sun)
function buildDeathmatch(opts: {
  mapKey:
    | "map-cyberpunk"
    | "map-encampment"
    | "map-deserttown"
    | "map-fort-royale"
    | "map-yard"
    | "map-winter-base";
  mapScale: number;
  mapRotationY?: number;
  spawnRadius: number;
  enemyCount: number;
  env: Partial<typeof DEFAULT_ENV>;
  brazierLights?: { pos: [number, number, number]; color: string; intensity: number; distance: number }[];
}): SceneData {
  const entities: SceneEntity[] = [];

  // ── Hierarchy reorg ──────────────────────────────────────────────────
  // Old templates dumped 14+ entities at the root which made the
  // hierarchy panel a wall of items. New shape is a six-group skeleton
  // every template shares so a designer can scan the scene at a glance:
  //
  //   Map        (layer=Terrain) ─ map model + invisible safety ground
  //   Players    (layer=Player)  ─ the player rig + held weapon
  //   Enemies    (layer=NPC)     ─ all Enemy_* spawns
  //   Spawns     (layer=Trigger) ─ all Spawn_* respawn points
  //   Lighting                   ─ all per-scene mood lights
  //   GameLogic                  ─ the hidden GameManager
  //
  // Layer tags on each group cascade to descendants via
  // `resolveInheritedFields`, so individual entities only need to set
  // their layer when they differ from the group default.
  // ─────────────────────────────────────────────────────────────────────
  const mapGroupId = id();
  entities.push(group(mapGroupId, "Map", { layer: "Terrain", surface: "Walk" }));

  // Visible map model parented under the Map group. We now ship a real
  // trimesh fixed-body collider on the GLB so its geometry is honored
  // for raycasts + agent colliders + the navmesh baker (Recast walks
  // any mesh in the THREE scene). The invisible Ground plane below
  // stays as a safety net so off-map falls don't drop the player to
  // -infinity.
  entities.push({
    id: id(),
    name: "MapModel",
    type: "model",
    model: { url: `builtin:${opts.mapKey}` },
    transform: {
      position: [0, 0, 0],
      rotation: [0, opts.mapRotationY ?? 0, 0],
      scale: [opts.mapScale, opts.mapScale, opts.mapScale],
    },
    parentId: mapGroupId,
    physics: { bodyType: "fixed", colliderType: "trimesh", mass: 0, restitution: 0.1, friction: 1 },
  });

  // Invisible safety ground (catches the player if they walk off the
  // map mesh). Cuboid collider — cheap.
  entities.push(
    ent({
      name: "Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [200, 200, 1],
      color: "#0a0a14",
      roughness: 1,
      metalness: 0,
      fixed: true,
      parentId: mapGroupId,
      layer: "Terrain",
      surface: "Walk",
    }),
  );

  // Players group + the player rig. Layer cascades from the group.
  const playersGroupId = id();
  entities.push(group(playersGroupId, "Players", { layer: "Player" }));

  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "model",
    model: { url: ASSETS.character },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    controllerKind: "thirdPerson",
    behavior: "player-deathmatch",
    parentId: playersGroupId,
    // Snap to terrain after the map trimesh mounts so the player isn't
    // floating above (or buried under) the visible ground.
    pendingTerrainSnap: true,
  });

  // Spawn points group. Layer "Trigger" makes the bodies sensors so
  // the player can step over them without a contact bump.
  const spawnsGroupId = id();
  entities.push(group(spawnsGroupId, "Spawns", { layer: "Trigger" }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    entities.push({
      id: id(),
      name: `Spawn_${i + 1}`,
      type: "empty",
      transform: {
        position: [Math.cos(a) * opts.spawnRadius, 0, Math.sin(a) * opts.spawnRadius],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      behavior: "spawnpoint",
      parentId: spawnsGroupId,
    });
  }

  // Enemies group.
  const enemiesGroupId = id();
  entities.push(group(enemiesGroupId, "Enemies", { layer: "NPC" }));
  for (let i = 0; i < opts.enemyCount; i++) {
    const a = (i / opts.enemyCount) * Math.PI * 2 + Math.PI / opts.enemyCount;
    const r = opts.spawnRadius * 0.85;
    const s = 0.95 + (i % 3) * 0.05;
    entities.push({
      id: id(),
      name: `Enemy_${i + 1}`,
      type: "model",
      model: { url: ASSETS.character, tint: "#ff5050" },
      transform: {
        position: [Math.cos(a) * r, 0, Math.sin(a) * r],
        rotation: [0, a + Math.PI, 0],
        scale: [s, s, s],
      },
      physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0.2, friction: 0.8 },
      behavior: "enemy-deathmatch",
      parentId: enemiesGroupId,
      pendingTerrainSnap: true,
    });
  }

  // Lighting group — all mood lights per setting.
  const lightingGroupId = id();
  entities.push(group(lightingGroupId, "Lighting"));
  for (const bl of opts.brazierLights ?? []) {
    entities.push(
      ent({
        name: `Mood Light`,
        type: "light",
        position: bl.pos,
        light: { kind: "point", color: bl.color, intensity: bl.intensity, distance: bl.distance },
        parentId: lightingGroupId,
      }),
    );
  }

  // GameLogic group — hidden book-keeping entities.
  const logicGroupId = id();
  entities.push(group(logicGroupId, "GameLogic"));
  entities.push({
    id: id(),
    name: "GameManager",
    type: "empty",
    transform: { position: [0, -50, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    behavior: "gamemode-deathmatch",
    parentId: logicGroupId,
  });

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      ...opts.env,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      // Frame the spawn ring from behind / above the player. The
      // editor camera sits roughly at the ring radius for a clear
      // look at all enemies; the TPS controller seeds yaw=0 (player
      // facing -Z half of the ring) — see deriveOrbitFromCameraStart.
      cameraStart: {
        position: [0, opts.spawnRadius * 0.5, opts.spawnRadius * 1.0],
        target: [0, 1, 0],
      },
      gameMode: "deathmatch",
      scoreLimit: 10,
      respawnDelay: 5,
    },
  };
}

export function cyberpunkDeathmatchScene(): SceneData {
  return buildDeathmatch({
    // Chicken_gun source maps are authored for ~1 m mobile-game characters
    // (literal chickens). Previous 2.5× scaling still left the arena
    // ~120 units across, which the player reported as "tiny" — only a
    // few seconds of running covered the whole map. Bumped to 6× so the
    // arena is ~280 units across, comparable to a Quake / Halo CE
    // deathmatch map. Spawn radius scales with it so spawns spread to
    // the perimeter instead of clustering at center, and brazier
    // positions are pushed out the same factor so the neon pools still
    // fall ON the arena landmarks.
    mapKey: "map-cyberpunk",
    mapScale: 6.0,
    spawnRadius: 90,
    enemyCount: 6,
    env: {
      skyColor: "#06061a",
      groundColor: "#0a0a18",
      ambientIntensity: 0.32,
      sunIntensity: 0.28,
      // Cyberpunk vibe: pump bloom hard so the neon braziers visibly
      // bleed across the screen; light SSAO for stone shadows in the
      // alleys; cool blue-shift colour grade.
      visuals: {
        ...DEFAULT_ENV.visuals,
        toneMapping: "ACES",
        exposure: 1.15,
        postFX: {
          ...DEFAULT_ENV.visuals!.postFX,
          bloom: { enabled: true, intensity: 1.4, threshold: 0.7 },
          ssao: { enabled: true, intensity: 0.6, radius: 0.6 },
          vignette: { enabled: true, intensity: 0.4 },
          colorGrade: { contrast: 1.15, saturation: 1.25, temperature: -0.2 },
        },
      },
      // Cyberpunk arena is large + has lots of vertical alleys —
      // tighten cellSize so doorways/walkways resolve cleanly.
      navmeshBake: { cellSize: 0.25, agentRadius: 0.45, maxSlope: 35, walkableClimb: 0.3 },
    },
    brazierLights: [
      { pos: [60, 18, 0], color: "#ff2d8a", intensity: 90, distance: 140 },
      { pos: [-60, 18, 0], color: "#21d4ff", intensity: 90, distance: 140 },
      { pos: [0, 22, 72], color: "#a020f0", intensity: 75, distance: 130 },
      { pos: [0, 22, -72], color: "#39ff14", intensity: 75, distance: 130 },
    ],
  });
}

export function encampmentDeathmatchScene(): SceneData {
  return buildDeathmatch({
    // Same scale-up rationale as cyberpunk above — bumped from 2.5×
    // to 6× so the wooded encampment plays like a real outdoor FPS
    // arena instead of a campsite you can walk across in 3 seconds.
    mapKey: "map-encampment",
    mapScale: 6.0,
    spawnRadius: 95,
    enemyCount: 7,
    env: {
      skyColor: "#0c1018",
      groundColor: "#1f1a14",
      ambientIntensity: 0.28,
      sunIntensity: 0.5,
      // Forest encampment: warm orange firelight, soft bloom, strong
      // vignette to sell the dusk mood.
      visuals: {
        ...DEFAULT_ENV.visuals,
        toneMapping: "ACES",
        exposure: 1.05,
        postFX: {
          ...DEFAULT_ENV.visuals!.postFX,
          bloom: { enabled: true, intensity: 0.7, threshold: 0.8 },
          ssao: { enabled: true, intensity: 0.4, radius: 0.5 },
          vignette: { enabled: true, intensity: 0.45 },
          colorGrade: { contrast: 1.1, saturation: 1.15, temperature: 0.25 },
        },
      },
      // Wooded outdoor terrain — slightly larger cellSize trades
      // blob-size for bake speed since slopes/cover dominate.
      navmeshBake: { cellSize: 0.35, agentRadius: 0.5, maxSlope: 50, walkableClimb: 0.4 },
    },
    brazierLights: [
      { pos: [50, 14, 36], color: "#ff8a3d", intensity: 80, distance: 130 },
      { pos: [-50, 14, -36], color: "#ff8a3d", intensity: 80, distance: 130 },
      { pos: [0, 22, 0], color: "#ffe6a8", intensity: 60, distance: 170 },
    ],
  });
}

export function deserttownDeathmatchScene(): SceneData {
  return buildDeathmatch({
    mapKey: "map-deserttown",
    mapScale: 0.6,
    spawnRadius: 14,
    enemyCount: 6,
    env: {
      skyColor: "#e6c489",
      groundColor: "#b08754",
      ambientIntensity: 0.6,
      sunIntensity: 1.6,
    },
    brazierLights: [
      { pos: [0, 8, 0], color: "#fff2c0", intensity: 8, distance: 40 },
    ],
  });
}

// ─── Fort Royale — RTS (PR-1 of the Warcraft-2-style conversion) ────────────
// Replaces the old battle-royale deathmatch on the same fort GLB. Two bases
// face off at SW vs NE corners with a midfield gold mine and forest patch.
// The player commands one starting peon (auto-gathers the nearest gold node)
// and one starting footman (auto-engages enemy units on sight). The enemy
// base mirrors the layout. The `rts-gamemode` manager seeds 400 gold /
// 200 wood per side and declares win/lose when either town_hall HP hits 0.

const PLAYER_RACE = "warrior" as const;
const ENEMY_RACE = "orc" as const;

interface RTSUnitOpts {
  name: string;
  unit: "peon" | "footman";
  faction: "player" | "enemy";
  race: "warrior" | "orc";
  position: [number, number, number];
  parentId: string;
  /** Stamped onto entity.userData.rtsStats so `rts-footman` reads its
   *  damage / range / speed without importing RACE_LOADOUTS at runtime. */
  stats?: { dmg: number; range: number; speed: number };
}

function rtsUnit(o: RTSUnitOpts): SceneEntity {
  const hp = o.unit === "peon" ? 40 : 90;
  return {
    id: id(),
    name: o.name,
    type: "model",
    model: { url: `builtin:race:${o.race}` },
    transform: {
      position: o.position,
      rotation: [0, o.faction === "player" ? 0 : Math.PI, 0],
      scale: [0.95, 0.95, 0.95],
    },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    behavior: o.unit === "peon" ? "rts-peon" : "rts-footman",
    parentId: o.parentId,
    pendingTerrainSnap: true,
    layer: o.faction === "player" ? "Player" : "NPC",
    raceId: o.race,
    rts: {
      faction: o.faction,
      unit: o.unit,
      hp,
      maxHp: hp,
      ...(o.stats ? { stats: o.stats } : {}),
    },
  };
}

function rtsBuilding(args: {
  name: string;
  building: "town_hall";
  faction: "player" | "enemy";
  position: [number, number, number];
  parentId: string;
}): SceneEntity {
  const hp = 1500;
  return {
    id: id(),
    name: args.name,
    type: "box",
    transform: {
      position: args.position,
      rotation: [0, 0, 0],
      scale: [10, 8, 10],
    },
    material: {
      color: args.faction === "player" ? "#3a6ea8" : "#a83a3a",
      roughness: 0.85,
      metalness: 0.05,
    },
    physics: { bodyType: "fixed", colliderType: "cuboid", mass: 0, restitution: 0.1, friction: 1 },
    // `rts-building` is a passive damage receiver — without it,
    // `rts-footman` attacks on the town hall would no-op and the
    // gamemode win/lose condition would never fire.
    behavior: "rts-building",
    parentId: args.parentId,
    pendingTerrainSnap: true,
    layer: args.faction === "player" ? "Player" : "NPC",
    rts: { faction: args.faction, building: args.building, hp, maxHp: hp },
  };
}

function rtsCreep(args: {
  name: string;
  position: [number, number, number];
  parentId: string;
  /** Override per-creep stats (dmg/range/speed). Falls back to the
   *  in-script `DEFAULT_*` constants in `rts-creep` when omitted. */
  stats?: { dmg?: number; range?: number; speed?: number };
}): SceneEntity {
  const hp = 80;
  return {
    id: id(),
    name: args.name,
    type: "model",
    // The neutral mutant ships in `public/builtin/creature-mutant.glb`
    // (Mixamo-rigged, ~10 MB Draco). The +π yaw offset is registered in
    // BUILTIN_MODEL_YAW_OFFSETS so the model's forward matches its
    // physics body — same convention as the toon-rts race rigs.
    model: { url: "builtin:creature:mutant" },
    transform: {
      position: args.position,
      rotation: [0, 0, 0],
      // Mixamo characters export at ~1m unit scale; bump to 0.022 so
      // they read at roughly footman size on the 50× fort map.
      scale: [0.022, 0.022, 0.022],
    },
    physics: {
      bodyType: "kinematicPosition",
      // No "capsule" in the schema — `cylinder` is the closest standing-
      // humanoid analog and what the toon-rts race units use too.
      colliderType: "cylinder",
      mass: 1,
      restitution: 0.05,
      friction: 1,
    },
    behavior: "rts-creep",
    parentId: args.parentId,
    pendingTerrainSnap: true,
    layer: "NPC",
    rts: {
      faction: "neutral",
      unit: "creep",
      hp,
      maxHp: hp,
      // Bake defaults so `RTSComponent.stats` (all-required) is satisfied
      // and the in-script DEFAULT_* constants stay as a single source of
      // truth — overrides from `args.stats` win.
      stats: { dmg: 14, range: 1.8, speed: 3.6, ...(args.stats ?? {}) },
    },
  };
}

function rtsResourceNode(args: {
  name: string;
  kind: "gold" | "wood";
  amount: number;
  position: [number, number, number];
  parentId: string;
}): SceneEntity {
  return {
    id: id(),
    name: args.name,
    type: args.kind === "gold" ? "box" : "cylinder",
    transform: {
      position: args.position,
      rotation: [0, 0, 0],
      scale: args.kind === "gold" ? [4, 2.5, 4] : [3, 6, 3],
    },
    material: {
      color: args.kind === "gold" ? "#e0b840" : "#3d6b3d",
      emissive: args.kind === "gold" ? "#553f10" : "#0a1408",
      roughness: 0.6,
      metalness: args.kind === "gold" ? 0.7 : 0.05,
    },
    physics: { bodyType: "fixed", colliderType: "cuboid", mass: 0, restitution: 0.1, friction: 1 },
    parentId: args.parentId,
    pendingTerrainSnap: true,
    layer: "Default",
    rts: {
      faction: "neutral",
      hp: 1,
      maxHp: 1,
      resource: { kind: args.kind, amount: args.amount },
    },
  };
}

export function rtsFortRoyaleScene(): SceneData {
  const entities: SceneEntity[] = [];

  // ── Map (reuses the fort-royale GLB at the same 50× scale) ─────────────
  const mapGroupId = id();
  entities.push(group(mapGroupId, "Map", { layer: "Terrain", surface: "Walk" }));
  entities.push({
    id: id(),
    name: "MapModel",
    type: "model",
    model: { url: "builtin:map-fort-royale" },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [50, 50, 50] },
    parentId: mapGroupId,
    physics: { bodyType: "fixed", colliderType: "trimesh", mass: 0, restitution: 0.1, friction: 1 },
  });
  entities.push(
    ent({
      name: "Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [200, 200, 1],
      color: "#1c1810",
      roughness: 1,
      metalness: 0,
      fixed: true,
      parentId: mapGroupId,
      layer: "Terrain",
      surface: "Walk",
    }),
  );

  // ── Player base (SW corner of the fort) ────────────────────────────────
  const playerGroupId = id();
  entities.push(group(playerGroupId, "PlayerBase", { layer: "Player" }));
  const PB: [number, number, number] = [-380, 0, -380];
  entities.push(rtsBuilding({ name: "PlayerTownHall", building: "town_hall", faction: "player", position: PB, parentId: playerGroupId }));
  entities.push(rtsUnit({ name: "PlayerPeon", unit: "peon", faction: "player", race: PLAYER_RACE, position: [PB[0] + 14, 0, PB[2]], parentId: playerGroupId }));
  entities.push(rtsUnit({
    name: "PlayerFootman", unit: "footman", faction: "player", race: PLAYER_RACE,
    position: [PB[0] + 14, 0, PB[2] + 14], parentId: playerGroupId,
    stats: { dmg: 12, range: 1.6, speed: 4.5 },
  }));

  // ── Enemy base (NE corner, mirrored) ───────────────────────────────────
  const enemyGroupId = id();
  entities.push(group(enemyGroupId, "EnemyBase", { layer: "NPC" }));
  const EB: [number, number, number] = [380, 0, 380];
  entities.push(rtsBuilding({ name: "EnemyTownHall", building: "town_hall", faction: "enemy", position: EB, parentId: enemyGroupId }));
  entities.push(rtsUnit({ name: "EnemyPeon", unit: "peon", faction: "enemy", race: ENEMY_RACE, position: [EB[0] - 14, 0, EB[2]], parentId: enemyGroupId }));
  entities.push(rtsUnit({
    name: "EnemyFootman", unit: "footman", faction: "enemy", race: ENEMY_RACE,
    position: [EB[0] - 14, 0, EB[2] - 14], parentId: enemyGroupId,
    stats: { dmg: 14, range: 1.6, speed: 4.3 },
  }));

  // ── Resource group (midfield: 2 gold + 1 forest patch) ─────────────────
  const resGroupId = id();
  entities.push(group(resGroupId, "Resources"));
  entities.push(rtsResourceNode({ name: "GoldMine_PlayerSide", kind: "gold", amount: 1500, position: [-200, 0, -200], parentId: resGroupId }));
  entities.push(rtsResourceNode({ name: "GoldMine_EnemySide",  kind: "gold", amount: 1500, position: [ 200, 0,  200], parentId: resGroupId }));
  entities.push(rtsResourceNode({ name: "Forest_Mid",          kind: "wood", amount: 1200, position: [   0, 0,    0], parentId: resGroupId }));

  // ── Neutral creep camps (3 mutant POI guards) ──────────────────────────
  // Each camp is leashed near its POI so creeps don't path off across
  // the map; players must clear the camp to safely harvest the resource.
  const creepGroupId = id();
  entities.push(group(creepGroupId, "NeutralCamps", { layer: "NPC" }));
  const CAMPS: Array<{ name: string; anchor: [number, number, number]; size: number }> = [
    { name: "Camp_PlayerGold", anchor: [-200, 0, -200], size: 2 },
    { name: "Camp_EnemyGold",  anchor: [ 200, 0,  200], size: 2 },
    { name: "Camp_MidForest",  anchor: [   0, 0,    0], size: 3 },
  ];
  for (const camp of CAMPS) {
    for (let i = 0; i < camp.size; i++) {
      // Ring of mutants around each POI (radius ~6m).
      const angle = (i / camp.size) * Math.PI * 2;
      const offset: [number, number, number] = [
        camp.anchor[0] + Math.cos(angle) * 6,
        0,
        camp.anchor[2] + Math.sin(angle) * 6,
      ];
      entities.push(rtsCreep({
        name: camp.name + "_Mutant_" + (i + 1),
        position: offset,
        parentId: creepGroupId,
      }));
    }
  }

  // ── Lighting (carry over the BR template's torchlit fort mood) ─────────
  const lightingGroupId = id();
  entities.push(group(lightingGroupId, "Lighting"));
  for (const pos of [[300, 80, 300], [-300, 80, 300], [300, 80, -300], [-300, 80, -300]] as Array<[number, number, number]>) {
    entities.push(
      ent({
        name: "Brazier",
        type: "light",
        position: pos,
        light: { kind: "point", color: "#ff8a3d", intensity: 600, distance: 900 },
        parentId: lightingGroupId,
      }),
    );
  }

  // ── GameLogic — single rts-gamemode manager ────────────────────────────
  const logicGroupId = id();
  entities.push(group(logicGroupId, "GameLogic"));
  entities.push({
    id: id(),
    name: "RTSGameManager",
    type: "empty",
    transform: { position: [0, -50, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    behavior: "rts-gamemode",
    parentId: logicGroupId,
  });

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      skyColor: "#1a1410",
      groundColor: "#2a1f14",
      ambientIntensity: 0.45,
      sunIntensity: 0.7,
      visuals: {
        ...DEFAULT_ENV.visuals,
        toneMapping: "ACES",
        exposure: 1.0,
        postFX: {
          ...DEFAULT_ENV.visuals!.postFX,
          bloom: { enabled: true, intensity: 0.55, threshold: 0.82 },
          ssao: { enabled: true, intensity: 0.7, radius: 0.7 },
          vignette: { enabled: true, intensity: 0.35 },
          colorGrade: { contrast: 1.1, saturation: 0.95, temperature: 0.1 },
        },
      },
      // Same large-scale navmesh tuning as the old BR template — the
      // 50× fort needs 1.5 m cells to bake quickly.
      navmeshBake: { cellSize: 1.5, cellHeight: 0.6, agentRadius: 0.6, agentHeight: 2.0, maxSlope: 40, walkableClimb: 0.5 },
      // RTS overhead camera — orbit looking down at the player base.
      cameraMode: "rts",
      cameraStart: {
        position: [PB[0], 220, PB[2] + 220],
        target: PB,
      },
      gameMode: "rts",
    },
  };
}

// Yard — open-air industrial yard. Daylight, neutral ambient, no mood lights
// (the sun handles it).
export function yardDeathmatchScene(): SceneData {
  return buildDeathmatch({
    mapKey: "map-yard",
    mapScale: 0.6,
    spawnRadius: 14,
    enemyCount: 6,
    env: {
      skyColor: "#9bb6c8",
      groundColor: "#5e6168",
      ambientIntensity: 0.7,
      sunIntensity: 1.4,
    },
    brazierLights: [],
  });
}

// Winter Base — snow-covered fortified base. Cool blue ambient + a low
// silver sun to mimic overcast winter light.
export function winterBaseDeathmatchScene(): SceneData {
  return buildDeathmatch({
    mapKey: "map-winter-base",
    mapScale: 0.6,
    spawnRadius: 14,
    enemyCount: 6,
    env: {
      skyColor: "#cdd9e6",
      groundColor: "#8a99ad",
      ambientIntensity: 0.75,
      sunIntensity: 1.0,
    },
    brazierLights: [
      { pos: [0, 6, 8], color: "#cfe6ff", intensity: 10, distance: 26 },
      { pos: [0, 6, -8], color: "#cfe6ff", intensity: 10, distance: 26 },
    ],
  });
}
