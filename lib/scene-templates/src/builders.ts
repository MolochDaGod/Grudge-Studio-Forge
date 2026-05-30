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
  forgeScene: "builtin:forge-scene",
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

  // Visible village map (no physics — handled by the invisible Ground
  // plane below, same pattern as the deathmatch templates).
  entities.push({
    id: id(),
    name: "Map",
    type: "model",
    model: { url: "builtin:map-deserttown" },
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.6, 0.6, 0.6],
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
      color: "#b08754",
      roughness: 1,
      metalness: 0,
      fixed: true,
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

  // Player — Warrior at center plaza, holding the warrior's sword.
  // raceId stamps the warrior's baseStats (HP 100, speed 5.0, damage 12)
  // onto the player so player-rpg + the camera controller use them.
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "model",
    model: { url: "builtin:race:warrior" },
    raceId: "warrior",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    physics: {
      bodyType: "kinematicPosition",
      colliderType: "cylinder",
      mass: 1,
      restitution: 0,
      friction: 0.6,
    },
    controllerKind: "thirdPerson",
    behavior: "player-rpg",
    parentId: null,
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
        scale: [1, 1, 1],
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
      parentId: null,
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
        scale: [1, 1, 1],
      },
      physics: {
        bodyType: "kinematicPosition",
        colliderType: "cylinder",
        mass: 1,
        restitution: 0.2,
        friction: 0.8,
      },
      behavior: "enemy-rpg",
      parentId: null,
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

  // Lighting — warm directional sun + soft hemisphere ambient (matches
  // the deserttown tone). The sun is encoded as a directional light
  // entity; ambient/hemisphere is driven by the environment fields.
  entities.push(
    ent({
      name: "Sun",
      type: "light",
      position: [12, 18, 8],
      light: { kind: "directional", color: "#ffe6b8", intensity: 4 },
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

// Fort Royale — small medieval-style castle map (9.7 MB GLB, fastest of the
// shooter maps to load). Warm torchlight + dim ambient so the stone walls
// and braziers read clearly.
export function fortRoyaleDeathmatchScene(): SceneData {
  return buildDeathmatch({
    // Cranked to 50× per user request — the previous 7× still felt
    // tiny, so this is now an open-world-scale fort (~2 km across)
    // that you actually have to traverse. Spawn radius pushed to 540
    // so the six spawn points sit out by the perimeter walls instead
    // of clustering at the courtyard center, and the four corner
    // brazier lights pushed out + boosted in range so they stay
    // visible at this footprint without going pitch black between.
    mapKey: "map-fort-royale",
    mapScale: 50.0,
    spawnRadius: 540,
    enemyCount: 6,
    env: {
      skyColor: "#1a1410",
      groundColor: "#2a1f14",
      ambientIntensity: 0.35,
      sunIntensity: 0.45,
    },
    brazierLights: [
      { pos: [300, 80, 300], color: "#ff8a3d", intensity: 600, distance: 900 },
      { pos: [-300, 80, 300], color: "#ff8a3d", intensity: 600, distance: 900 },
      { pos: [300, 80, -300], color: "#ff8a3d", intensity: 600, distance: 900 },
      { pos: [-300, 80, -300], color: "#ff8a3d", intensity: 600, distance: 900 },
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

// ─── Forge Dungeon Interior (Prefab Template) ────────────────────────────────
//
// 822-mesh dungeon interior from forge-scene.glb, structured as a proper
// parent-child prefab with editable layers:
//   • Root "Dungeon Interior" (empty) — move/rotate the whole dungeon
//     • Structure (model) — the full 822-mesh GLB (doors, walls, floors)
//     • Props (empty) — group for rubble, blood splats, debris
//     • Lighting (empty) — group for torch/brazier lights
//     • Spawn Points (empty) — group for player/enemy spawn markers
//     • Collision (plane) — invisible walkable floor
//
// The GLB itself contains the full dungeon structure (Dungeons_0_3 with 286
// child groups covering doors, props, rubble, blood splats). The prefab wraps
// it with editor-friendly layers so individual rooms, props, and effects can
// be toggled, moved, or replaced without losing the parent relationship.

export function forgeDungeonInteriorScene(): SceneData {
  const entities: SceneEntity[] = [];

  // ── Root — the prefab parent everything attaches to
  const rootId = id();
  entities.push({
    id: rootId,
    name: "Dungeon Interior",
    type: "empty",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: null,
  });

  // ── Structure — the full dungeon GLB model
  entities.push({
    id: id(),
    name: "Structure",
    type: "model",
    model: { url: ASSETS.forgeScene },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: rootId,
  });

  // ── Props layer — group for user-placed decorative items
  const propsId = id();
  entities.push({
    id: propsId,
    name: "Props",
    type: "empty",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: rootId,
  });

  // Sample props: a few crates and barrels scattered in the dungeon
  const propPositions: [string, [number, number, number]][] = [
    ["Crate A", [3, 0.4, 2]],
    ["Crate B", [-2, 0.4, 5]],
    ["Barrel A", [6, 0.5, -1]],
    ["Barrel B", [-4, 0.5, -3]],
  ];
  for (const [name, pos] of propPositions) {
    entities.push(
      ent({
        name,
        type: name.startsWith("Barrel") ? "cylinder" : "box",
        position: pos,
        scale: name.startsWith("Barrel") ? [0.4, 0.8, 0.4] : [0.7, 0.7, 0.7],
        color: name.startsWith("Barrel") ? "#5e3a1a" : "#7a5e2e",
        roughness: 0.85,
        fixed: true,
        parentId: propsId,
      }),
    );
  }

  // ── Lighting layer — torch and ambient lights for the dungeon
  const lightingId = id();
  entities.push({
    id: lightingId,
    name: "Lighting",
    type: "empty",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: rootId,
  });

  const torchPositions: [string, [number, number, number]][] = [
    ["Torch Entry", [0, 3, 0]],
    ["Torch Hall A", [5, 3, 4]],
    ["Torch Hall B", [-5, 3, 4]],
    ["Torch Chamber", [0, 3.5, 8]],
    ["Torch Deep", [3, 3, -6]],
    ["Torch Alcove", [-3, 3, -6]],
  ];
  for (const [name, pos] of torchPositions) {
    entities.push(
      ent({
        name,
        type: "light",
        position: pos,
        light: { kind: "point", color: "#ff8a3d", intensity: 8, distance: 12 },
        parentId: lightingId,
      }),
    );
  }

  // ── Spawn Points layer
  const spawnsId = id();
  entities.push({
    id: spawnsId,
    name: "Spawn Points",
    type: "empty",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: rootId,
  });

  const spawnPositions: [string, [number, number, number]][] = [
    ["Spawn_Entry", [0, 0, -2]],
    ["Spawn_Hall", [0, 0, 5]],
    ["Spawn_Chamber", [4, 0, 8]],
    ["Spawn_Deep", [-4, 0, -8]],
  ];
  for (const [name, pos] of spawnPositions) {
    entities.push({
      id: id(),
      name,
      type: "empty",
      transform: { position: pos, rotation: [0, 0, 0], scale: [1, 1, 1] },
      parentId: spawnsId,
    });
  }

  // ── Collision floor (invisible, fixed physics body)
  entities.push(
    ent({
      name: "Collision Floor",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [100, 100, 1],
      color: "#1a1a1a",
      roughness: 1,
      metalness: 0,
      fixed: true,
      parentId: rootId,
    }),
  );

  // ── Player at entry
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "model",
    model: { url: ASSETS.character },
    transform: { position: [0, 0, -2], rotation: [0, 0, 0], scale: [1, 1, 1] },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    controllerKind: "thirdPerson",
    parentId: null,
  });

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      skyColor: "#0a0808",
      groundColor: "#1a1210",
      ambientIntensity: 0.2,
      sunIntensity: 0.15,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      playerMoveSpeed: 4,
    },
  };
}

// ─── Survival Camp Demo ─────────────────────────────────────────────────────
//
// Showcases the survivor character, skeleton enemies with weapons,
// animated fire VFX, a camp tent prop, and the weapon equip system.
// Player is the Survivor Male with a parented rifle; 4 skeleton
// enemies patrol the perimeter with seek + health behaviors.
// The tent sits at center camp with a fire animation beside it.
// Ambient crow patrols the sky. VFX explosions at spawn points.

export function survivalCampDemoScene(): SceneData {
  const entities: SceneEntity[] = [];

  // Map — use the encampment (forest camp mood)
  entities.push({
    id: id(),
    name: "Map",
    type: "model",
    model: { url: "builtin:map-encampment" },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    parentId: null,
  });

  // Invisible collision ground
  entities.push(
    ent({
      name: "Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [200, 200, 1],
      color: "#2a2418",
      roughness: 1,
      metalness: 0,
      fixed: true,
    }),
  );

  // ── Camp center: tent + campfire ──
  const campId = id();
  entities.push({
    id: campId,
    name: "Camp",
    type: "empty",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: null,
  });

  // Survivor tent
  entities.push({
    id: id(),
    name: "Tent",
    type: "model",
    model: { url: "builtin:prop-survivors-tent" },
    transform: { position: [3, 0, 0], rotation: [0, -Math.PI / 4, 0], scale: [1.2, 1.2, 1.2] },
    parentId: campId,
  });

  // Campfire (animated fire VFX)
  entities.push({
    id: id(),
    name: "Campfire",
    type: "model",
    model: { url: "builtin:vfx-fire-anim" },
    transform: { position: [0, 0, 2], rotation: [0, 0, 0], scale: [0.3, 0.3, 0.3] },
    parentId: campId,
  });

  // Campfire light
  entities.push(
    ent({
      name: "Campfire Light",
      type: "light",
      position: [0, 2, 2],
      light: { kind: "point", color: "#ff8a3d", intensity: 12, distance: 18 },
      parentId: campId,
    }),
  );

  // ── Player: Survivor Male with weapon ──
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "model",
    model: { url: "builtin:char-survivor-male" },
    transform: { position: [0, 0, -3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    controllerKind: "thirdPerson",
    behavior: "player-deathmatch",
    parentId: null,
  });

  // Player weapon (rifle parented to right hand)
  entities.push({
    id: id(),
    name: "Rifle",
    type: "model",
    model: { url: ASSETS.rifle },
    transform: { position: [0.32, 1.25, 0.25], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
    parentId: playerId,
  });

  // ── Skeleton enemies (4 around the perimeter) ──
  const SKELETONS: { name: string; model: string; pos: [number, number, number]; angle: number }[] = [
    { name: "Skeleton Swordsman 1", model: "builtin:char-skeleton-sword", pos: [12, 0, 8], angle: Math.PI },
    { name: "Skeleton Swordsman 2", model: "builtin:char-skeleton-sword", pos: [-10, 0, 6], angle: 0 },
    { name: "Skeleton Axeman 1",    model: "builtin:char-skeleton-axe",   pos: [8, 0, -10], angle: Math.PI / 2 },
    { name: "Skeleton Axeman 2",    model: "builtin:char-skeleton-axe",   pos: [-8, 0, -12], angle: -Math.PI / 4 },
  ];
  for (const sk of SKELETONS) {
    entities.push({
      id: id(),
      name: sk.name,
      type: "model",
      model: { url: sk.model, tint: "#aaffaa" },
      transform: { position: sk.pos, rotation: [0, sk.angle, 0], scale: [1, 1, 1] },
      physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0.2, friction: 0.8 },
      behavior: "enemy-deathmatch",
      parentId: null,
    });
  }

  // ── Ambient crow (patrols overhead) ──
  entities.push({
    id: id(),
    name: "Crow",
    type: "model",
    model: { url: "builtin:char-crow" },
    transform: { position: [5, 6, 5], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
    parentId: null,
  });

  // ── VFX markers at spawn points ──
  const SPAWNS: [string, [number, number, number]][] = [
    ["Spawn_Camp", [-2, 0, -4]],
    ["Spawn_East", [14, 0, 0]],
    ["Spawn_West", [-14, 0, 0]],
    ["Spawn_North", [0, 0, 14]],
  ];
  for (const [name, pos] of SPAWNS) {
    entities.push({
      id: id(),
      name,
      type: "empty",
      transform: { position: pos, rotation: [0, 0, 0], scale: [1, 1, 1] },
      behavior: "spawnpoint",
      parentId: null,
    });
    // VFX freeze effect at each spawn (visual marker)
    entities.push({
      id: id(),
      name: `${name} VFX`,
      type: "model",
      model: { url: "builtin:vfx-freeze" },
      transform: { position: [pos[0], pos[1] + 0.5, pos[2]], rotation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
      parentId: null,
    });
  }

  // ── Atmosphere lights ──
  entities.push(
    ent({
      name: "Moon Light",
      type: "light",
      position: [0, 20, 0],
      light: { kind: "directional", color: "#b8c8e0", intensity: 2 },
    }),
  );
  entities.push(
    ent({
      name: "Rim Light East",
      type: "light",
      position: [15, 5, 0],
      light: { kind: "point", color: "#4488ff", intensity: 8, distance: 25 },
    }),
  );

  // ── Hidden game manager ──
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
      skyColor: "#0c1018",
      groundColor: "#1a1410",
      ambientIntensity: 0.25,
      sunIntensity: 0.4,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      playerMoveSpeed: 5,
      gameMode: "deathmatch",
      scoreLimit: 10,
      respawnDelay: 5,
    },
  };
}

// ─── City Sandbox (Dude Theft Wars map) ─────────────────────────────────────
//
// GTA-style low-poly city sandbox: 7009 nodes, 3105 meshes, 46 materials.
// The map includes buildings, interiors, shops, farms, airports, mountains,
// roads, vehicles, weapons, billboards, dumpsters, and environmental props.
// Draco-compressed from 71 MB → 10 MB.
//
// Template spawns a third-person player with a rifle on the map center,
// with a large collision ground plane and warm daytime lighting.
// No enemies by default — this is a sandbox / exploration starter.

export function citySandboxScene(): SceneData {
  const entities: SceneEntity[] = [];

  // ── City map model ──
  entities.push({
    id: id(),
    name: "City Map",
    type: "model",
    model: { url: "builtin:map-dude-theft-city" },
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      // The map is authored at a very large scale (coords in the 10000s);
      // scale it down so it fits the default Rapier world and camera.
      scale: [0.01, 0.01, 0.01],
    },
    parentId: null,
  });

  // ── Collision ground ──
  entities.push(
    ent({
      name: "Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [500, 500, 1],
      color: "#2a2a2a",
      roughness: 1,
      metalness: 0,
      fixed: true,
    }),
  );

  // ── Player (third-person with rifle) ──
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

  entities.push({
    id: id(),
    name: "Rifle",
    type: "model",
    model: { url: ASSETS.rifle },
    transform: { position: [0.32, 1.25, 0.25], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
    parentId: playerId,
  });

  // ── Spawn points (four corners of the city) ──
  const citySpawns: [string, [number, number, number]][] = [
    ["Spawn_Center", [0, 0, 0]],
    ["Spawn_North", [0, 0, 40]],
    ["Spawn_South", [0, 0, -40]],
    ["Spawn_East", [40, 0, 0]],
    ["Spawn_West", [-40, 0, 0]],
  ];
  for (const [name, pos] of citySpawns) {
    entities.push({
      id: id(),
      name,
      type: "empty",
      transform: { position: pos, rotation: [0, 0, 0], scale: [1, 1, 1] },
      behavior: "spawnpoint",
      parentId: null,
    });
  }

  // ── Daytime lighting ──
  entities.push(
    ent({
      name: "Sun",
      type: "light",
      position: [50, 60, 30],
      light: { kind: "directional", color: "#fff5e0", intensity: 3 },
    }),
  );
  entities.push(
    ent({
      name: "Fill Light",
      type: "light",
      position: [-20, 15, -20],
      light: { kind: "point", color: "#88aaff", intensity: 6, distance: 80 },
    }),
  );

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      skyColor: "#87CEEB",
      groundColor: "#4a7a4a",
      ambientIntensity: 0.7,
      sunIntensity: 1.2,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      playerMoveSpeed: 8,
    },
  };
}
