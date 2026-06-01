---
name: Walkable example maps — surface tagging & terrain snap
description: How example templates make the map mesh the real walkable ground, demote the flat ground, and snap entities onto terrain.
---

## Make the map the walkable ground, not a flat plane

To make a scene template's MAP (trimesh / heightfield) the real walkable
ground, the flat fallback "Ground" plane must be demoted so it stops
competing with the map for navmesh + terrain-snap.

**The demotion pattern:** replace Ground with a `safetyFloor()` — a plane far
below (y=-200), `layer:"Default"`, **`surface:"None"`**.

**Why `surface:"None"` is the key:**
- Terrain snap (`terrainSnap.ts`) only accepts targets whose surface is
  `"walk"` (case-insensitive). `"None"` is ignored.
- The navmesh baker filters out `surface === "None"`, so the floor never
  becomes walkable nav.
- `layer:"Default"` still collides with Player/NPC in the default Rapier
  matrix, so it remains a physical fall-through catch net.

Net effect: entities snap/navigate on the map mesh (which carries an
inherited Walk/Terrain surface from its Map group), and the floor only
catches anything that falls through.

## Non-model entities need their OWN terrain-snap pass

`pendingTerrainSnap` snapping historically ran **only inside
`LoadedModel`** in `EntityRenderer.tsx`, so primitive entities (RTS box
nodes, resource/building boxes, pickups) silently floated — they never hit
that code path.

**Fix / constraint to preserve:** there is a second `useEffect` in
`EntityRenderer` that snaps `entity.type !== "model"` entities with
`pendingTerrainSnap`. `snapEntityToTerrainOnce` is type-agnostic and
bounded-retry safe. If you ever refactor the model snap, keep the non-model
path alive or primitives float again.

## Determinism for the template ETag seeder

Scene templates are uploaded to R2 with ETag-based idempotency keyed on
deterministic entity IDs. When editing builders:
- A 1:1 entity swap at the same insertion point (Ground → SafetyFloor)
  consumes the same number of `id()` calls → stable downstream IDs.
- Insert new groups (e.g. pickups) BEFORE Lighting/GameManager so you only
  shift IDs nothing else references; player/cameraTarget IDs are minted
  earlier and stay put.
- Bump `TEMPLATES_VERSION` (`lib/scene-templates/src/index.ts`, format
  `yyyymmdd.n`) on any template content change so the seeder writes fresh
  immutable object keys.
