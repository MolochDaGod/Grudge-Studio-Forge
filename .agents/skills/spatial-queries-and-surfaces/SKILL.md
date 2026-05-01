---
name: spatial-queries-and-surfaces
description: Reference for 3D spatial queries (raycasts, shape casts, BVH, sensor volumes), the 8-direction probe fan, the ground/ceiling first-contact pattern, and surface tagging (walk / climb / swim / dig). Use whenever working on character controllers, AI perception, weapons hit detection, navmesh, terrain interaction, or any "what is the player standing on / looking at / about to bump into" problem in the R3F + Rapier game-forge stack.
---

# Spatial Queries & Surface Tagging

A single source of truth for **how a 3D game asks questions of its world**:
"Am I on the ground?" "What kind of ground?" "Is there a wall on my right?"
"Did the bullet hit anything?" "Can I climb this?" "Can I dig here?"

All examples target this repo's stack: **three.js + @react-three/fiber + @react-three/rapier**.
Coordinate convention: **+Y is up**, world units are **meters**.

---

## 0. Mental model — 8 directions + up + down

```
            ↑  (ceiling probe — head clearance)
      ↖  ↑  ↗
   ←  •  □  •  →     (8 horizontal probes — wall fan, AI sight, nav fallback)
      ↙  ↓  ↘
            ↓  (ground probe — first contact below)
```

Every spatial question reduces to one of:

| Question                        | Tool                                  | Direction       |
| ------------------------------- | ------------------------------------- | --------------- |
| What's under me?                | downward ray                          | `-Y`            |
| Is there a ceiling?             | upward ray                            | `+Y`            |
| Wall in front?                  | horizontal ray                        | facing dir      |
| Wall on any side? (slide / AI)  | 8-way horizontal ray fan              | 8 cardinal/diag |
| Did the bullet hit?             | ray from muzzle along aim             | aim vector      |
| Can the camera see the player?  | ray from eye to target                | eye→target      |
| Did I overlap a region?         | sensor (trigger) collider             | volumetric      |
| Closest point on world geometry | BVH `closestPointToPoint` / shape cast| volumetric      |

---

## 1. The probe types — what each is, and what collider it expects

### 1.1 Raycast (infinitely thin line)

Pick **one origin + one direction + max distance**. Returns first surface hit.

- **three.js** (`THREE.Raycaster`) — operates on `Object3D` graph; works on visual meshes (no rigid body needed). Best for **picking, mouse-cursor projection, line-of-sight against the rendered scene**.
- **Rapier** (`world.castRay` / `world.castRayAndGetNormal`) — operates on the physics world; respects collision groups, sensors. Best for **gameplay queries that must agree with what the body actually collides with** (ground check, bullet hit on physical hitboxes).

**Collider it needs:** any solid collider (cuboid, capsule, ball, trimesh, heightfield). For raycasting against the **visible mesh** of a GLB you don't need a Rapier collider — use the three.js raycaster.

**Best practice:**
- One shared `THREE.Raycaster` per system, mutate `.set(origin, dir)` each frame — never `new` per call.
- Always `.normalize()` the direction.
- Set `.far` to the smallest plausible bound (e.g. 2m for ground check, not Infinity).
- For Rapier, pre-build the `RAPIER.Ray` object and reuse it; pass `excludeRigidBody` to skip self.

### 1.2 Shape cast / sphere cast (ray with thickness)

A ray that's **a swept sphere or capsule**, not a thin line. Catches edges that a thin ray slips off (corners, gaps between two trimesh triangles).

- **Rapier:** `world.castShape(...)` with `RAPIER.Ball(r)` or `RAPIER.Capsule(...)`.
- **Use when:** ground check on bumpy terrain, "is there a wall I'm sliding into" check for a character controller, projectile that shouldn't tunnel.

**Collider it needs:** same as raycast — any solid collider.

**Best practice:**
- Sphere radius ≈ **0.4–0.6 × character radius**. Too big → false positives at hip height. Too small → no benefit over a ray.
- Cast from a point **inside** the character (e.g. capsule center) so the swept sphere doesn't immediately overlap and report 0 distance.

### 1.3 BVH (`three-mesh-bvh`)

Builds a **bounding volume hierarchy** on a mesh's triangles, accelerating raycasts / shape casts / closest-point queries from O(n) to O(log n). Critical for huge static meshes (terrain, the entire map GLB).

```ts
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// After loading a static map mesh:
mapRoot.traverse((o) => {
  if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.computeBoundsTree();
});
```

**Collider it needs:** none — BVH operates on the rendered geometry. Pairs naturally with three.js `Raycaster`.

**Best practice:**
- Build BVH **once after load**, dispose with `geometry.disposeBoundsTree()` on unmount.
- Only build for meshes that **don't deform every frame** (skinned characters: skip).
- For Rapier-side queries, equivalent perf comes from using a **trimesh collider with `solverIterations` left default**.

### 1.4 Sensor (trigger) collider

A collider with `sensor` (Rapier) / `isTrigger` (Cannon) flag — **never blocks motion**, only fires `onIntersectionEnter` / `Exit` events. Used for **regions** rather than surfaces.

```tsx
<RigidBody type="fixed" sensor colliders="cuboid" userData={{ tag: "diggable" }}>
  <mesh visible={false}><boxGeometry args={[10, 1, 10]} /></mesh>
</RigidBody>
```

**Use when:** dig zones, water volumes, damage zones, dialog ranges, checkpoints, pickup radius.

**Best practice:**
- Sensors with a player are O(n²) in worst case — keep them **few and large** rather than many tiny ones.
- Always tag `userData.tag` on the rigid body so the listener can branch on what it entered.

### 1.5 Closest-point query

"What's the nearest point on the world to me?" Use BVH `closestPointToPoint` or Rapier `world.projectPoint`. Useful for: melee-snapping, AI cover-finding, particle-decal placement on irregular surfaces.

---

## 2. The directional patterns

### 2.1 First-contact-below (ground probe) — **the most important pattern**

Drop a short ray from **just inside** the character's feet downward. Read the first hit.

```ts
// Origin slightly above the foot to avoid starting inside the floor.
const origin = playerPos.clone().add(new THREE.Vector3(0, 0.1, 0));
const dir    = new THREE.Vector3(0, -1, 0);
const maxDist = 0.25; // foot-radius + skin

raycaster.set(origin, dir);
raycaster.far = maxDist;
const hit = raycaster.intersectObjects(scene.children, true)[0];

if (hit) {
  const tag = readSurfaceTag(hit.object); // see §3
  isGrounded = true;
  groundNormal = surfaceNormal(hit);
  currentSurface = tag; // "walk" | "climb" | "swim" | "dig" | …
}
```

**Key rules:**
- **Origin must be above the floor**, never on it. Numeric drift makes "exactly at" sometimes miss.
- **Max distance is small** — long rays that punch through the world cause "I'm grounded but flying" bugs.
- Read **surface normal** — slope > ~50° usually means "slide, don't walk".

### 2.2 First-contact-above (ceiling probe)

Same as ground probe but `+Y`. Used to:
- Cancel `jump` input when there's a ceiling 0.2m above the head (don't bonk).
- Crouch-blocking: prevent stand-up if a ceiling is within standing height.
- "Is the player under cover?" for AI accuracy modifiers.

### 2.3 Eight-direction horizontal fan (wall sense / AI sight)

Eight short rays at 0°, 45°, 90°, … 315° around the character at chest height.

```ts
const ANGLES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

function probeWalls(pos: THREE.Vector3, radius: number) {
  const hits: { angle: number; dist: number; tag: string | null }[] = [];
  for (const a of ANGLES) {
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    raycaster.set(pos, dir);
    raycaster.far = radius;
    const h = raycaster.intersectObjects(scene.children, true)[0];
    if (h) hits.push({ angle: a, dist: h.distance, tag: readSurfaceTag(h.object) });
  }
  return hits;
}
```

**Use cases:**
- **Character controller wall-slide:** find the closest hit, project velocity along its tangent.
- **Climbable detection:** any of the 8 hits has `tag === "climb"` and is within arm reach → enter climb state.
- **AI navmesh fallback:** when off-mesh, the agent steers toward the most-open angle (largest `dist`).
- **AI sight cone:** instead of 8, use 5 rays in a forward arc. Same pattern.

**Stagger across frames** if expensive: even-frame agents probe N/E/S/W, odd-frame probe NE/SE/SW/NW.

### 2.4 Eye-to-target visibility ray (LoS)

```ts
const dir = target.clone().sub(eye).normalize();
const dist = eye.distanceTo(target);
raycaster.set(eye, dir);
raycaster.far = dist - 0.05; // stop just before target so we don't "hit" it
const blockers = raycaster.intersectObjects(scene.children, true);
const visible = blockers.length === 0;
```

Used for: enemy "can see player", camera occlusion (zoom in if a wall is between camera and character), stealth meter, sniper laser dot.

### 2.5 Aim ray (bullet trace)

Already implemented in `PlayRuntime.ts` → `raycastEntities`. Pattern:
1. Origin = muzzle world position.
2. Direction = camera-forward (FPS) or character-forward (TPS) — **not** muzzle-forward, which jiggles with weapon sway.
3. `excludeIds` includes the shooter so they can't hit themselves.
4. Walk parent chain on the hit to find `userData.entityId`.

---

## 3. Surface tagging

The probe tells you **where**; the tag tells you **what**. Tags are how a single ground-probe call can drive walk vs swim vs climb behavior.

### 3.1 Tag storage

Two complementary places, both authored once at scene-load time:

**A. `userData` on the Object3D** (works for `THREE.Raycaster` hits):
```ts
mapMesh.userData.surface = "walk"; // default for the map root
waterMesh.userData.surface = "swim";
ladderMesh.userData.surface = "climb";
digZoneMesh.userData.surface = "dig";
```

**B. `userData` on the Rapier `RigidBody`** (works for Rapier raycasts + collision events):
```tsx
<RigidBody type="fixed" userData={{ surface: "swim" }} sensor>
  <mesh><boxGeometry args={[20, 4, 20]} /></mesh>
</RigidBody>
```

Always set both if both query systems will read the surface.

### 3.2 Reading the tag from a hit

```ts
function readSurfaceTag(obj: THREE.Object3D): SurfaceTag {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const ud = cur.userData as { surface?: SurfaceTag } | undefined;
    if (ud?.surface) return ud.surface;
    cur = cur.parent;
  }
  return "walk"; // default — anything unmarked is plain walkable ground
}
```

Walk **up the parent chain** because a GLB's leaf meshes won't have the tag — only the named root we annotated does. This mirrors the `entityId` lookup in `raycastEntities`.

### 3.3 Standard tag vocabulary

Keep this tight — every new tag adds branches in the controller.

| Tag       | Behavior                                                                 |
| --------- | ------------------------------------------------------------------------ |
| `walk`    | Default. Standard gravity, normal friction, jump enabled.                |
| `climb`   | Gravity off while attached. Up/down on stick → up/down on surface.       |
| `swim`    | Reduced gravity (buoyancy), slower max speed, jump replaced by surface.  |
| `dig`     | Walkable, **plus** primary-action hotkey toggles a digging routine.      |
| `slip`    | Walkable but friction → 0.05 (ice). Acceleration / brake reduced.        |
| `damage`  | Walkable but 1 hp/s. Lava, acid, etc.                                    |
| `nojump`  | Walkable but jump disabled (low-ceiling pad, "no jumping" trigger).      |

### 3.4 Layered queries — the digable-zone enforcement pattern

The user's sketch (arrow from below + arrows from sides) describes a **two-step layered query**:

1. **Ground probe** tells you the terrain tag of the surface beneath you.
2. **Sensor overlap** tells you whether you're inside a special zone (e.g. `dig`).

The actual gameplay rule is the **AND** of the two:

```ts
const groundTag  = readSurfaceTag(groundHit.object);    // e.g. "walk"
const inDigZone  = sensorOverlaps.has("dig");           // from RigidBody onIntersect

const canDig = groundTag === "walk" && inDigZone;
```

This separates "what is it made of" (terrain tag, set on the mesh) from "is this an authored interaction region" (sensor zone, set on a trigger volume) — so designers can paint a dig zone over **any** terrain without re-tagging the terrain itself.

---

## 4. 8-direction baking

Two unrelated things share this name. Know which one you mean.

### 4.1 8-direction sprite baking (billboard sprites)

Pre-render a 3D model from 8 yaw angles (0°, 45°, … 315°) into a sprite sheet. At runtime, draw the sprite whose baked angle is closest to `enemyYaw - cameraYaw`. Used by Doom, Diablo, classic isometric games.

- **Pros:** zero rigging cost, hundreds of enemies at 60 fps, art controls every silhouette.
- **Cons:** discrete jumps when crossing the 22.5° boundary; no smooth turning unless you bake more than 8 angles.
- **In R3F:** render to an `<sprite>` with a `THREE.SpriteMaterial`, swap its `material.map` per frame based on the yaw bin.

Bin the angle once with:
```ts
const bin = Math.round(((relativeYaw + Math.PI * 2) / (Math.PI / 4))) & 7; // 0..7
```

### 4.2 8-direction movement / animation (3D characters)

For a TPS/FPS character, blend 8 directional move animations (forward, fwd-right, right, back-right, back, back-left, left, fwd-left) keyed by the angle between **input vector** and **character-forward**.

- Use a **2D blend space** (`inputX`, `inputZ`) — cleaner than 8 hard switches.
- Sample at the same rate as input; never re-bake on every frame.
- The character's forward is the **camera's flat forward** in TPS (per `CameraControllers.tsx`'s yaw-locked body), so the input angle is `atan2(inputX, inputZ)`.

---

## 5. Engine-specific glue (R3F + Rapier in this repo)

### 5.1 Where to put each query

| Layer                           | What lives here                                                  |
| ------------------------------- | ---------------------------------------------------------------- |
| `EntityRenderer.tsx`            | Sets `userData.entityId` + `userData.name` on every group.       |
| `PlayRuntime.ts`                | Owns `SHARED_RAYCASTER`, exposes `raycastEntities()`.            |
| `CameraControllers.tsx`         | Camera occlusion ray (eye→character).                            |
| `deathmatchBehaviors.ts`        | Per-AI `probeWalls()` + LoS ray (staggered across frames).       |
| `*Behaviors.ts` (player)        | Ground probe + ceiling probe + 8-way wall fan for slide.         |

### 5.2 Tagging conventions

- Map root: `userData.name = "Map"`, `userData.surface = "walk"`.
- Water volume: top-level RigidBody with `sensor`, `userData.surface = "swim"`, plus a transparent visible mesh whose `userData.surface = "swim"` (for the visual raycaster path).
- Climbable: any GLB child mesh whose name contains `ladder` or `climb` should get `userData.surface = "climb"` post-load.
- Dig zone: `sensor` RigidBody with `userData.tag = "dig"` (note: `tag`, not `surface` — the sensor is a *zone*, not a *surface*).

### 5.3 Frame budget guidance

| Query                      | Budget                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| Player ground probe        | every frame (1 ray)                                                   |
| Player ceiling probe       | every frame (1 ray)                                                   |
| Player wall fan            | every frame (8 rays, but `far` ≤ 0.6m) or every 2nd frame             |
| AI LoS                     | every 2–4 frames per agent, staggered                                 |
| AI 8-way fan               | every 4–8 frames per agent                                            |
| BVH static raycasts        | unlimited (it's free) — still cap `far` for early-out                 |
| Sensor overlap             | event-driven, no per-frame cost                                       |

If FPS dips, the first thing to stagger is **AI** queries, never the player's ground probe.

---

## 6. Pitfalls (read this before debugging)

- **"I'm always grounded"** — your ray's `far` is too long, or you're starting below the floor. Cap `far` to 0.25m and lift origin by 0.1m.
- **"I fall through the floor sometimes"** — thin ray slipping between trimesh triangles. Switch to a sphere cast.
- **"My BVH stopped working after I scaled the mesh"** — `computeBoundsTree` runs in geometry space; scaling the parent is fine, but **modifying the geometry in place** (CSG, vertex morph) requires `disposeBoundsTree` + rebuild.
- **"Rapier raycast hits nothing but visual ray hits"** — the GLB has no Rapier collider attached, just a visual mesh. Add `colliders="trimesh"` to its `<RigidBody>` or use the visual raycaster instead.
- **"Sensor never fires"** — the *other* body must also be a Rapier `RigidBody`, not just a `mesh`. The player capsule already is; loose pickups often aren't.
- **"Surface tag returns `undefined`"** — you tagged a leaf mesh inside a GLB but the raycaster hit a sibling. Tag the **root group** of the imported scene; the parent walk picks it up.
- **`new THREE.Raycaster()` per frame** — leaks GC pressure. Always reuse one.
- **Origin exactly at surface y=0** — floating-point ties. Always offset by 0.001 minimum.

---

## 7. Quick-reference: which probe for which question

```
"Am I on the ground?"          → §2.1 downward ray, max 0.25m
"What kind of ground?"         → §2.1 + §3.2 readSurfaceTag()
"Can I stand up from crouch?"  → §2.2 upward ray, max stand_height - crouch_height
"Wall to slide along?"         → §2.3 8-way fan, max 0.6m
"Can the AI see me?"           → §2.4 eye→target ray, exclude both bodies
"Did the bullet hit?"          → §2.5 → raycastEntities() in PlayRuntime
"Am I in water?"               → §1.4 sensor overlap, tag = "swim"
"Can I dig here?"              → §3.4 layered query (ground tag + sensor)
"What's the closest cover?"    → §1.5 BVH closestPointToPoint
"Where will my projectile go?" → §1.2 sphere cast, radius = projectile size
```
