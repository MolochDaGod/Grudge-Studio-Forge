import { nanoid } from "nanoid";
import type { SceneData, SceneEntity, ControllerKind } from "@/scene/types";
import { DEFAULT_ENV } from "@/scene/types";

const id = () => nanoid(8);

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
  if (o.controllerKind) e.controllerKind = o.controllerKind;
  if (!o.noPhysics && o.type !== "light" && o.type !== "camera" && o.type !== "empty") {
    e.physics = o.fixed
      ? { bodyType: "fixed", colliderType: "cuboid", mass: 0, restitution: 0.2, friction: 1 }
      : { bodyType: "dynamic", colliderType: o.type === "sphere" ? "ball" : "cuboid", mass: 1, restitution: 0.4, friction: 0.6 };
  }
  return e;
};

/** Third-person zombie shooter sandbox inspired by YetAnotherZombieHorror.
 *  Player capsule with a parented "weapon" empty + 6 zombie boxes spread
 *  around a fenced graveyard plane. */
export function tpsZombieDemoScene(): SceneData {
  const entities: SceneEntity[] = [];

  // Ground
  entities.push(
    ent({
      name: "Graveyard Ground",
      type: "plane",
      rotation: [-Math.PI / 2, 0, 0],
      scale: [40, 40, 1],
      color: "#1a1a26",
      roughness: 0.95,
      metalness: 0,
      fixed: true,
    }),
  );

  // Player root (kinematic capsule-shaped box)
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "cylinder",
    transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [0.6, 1.6, 0.6] },
    material: { color: "#d4af37", metalness: 0.3, roughness: 0.5, emissive: "#3a2a08" },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    controllerKind: "thirdPerson",
    parentId: null,
  });

  // Weapon parented to player — child inherits player transform
  entities.push(
    ent({
      name: "Weapon Slot",
      type: "box",
      parentId: playerId,
      position: [0.6, 0.2, 0.4],
      scale: [0.15, 0.15, 0.6],
      color: "#2a2a36",
      metalness: 0.7,
      roughness: 0.3,
      noPhysics: true,
    }),
  );
  entities.push(
    ent({
      name: "Muzzle",
      type: "sphere",
      parentId: playerId,
      position: [0.6, 0.2, 0.75],
      scale: [0.08, 0.08, 0.08],
      color: "#ff8a3d",
      emissive: "#ff5500",
      noPhysics: true,
    }),
  );

  // Six zombies in a ring
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const r = 8;
    entities.push(
      ent({
        name: `Zombie ${i + 1}`,
        type: "box",
        position: [Math.cos(angle) * r, 1, Math.sin(angle) * r],
        scale: [0.7, 1.8, 0.7],
        color: "#5a6a3a",
        emissive: "#1a2200",
        roughness: 0.9,
      }),
    );
  }

  // Crypt walls — 4 boxes parented to a "Crypt" empty
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

  // Brazier light
  entities.push(
    ent({
      name: "Brazier Light",
      type: "light",
      position: [-12, 4, 0],
      light: { kind: "point", color: "#ff7a2a", intensity: 14, distance: 22 },
    }),
  );

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      skyColor: "#070710",
      groundColor: "#1a1a26",
      ambientIntensity: 0.18,
      sunIntensity: 0.45,
      cameraMode: "thirdPerson",
      cameraTargetEntityId: playerId,
      playerMoveSpeed: 6,
    },
  };
}

/** First-person arena — closed room with player, weapon mount,
 *  three turret blocks, and a few breakable crates. */
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

  // Player
  const playerId = id();
  entities.push({
    id: playerId,
    name: "Player",
    type: "cylinder",
    transform: { position: [0, 1, 6], rotation: [0, 0, 0], scale: [0.5, 1.7, 0.5] },
    material: { color: "#d4af37", metalness: 0.3, roughness: 0.5, emissive: "#3a2a08" },
    physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, restitution: 0, friction: 0.6 },
    controllerKind: "firstPerson",
    parentId: null,
  });
  // Weapon group parented to player (FPS-style)
  entities.push(
    ent({
      name: "Weapon Mount",
      type: "box",
      parentId: playerId,
      position: [0.35, 0.1, -0.5],
      scale: [0.18, 0.2, 0.7],
      color: "#1a1a22",
      metalness: 0.8,
      roughness: 0.25,
      noPhysics: true,
    }),
  );
  entities.push(
    ent({
      name: "Muzzle Flash",
      type: "sphere",
      parentId: playerId,
      position: [0.35, 0.1, -0.9],
      scale: [0.1, 0.1, 0.1],
      color: "#ffd070",
      emissive: "#ff7a2a",
      noPhysics: true,
    }),
  );

  // Three turrets in a triangle
  const turretPositions: [number, number, number][] = [
    [0, 0, -10],
    [-9, 0, -4],
    [9, 0, -4],
  ];
  for (let i = 0; i < turretPositions.length; i++) {
    const tId = id();
    entities.push({
      id: tId,
      name: `Turret ${i + 1}`,
      type: "box",
      transform: { position: turretPositions[i], rotation: [0, 0, 0], scale: [1, 0.8, 1] },
      material: { color: "#3a3344", metalness: 0.6, roughness: 0.4 },
      physics: { bodyType: "fixed", colliderType: "cuboid", mass: 0, restitution: 0.2, friction: 1 },
      parentId: arenaId,
    });
    entities.push(
      ent({
        name: `Turret ${i + 1} Barrel`,
        type: "cylinder",
        parentId: tId,
        position: [0, 0.8, 0.6],
        rotation: [Math.PI / 2, 0, 0],
        scale: [0.15, 1.2, 0.15],
        color: "#222230",
        metalness: 0.8,
        roughness: 0.3,
        fixed: true,
      }),
    );
    entities.push(
      ent({
        name: `Turret ${i + 1} Eye`,
        type: "sphere",
        parentId: tId,
        position: [0, 0.8, 1.25],
        scale: [0.18, 0.18, 0.18],
        color: "#ff3030",
        emissive: "#ff0000",
        noPhysics: true,
      }),
    );
  }

  // 5 crates scattered
  for (let i = 0; i < 5; i++) {
    entities.push(
      ent({
        name: `Crate ${i + 1}`,
        type: "box",
        position: [(i - 2) * 2.5, 0.5, -1],
        scale: [0.9, 0.9, 0.9],
        color: "#7a5e2e",
        roughness: 0.85,
      }),
    );
  }

  // Spotlight from above
  entities.push(
    ent({
      name: "Arena Spot",
      type: "light",
      position: [0, 8, 0],
      light: { kind: "spot", color: "#fff5d8", intensity: 18, distance: 35 },
    }),
  );

  return {
    entities,
    environment: {
      ...DEFAULT_ENV,
      skyColor: "#08080f",
      groundColor: "#1a1a24",
      ambientIntensity: 0.14,
      sunIntensity: 0.3,
      cameraMode: "firstPerson",
      cameraTargetEntityId: playerId,
      playerMoveSpeed: 7,
    },
  };
}

export const SCENE_TEMPLATES: { key: string; label: string; build: () => SceneData; description: string }[] = [
  {
    key: "tps-zombies",
    label: "TPS — Zombie Graveyard",
    description: "Third-person sandbox with a player, parented weapon, 6 zombies, crypt walls, and a brazier light.",
    build: tpsZombieDemoScene,
  },
  {
    key: "fps-arena",
    label: "FPS — Turret Arena",
    description: "First-person closed arena: player + parented weapon mount, 3 turrets with parented barrel/eye, crates.",
    build: fpsArenaScene,
  },
];
