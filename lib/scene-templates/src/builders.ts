import type {
  SceneData,
  SceneEntity,
  ControllerKind,
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
  if (!o.noPhysics && o.type !== "light" && o.type !== "camera" && o.type !== "empty") {
    e.physics = o.fixed
      ? { bodyType: "fixed", colliderType: "cuboid", mass: 0, restitution: 0.2, friction: 1 }
      : { bodyType: "dynamic", colliderType: o.type === "sphere" ? "ball" : "cuboid", mass: 1, restitution: 0.4, friction: 0.6 };
  }
  return e;
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

  // Ground (invisible-ish — hemisphere light gives a much better fill now,
  // so the bumped sun/ambient below paints the GLBs nicely).
  entities.push(
    ent({
      name: "Graveyard Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [60, 60, 1],
      color: "#1a1a26",
      roughness: 0.95,
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

  // Spawn points (six on a ring at r=10). The deathmatch behaviors look
  // these up by name prefix `Spawn_` so respawn after death works. The
  // player and zombies both use them.
  const SPAWN_R = 10;
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
    const r = 8;
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

  // Crypt walls — 4 boxes parented to a "Crypt" empty. These act as
  // line-of-sight breakers so the AI's raycast LoS check actually does
  // something interesting (otherwise on an open plane every enemy sees
  // the player at all times).
  const cryptId = id();
  entities.push({
    id: cryptId,
    name: "Crypt",
    type: "empty",
    transform: { position: [-12, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: null,
  });
  const wallH = 2.5;
  const wallSpecs: { pos: [number, number, number]; scale: [number, number, number] }[] = [
    { pos: [0, wallH / 2, 3], scale: [6, wallH, 0.3] },
    { pos: [0, wallH / 2, -3], scale: [6, wallH, 0.3] },
    { pos: [3, wallH / 2, 0], scale: [0.3, wallH, 6] },
    { pos: [-3, wallH / 2, 0], scale: [0.3, wallH, 6] },
  ];
  for (let i = 0; i < wallSpecs.length; i++) {
    entities.push(
      ent({
        name: `Crypt Wall ${i + 1}`,
        type: "box",
        parentId: cryptId,
        position: wallSpecs[i].pos,
        scale: wallSpecs[i].scale,
        color: "#3a3a48",
        roughness: 0.95,
        fixed: true,
      }),
    );
  }

  // Brazier light (warm point light over the crypt).
  entities.push(
    ent({
      name: "Brazier Light",
      type: "light",
      position: [-12, 4, 0],
      light: { kind: "point", color: "#ff7a2a", intensity: 14, distance: 22 },
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

  // Arena root (empty)
  const arenaId = id();
  entities.push({
    id: arenaId,
    name: "Arena",
    type: "empty",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: null,
  });

  // Floor
  entities.push(
    ent({
      name: "Arena Floor",
      type: "plane",
      parentId: arenaId,
      rotation: [-Math.PI / 2, 0, 0],
      scale: [30, 30, 1],
      color: "#1f1f2c",
      roughness: 0.85,
      fixed: true,
    }),
  );
  // Four walls parented to arena root
  const wallH = 5;
  const arenaR = 15;
  const arenaWalls: { pos: [number, number, number]; scale: [number, number, number] }[] = [
    { pos: [0, wallH / 2, arenaR], scale: [arenaR * 2, wallH, 0.4] },
    { pos: [0, wallH / 2, -arenaR], scale: [arenaR * 2, wallH, 0.4] },
    { pos: [arenaR, wallH / 2, 0], scale: [0.4, wallH, arenaR * 2] },
    { pos: [-arenaR, wallH / 2, 0], scale: [0.4, wallH, arenaR * 2] },
  ];
  for (let i = 0; i < arenaWalls.length; i++) {
    entities.push(
      ent({
        name: `Wall ${i + 1}`,
        type: "box",
        parentId: arenaId,
        position: arenaWalls[i].pos,
        scale: arenaWalls[i].scale,
        color: "#2a2a3a",
        metalness: 0.4,
        roughness: 0.7,
        fixed: true,
      }),
    );
  }

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
      parentId: arenaId,
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

  // Visible map (no physics). The big GLB drives the look; physics is handled
  // by the invisible ground plane below so the player can't fall through.
  entities.push({
    id: id(),
    name: "Map",
    type: "model",
    model: { url: `builtin:${opts.mapKey}` },
    transform: {
      position: [0, 0, 0],
      rotation: [0, opts.mapRotationY ?? 0, 0],
      scale: [opts.mapScale, opts.mapScale, opts.mapScale],
    },
    parentId: null,
  });

  // Invisible collision ground.
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
    }),
  );

  // Player.
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

  // Spawn points (six on a ring; each enemy + player picks one at respawn).
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
      parentId: null,
    });
  }

  // Enemies.
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
      parentId: null,
    });
  }

  // Mood lights specific to the setting.
  for (const bl of opts.brazierLights ?? []) {
    entities.push(
      ent({
        name: `Mood Light`,
        type: "light",
        position: bl.pos,
        light: { kind: "point", color: bl.color, intensity: bl.intensity, distance: bl.distance },
      }),
    );
  }

  // Hidden game manager.
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
      ...opts.env,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      gameMode: "deathmatch",
      scoreLimit: 10,
      respawnDelay: 5,
    },
  };
}

export function cyberpunkDeathmatchScene(): SceneData {
  return buildDeathmatch({
    mapKey: "map-cyberpunk",
    mapScale: 0.6,
    spawnRadius: 14,
    enemyCount: 6,
    env: {
      skyColor: "#06061a",
      groundColor: "#0a0a18",
      ambientIntensity: 0.32,
      sunIntensity: 0.28,
    },
    brazierLights: [
      { pos: [10, 5, 0], color: "#ff2d8a", intensity: 22, distance: 28 },
      { pos: [-10, 5, 0], color: "#21d4ff", intensity: 22, distance: 28 },
      { pos: [0, 6, 12], color: "#a020f0", intensity: 18, distance: 26 },
      { pos: [0, 6, -12], color: "#39ff14", intensity: 18, distance: 26 },
    ],
  });
}

export function encampmentDeathmatchScene(): SceneData {
  return buildDeathmatch({
    mapKey: "map-encampment",
    mapScale: 0.5,
    spawnRadius: 16,
    enemyCount: 7,
    env: {
      skyColor: "#0c1018",
      groundColor: "#1f1a14",
      ambientIntensity: 0.28,
      sunIntensity: 0.5,
    },
    brazierLights: [
      { pos: [8, 4, 6], color: "#ff8a3d", intensity: 16, distance: 24 },
      { pos: [-8, 4, -6], color: "#ff8a3d", intensity: 16, distance: 24 },
      { pos: [0, 6, 0], color: "#ffe6a8", intensity: 12, distance: 32 },
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

// Fort Royale — small medieval-style castle map (9.7 MB GLB, fastest of the
// shooter maps to load). Warm torchlight + dim ambient so the stone walls
// and braziers read clearly.
export function fortRoyaleDeathmatchScene(): SceneData {
  return buildDeathmatch({
    mapKey: "map-fort-royale",
    mapScale: 0.6,
    spawnRadius: 12,
    enemyCount: 6,
    env: {
      skyColor: "#1a1410",
      groundColor: "#2a1f14",
      ambientIntensity: 0.35,
      sunIntensity: 0.45,
    },
    brazierLights: [
      { pos: [6, 4, 6], color: "#ff8a3d", intensity: 18, distance: 22 },
      { pos: [-6, 4, 6], color: "#ff8a3d", intensity: 18, distance: 22 },
      { pos: [6, 4, -6], color: "#ff8a3d", intensity: 18, distance: 22 },
      { pos: [-6, 4, -6], color: "#ff8a3d", intensity: 18, distance: 22 },
    ],
  });
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
