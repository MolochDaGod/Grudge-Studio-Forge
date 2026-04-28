/**
 * Eight curated starter prefabs — the most useful, generic building
 * blocks for prototyping a game. Each prefab is a small subtree of
 * SceneEntities with optional default script source.
 *
 * Seeding (one-click from PrefabsPanel):
 *   1. For each prefab with `scriptSource`, POST a Script to /api/scripts
 *      and capture the returned id.
 *   2. Set entity.scriptId on the right entity in the subtree.
 *   3. POST the prefab to /api/projects/{id}/prefabs.
 *
 * After seeding, every prefab is a normal DB row the user can edit, re-Forge,
 * or delete. They are not "magic" — just preset starting points.
 */

import { nanoid } from "nanoid";
import type { SceneEntity } from "@/scene/types";

export interface StarterPrefabDef {
  /** Order matches the hotbar slots 1-8 when seeding. */
  slot: number;
  name: string;
  description: string;
  /** Optional script attached to the indicated child by name (case-insensitive).
   *  When undefined the prefab has no script. */
  scriptSource?: string;
  scriptName?: string;
  scriptLanguage?: "javascript" | "csharp";
  /** Index into `entities()` whose .scriptId should be set after script create. */
  scriptTargetIndex?: number;
  entities: () => SceneEntity[];
}

const id = () => nanoid(8);

/* ---------------------------------------------------------------------- *
 * Script sources
 * ---------------------------------------------------------------------- */

// Player movement script. Designed for a model whose pivot is at the feet
// (Blake): ground level is y=0. If you swap in a centered-pivot mesh, raise
// GROUND_Y to half the mesh height.
const PLAYER_SCRIPT = `// Player — WASD to move, Space to jump.
// Reads keyboard state from ctx.input.keys and writes to entity.position.
let vy = 0;
const SPEED = 6;
const JUMP = 7;
const GRAVITY = -18;
const GROUND_Y = 0;

export function update(entity, ctx) {
  const k = ctx.input.keys;
  let dx = 0, dz = 0;
  if (k['w'] || k['ArrowUp'])    dz -= 1;
  if (k['s'] || k['ArrowDown'])  dz += 1;
  if (k['a'] || k['ArrowLeft'])  dx -= 1;
  if (k['d'] || k['ArrowRight']) dx += 1;
  const len = Math.hypot(dx, dz);
  if (len > 0) { dx /= len; dz /= len; }
  entity.position[0] += dx * SPEED * ctx.time.delta;
  entity.position[2] += dz * SPEED * ctx.time.delta;

  // Jump + simple gravity (visual only — physics body would handle this in a real game).
  vy += GRAVITY * ctx.time.delta;
  if ((k[' '] || k['Space']) && entity.position[1] <= GROUND_Y + 0.05) {
    vy = JUMP;
  }
  entity.position[1] += vy * ctx.time.delta;
  if (entity.position[1] < GROUND_Y) { entity.position[1] = GROUND_Y; vy = 0; }
}
`;

const PATROL_SCRIPT = `// Patrolling Enemy — walks back and forth along X.
const RANGE = 4;
const SPEED = 2.5;
let origin = null;
export function start(entity) { origin = entity.position[0]; }
export function update(entity, ctx) {
  if (origin === null) origin = entity.position[0];
  const dx = Math.sin(ctx.time.elapsed * SPEED / RANGE) * RANGE;
  entity.position[0] = origin + dx;
}
`;

const SPIN_SCRIPT = `// Coin Pickup — spins on Y, bobs on Y. Edit speed/amplitude as needed.
const SPIN = 3;
const BOB = 0.15;
let baseY = null;
export function start(entity) { baseY = entity.position[1]; }
export function update(entity, ctx) {
  if (baseY === null) baseY = entity.position[1];
  entity.rotation[1] = ctx.time.elapsed * SPIN;
  entity.position[1] = baseY + Math.sin(ctx.time.elapsed * 2) * BOB;
}
`;

const PLATFORM_SCRIPT = `// Moving Platform — sine wave on Y between -1 and +1.
const AMPL = 1.2;
const PERIOD = 4;
let baseY = null;
export function start(entity) { baseY = entity.position[1]; }
export function update(entity, ctx) {
  if (baseY === null) baseY = entity.position[1];
  entity.position[1] = baseY + Math.sin(ctx.time.elapsed * (Math.PI * 2 / PERIOD)) * AMPL;
}
`;

const TRIGGER_SCRIPT = `// Trigger Zone — logs whenever a "Player" entity enters its bounds.
let inside = false;
const RADIUS = 1.5;
export function update(entity, ctx) {
  const player = ctx.scene.find('Player');
  if (!player) return;
  const dx = player.position[0] - entity.position[0];
  const dz = player.position[2] - entity.position[2];
  const dy = player.position[1] - entity.position[1];
  const within = Math.hypot(dx, dy, dz) < RADIUS * Math.max(entity.scale[0], entity.scale[2]);
  if (within && !inside) { inside = true; ctx.log('Player entered ' + entity.name); }
  if (!within && inside) { inside = false; ctx.log('Player left ' + entity.name); }
}
`;

const SPAWNER_SCRIPT = `// Spawner — pulses a log every 2s. (A real game would instantiate enemies here.)
let next = 0;
export function update(entity, ctx) {
  if (ctx.time.elapsed >= next) {
    ctx.log('Spawner tick at ' + entity.name);
    next = ctx.time.elapsed + 2;
  }
}
`;

/* ---------------------------------------------------------------------- *
 * Prefab definitions
 * ---------------------------------------------------------------------- */

export const STARTER_PREFABS: StarterPrefabDef[] = [
  {
    slot: 1,
    name: "Player (Blake)",
    description: "Blake character model with WASD + Space jump controller.",
    scriptName: "Player Controller",
    scriptSource: PLAYER_SCRIPT,
    scriptLanguage: "javascript",
    scriptTargetIndex: 0,
    entities: () => [
      {
        id: id(),
        name: "Player",
        type: "model",
        parentId: null,
        controllerKind: "thirdPerson",
        // Blake is rigged at ~1u tall; spawn at y=0 so the rig sits on the ground.
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { url: "builtin:blake" },
        // Capsule-ish proxy collider (cylinder ~1.7m tall, 0.4m radius) so the
        // physics body doesn't hug the visual mesh exactly — keeps movement clean.
        physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, friction: 0.6, restitution: 0 },
      },
    ],
  },
  {
    slot: 2,
    name: "Patrolling Enemy",
    description: "Cylinder that walks back and forth on X.",
    scriptName: "Enemy Patrol",
    scriptSource: PATROL_SCRIPT,
    scriptLanguage: "javascript",
    scriptTargetIndex: 0,
    entities: () => [
      {
        id: id(),
        name: "Enemy",
        type: "cylinder",
        parentId: null,
        transform: { position: [4, 1, 0], rotation: [0, 0, 0], scale: [0.6, 1, 0.6] },
        material: { color: "#cc3333", metalness: 0.1, roughness: 0.5, emissive: "#220000" },
        physics: { bodyType: "kinematicPosition", colliderType: "cylinder", mass: 1, friction: 0.6, restitution: 0 },
      },
    ],
  },
  {
    slot: 3,
    name: "Coin Pickup",
    description: "Spinning, bobbing gold coin. Tag with onPickup script.",
    scriptName: "Coin Spin",
    scriptSource: SPIN_SCRIPT,
    scriptLanguage: "javascript",
    scriptTargetIndex: 0,
    entities: () => [
      {
        id: id(),
        name: "Coin",
        type: "cylinder",
        parentId: null,
        transform: { position: [0, 1.2, 2], rotation: [Math.PI / 2, 0, 0], scale: [0.4, 0.08, 0.4] },
        material: { color: "#f4d03f", metalness: 0.9, roughness: 0.15, emissive: "#3a2a00" },
      },
    ],
  },
  {
    slot: 4,
    name: "Crate",
    description: "Dynamic physics box. Drop, push, stack.",
    entities: () => [
      {
        id: id(),
        name: "Crate",
        type: "box",
        parentId: null,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { color: "#8b6f3a", metalness: 0.05, roughness: 0.85 },
        physics: { bodyType: "dynamic", colliderType: "cuboid", mass: 1.5, friction: 0.7, restitution: 0.1 },
      },
    ],
  },
  {
    slot: 5,
    name: "Moving Platform",
    description: "Wide flat platform that bobs up and down.",
    scriptName: "Platform Wave",
    scriptSource: PLATFORM_SCRIPT,
    scriptLanguage: "javascript",
    scriptTargetIndex: 0,
    entities: () => [
      {
        id: id(),
        name: "Platform",
        type: "box",
        parentId: null,
        transform: { position: [0, 1.5, -3], rotation: [0, 0, 0], scale: [3, 0.3, 3] },
        material: { color: "#3a3a55", metalness: 0.4, roughness: 0.5 },
        physics: { bodyType: "kinematicPosition", colliderType: "cuboid", mass: 0, friction: 0.9, restitution: 0 },
      },
    ],
  },
  {
    slot: 6,
    name: "Trigger Zone",
    description: "Translucent box that logs when Player enters.",
    scriptName: "Trigger Zone",
    scriptSource: TRIGGER_SCRIPT,
    scriptLanguage: "javascript",
    scriptTargetIndex: 0,
    entities: () => [
      {
        id: id(),
        name: "Trigger",
        type: "box",
        parentId: null,
        transform: { position: [3, 1, 0], rotation: [0, 0, 0], scale: [2, 2, 2] },
        material: { color: "#3aaaff", metalness: 0, roughness: 1, emissive: "#001a33" },
      },
    ],
  },
  {
    slot: 7,
    name: "Light Post",
    description: "Tall pole with a warm point light child.",
    entities: () => {
      const post = id();
      return [
        {
          id: post,
          name: "Light Post",
          type: "cylinder",
          parentId: null,
          transform: { position: [0, 1.5, 0], rotation: [0, 0, 0], scale: [0.15, 1.5, 0.15] },
          material: { color: "#1a1a1a", metalness: 0.7, roughness: 0.4 },
          physics: { bodyType: "fixed", colliderType: "cylinder" },
        },
        {
          id: id(),
          name: "Lamp",
          type: "light",
          parentId: post,
          // Local transform — child sits above the parent (which is 1.5 tall, half = 0.75).
          transform: { position: [0, 1.0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          light: { kind: "point", color: "#ffd28a", intensity: 8, distance: 12 },
        },
      ];
    },
  },
  {
    slot: 8,
    name: "Spawner",
    description: "Empty marker that pulses a log every 2 seconds.",
    scriptName: "Spawner Pulse",
    scriptSource: SPAWNER_SCRIPT,
    scriptLanguage: "javascript",
    scriptTargetIndex: 0,
    entities: () => [
      {
        id: id(),
        name: "Spawner",
        type: "empty",
        parentId: null,
        transform: { position: [-4, 1, -4], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ],
  },
];

/* ---------------------------------------------------------------------- *
 * Built-in VFX prefabs (model entities backed by public/builtin/*.glb).
 *
 * Seeded by a separate "Seed VFX" button — they are NOT auto-bound to
 * hotbar slots so they don't collide with the eight gameplay starters.
 * Each entity points at a `builtin:vfx-*` key resolved by builtinModels.ts.
 * Animations bundled inside the .glb auto-play (see EntityRenderer's
 * `useAnimations` block).
 * ---------------------------------------------------------------------- */

export interface VfxPrefabDef {
  name: string;
  description: string;
  entities: () => SceneEntity[];
}

export const STARTER_VFX: VfxPrefabDef[] = [
  {
    name: "VFX — Falling Leaves",
    description: "Looping animated falling green leaves.",
    entities: () => [
      {
        id: id(),
        name: "Falling Leaves",
        type: "model",
        parentId: null,
        transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { url: "builtin:vfx-leaves" },
      },
    ],
  },
  {
    name: "VFX — Trail",
    description: "Animated motion trail mesh — attach to projectiles or moving entities.",
    entities: () => [
      {
        id: id(),
        name: "Trail FX",
        type: "model",
        parentId: null,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { url: "builtin:vfx-trail" },
      },
    ],
  },
  {
    name: "VFX — Animated Effect",
    description: "Generic animated impact / pulse effect.",
    entities: () => [
      {
        id: id(),
        name: "Effect",
        type: "model",
        parentId: null,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { url: "builtin:vfx-effect" },
      },
    ],
  },
  {
    name: "VFX — Circuit Loop",
    description: "Greeble circuits in motion — sci-fi panel decoration.",
    entities: () => [
      {
        id: id(),
        name: "Circuits",
        type: "model",
        parentId: null,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { url: "builtin:vfx-circuits" },
      },
    ],
  },
  {
    name: "VFX — Tornado",
    description: "Animated tornado funnel — large ambient effect.",
    entities: () => [
      {
        id: id(),
        name: "Tornado",
        type: "model",
        parentId: null,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { url: "builtin:vfx-tornado" },
      },
    ],
  },
  {
    name: "VFX — Warning Marker",
    description: "Local warning glyph — useful for hazard zones.",
    entities: () => [
      {
        id: id(),
        name: "Warning",
        type: "model",
        parentId: null,
        transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        model: { url: "builtin:vfx-warning" },
      },
    ],
  },
];
