---
name: Walkable example maps — surface tagging & terrain snap
description: How example templates make the map mesh the real walkable ground, demote the flat ground, and snap entities onto terrain.
---

## Make the map the walkable ground, not a flat plane

To make a scene template's MAP (trimesh / heightfield) the real walkable
ground, the flat fallback "Ground" plane must be demoted so it stops
competing with the map for navmesh + terrain-snap.

**The demotion pattern:** replace Ground with a deep plane far below
(e.g. y=-200), `layer:"Default"`, **`surface:"None"`**.

**Why `surface:"None"` is the key:**
- Terrain snap (`terrainSnap.ts`) only accepts targets whose surface is
  `"walk"` (case-insensitive). `"None"` is ignored.
- The navmesh baker filters out `surface === "None"`, so the floor never
  becomes walkable nav.
- `layer:"Default"` still collides with Player/NPC in the default Rapier
  matrix, so it stays a physical fall-through catch net.

Net effect: entities snap/navigate on the map mesh (which carries an
inherited Walk/Terrain surface from its Map group), and the floor only
catches anything that falls through.

**Why:** a flat walkable ground plane shadows the actual map for both
navmesh baking and `pendingTerrainSnap`, so characters walk on an invisible
sheet instead of the terrain.

## Non-model entities need their OWN terrain-snap pass

`pendingTerrainSnap` snapping historically ran only inside `LoadedModel` in
`EntityRenderer.tsx`, so primitive (non-model) entities — RTS box nodes,
resource/building boxes, pickups — silently floated because they never hit
that code path.

**How to apply:** keep the separate `useEffect` in `EntityRenderer` that
snaps `entity.type !== "model"` entities. If you refactor the model snap,
preserve the non-model path or primitives float again.

## Changing template content

Bump `TEMPLATES_VERSION` (`lib/scene-templates/src/index.ts`, format
`yyyymmdd.n`) on any template content change — the boot-time seeder uploads
fresh immutable R2 object keys per version, so unbumped edits don't ship.
