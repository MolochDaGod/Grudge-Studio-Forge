---
name: rapier-physics-patterns
description: Recipes for Rapier 3D physics in the Forge editor — kinematic character controllers, joints (chains/ragdolls), instanced rigid bodies for crowds, and terrain heightfields. Covers the @react-three/rapier component idiom, the Forge physics layer matrix (Default/Terrain/Player/NPC/Item/Projectile/Trigger/Water/IgnoreRaycast/UI3D), wake-up / sleep tuning, and the kinematic vs dynamic body decision tree. Use when adding player movement, building destructible chains, or making large terrains collide correctly.
---

# Rapier Physics Patterns — Grudge Studio

The Forge runs **Rapier 3D 0.19 (WASM)** through `@react-three/rapier`. Physics is mounted in `Viewport.tsx` as `<Physics gravity={...}>` and only ticks during play mode. This skill covers the four patterns we'll actually use: character control, joints, instancing, and terrain.

Repo physics layers (defined in `projectConventions.ts` + scene schema):
**`Default | Terrain | Player | NPC | Item | Projectile | Trigger | Water | IgnoreRaycast | UI3D`**

Always tag bodies with one of these — never leave a body on layer 0 with no semantic.

---

## 1. Kinematic Character Controller (the player / NPCs)

Rapier ships a purpose-built `KinematicCharacterController` that handles slope-snapping, step-up, and "push dynamic bodies." Use it instead of forcing a dynamic capsule.

```ts
// One-time, after physics.world is ready:
const controller = world.createCharacterController(0.01);   // skin width
controller.setApplyImpulsesToDynamicBodies(true);            // push boxes
controller.setCharacterMass(3);
controller.enableAutostep(0.4, 0.3, true);                   // step height, min width, dynamic
controller.enableSnapToGround(0.5);                          // stick to slopes

// Per-frame:
const desired = new RAPIER.Vector3(input.x * spd, gravityY, input.z * spd);
controller.computeColliderMovement(playerCollider, desired);
const delta = controller.computedMovement();

const pos = playerCollider.translation();
pos.x += delta.x; pos.y += delta.y; pos.z += delta.z;
playerCollider.setTranslation(pos);
playerMesh.position.set(pos.x, pos.y, pos.z);
```

In `@react-three/rapier`, the equivalent is `<RigidBody type="kinematicPosition">` + manual `useRapier()` access for `createCharacterController`. The hook gives you `world` + `RAPIER`.

**Why kinematic over dynamic for the player:**
- Dynamic bodies wobble on stairs and slip on slopes; no game studio ships a dynamic player.
- Kinematic + character controller = predictable, designer-friendly, network-friendly.
- For falling, write your own gravity accumulator on top (`vy += gravity * dt`).

---

## 2. Joints — chains, ragdolls, doors

Rapier supports `spherical`, `revolute`, `fixed`, and `prismatic` impulse joints. Two-body, both bodies must already exist.

```ts
const jointParams = RAPIER.JointData.spherical(
  /* anchor on body1 (local) */ new RAPIER.Vector3(0, -0.5, 0),
  /* anchor on body2 (local) */ new RAPIER.Vector3(0, 1.15, 0),
);
world.createImpulseJoint(jointParams, body1, body2, true);
body2.setAngularDamping(10.0);   // critical — without damping, joints oscillate forever
```

Joint type cheat-sheet:
- `spherical` — ball joint (pendulums, rope-link chains, shoulder).
- `revolute` — hinge around an axis (doors, wagon wheels, elbow).
- `fixed` — rigid attachment (welded crates). Use for "stick this prop to that platform."
- `prismatic` — linear slider (pistons, drawers).

For **ragdolls**: 12–15 spherical joints with high angular damping + per-joint angle limits. Build offline (don't compute joints at runtime).

---

## 3. InstancedMesh + physics (crowds, debris)

`InstancedMesh` is the only way to render thousands of identical objects cheaply. Rapier integrates via the `addScene` walker in `three/addons/physics/RapierPhysics.js`:

```ts
const boxes = new THREE.InstancedMesh(geom, mat, 400);
boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
boxes.userData.physics = { mass: 1, restitution: 0.3 };
scene.add(boxes);
physics.addScene(scene);   // creates 400 rigid bodies, one per instance

// To teleport instance #i:
physics.setMeshPosition(boxes, new THREE.Vector3(0, 5, 0), i);
```

This is the right tool for: bullet casings, debris, dropped loot piles, pebbles on a beach. **It is wrong for skinned characters** (use `animation-and-skinned-meshes` instead).

---

## 4. Terrain heightfields

Massive terrain (>1km²) cannot use a `TrimeshCollider` — too many tris. Use a heightfield: a 2D array of heights sampled on a grid.

```ts
const cols = 128, rows = 128;
const heights = new Float32Array(cols * rows);   // y values, row-major
fillFromNoise(heights);

physics.addHeightfield(
  terrainMesh,                                    // visual mesh for sync
  cols - 1, rows - 1,
  heights,
  { x: 100, y: 1.0, z: 100 },                     // world-space extents
);
```

Constraints:
- Heightfield is single-valued — no overhangs, no caves. Use a separate trimesh body for those.
- The terrain mesh's vertex layout must match the heightfield grid (PlaneGeometry, `rotateX(-PI/2)`, vertex Y from `heights[]`).
- Tag the resulting collider with layer `Terrain` so raycasts can filter on it.

---

## 5. The Forge physics layer matrix

| Layer          | Collides with                                | Notes                                          |
| -------------- | -------------------------------------------- | ---------------------------------------------- |
| `Default`      | everything except `IgnoreRaycast` + `UI3D`    | Use sparingly — prefer specific layers.        |
| `Terrain`      | `Player`, `NPC`, `Item`, `Projectile`         | Ground, walls, rocks. Static bodies.            |
| `Player`       | `Terrain`, `NPC`, `Item`, `Trigger`           | One body (usually).                             |
| `NPC`          | `Terrain`, `Player`, `NPC`, `Trigger`         | NPC-vs-NPC on so they don't stack inside each other. |
| `Item`         | `Terrain`, `Player`, `NPC`                    | Pickups, dropped loot.                          |
| `Projectile`   | `Terrain`, `NPC`, `Player`                    | NOT projectile-vs-projectile.                  |
| `Trigger`      | sensor-only (no contact response)             | Damage volumes, area triggers, water surfaces. |
| `Water`        | `Player`, `NPC`, `Item`                       | Buoyancy zones — often modeled as sensors.    |
| `IgnoreRaycast`| nothing                                       | Helpers, gizmos, debug visualizations.         |
| `UI3D`         | nothing                                       | Diegetic UI (signs, screens) — never collides.  |

Rapier's collision groups are bitmasks: 16-bit membership + 16-bit filter. Build a table once and reuse — don't compute it in the hot path.

---

## 6. Sleep tuning — the dirty secret of stuck objects

Rapier sleeps bodies whose linvel + angvel are near zero, to save CPU. The terrain example above explicitly `body.wakeUp()`s objects that should be falling but aren't. Use this pattern when:
- A body spawned mid-air and the broad-phase hasn't ticked it yet.
- A body was on a platform that just got removed.

```ts
if (body.linvel().y > -0.1 && shouldBeFalling) body.wakeUp();
```

Don't ever set `body.setLinearDamping(0)` to "fix sticking" — that's the wrong knob. Wake the body, or lower its sleep threshold globally.

---

## 7. Gotchas

- **WASM init is async.** Always `await RapierPhysics()` (or `useRapier()`'s ready state) before creating bodies.
- **One world per scene.** Multi-world rapier is possible but never what we want.
- **Don't create bodies in `useFrame`.** Allocate on entity mount; teleport/wake on action.
- **Trimesh colliders are last-resort.** Convex hull + compound shapes are 10× cheaper for non-terrain meshes.

---

## See also

- `spatial-queries-and-surfaces` — raycasts, shape casts, ground-probe patterns built on top of these colliders.
- `animation-and-skinned-meshes` — for syncing skinned meshes to controller positions.
- `forge-editor` — where `Viewport.tsx`'s `<Physics>` mount and the play-mode loop live.
