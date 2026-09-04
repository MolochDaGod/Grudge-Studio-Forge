---
name: forge-gameplay-scripts
description: >
  Forge gameplay scripts, multiplayer network manager, third-person camera,
  character R2/D1 bake, editor hotkeys (copy/paste/frame), and deployment of
  playable scenes. References grudgecontrol multiplayer-gltf, three-player-controller,
  Unity/uMMORPG/Mirror patterns.
  USE WHEN: custom scripts, multiplayer network manager, third person camera,
  WASD controller, outline select, Mirror NetworkManager, spawn R2 character,
  Ctrl+C/V/Z/Y frame selection, deploy forge gameplay.
  Load AFTER forge-editor + grudge-studio.
---

# Forge Gameplay Scripts & Multiplayer

## Editor hotkeys (must work)

| Key | Action |
|-----|--------|
| **Ctrl+Z** | Undo |
| **Ctrl+Y** / **Ctrl+Shift+Z** | Redo |
| **Ctrl+C** | Copy selected entity + hierarchy children |
| **Ctrl+V** | Paste clipboard |
| **Ctrl+D** | Duplicate |
| **F** | Frame selection **including hierarchy children** (smooth) |
| **Ctrl+S** | Save scene |

Implementation: `lib/editorHotkeys.ts`, `lib/entityClipboard.ts`, `Viewport` `FocusCameraController`.

## Editor render range

- Camera: `near 0.02`, `far 500_000`, `logarithmicDepthBuffer`
- Fog default: `near 200`, `far 4000` (`DEFAULT_FOG` in scene-schema)
- Grid: infinite, `fadeDistance` 2500
- Orbit: `maxDistance` free (1e9)

## Character assets (R2 / D1 / ObjectStore)

- **CDN:** `https://assets.grudge-studio.com`
- **ObjectStore:** `https://objectstore.grudge-studio.com`
- **Policy:** only `builtin:<key>` or assets CDN (see `assetUrlPolicy.ts`)
- Prefer Fast options / `list_fast_assets` / `spawn_fast_asset`
- Rig: Bip001 for grudge6 / Toon RTS; bake via grudge-asset-pipeline
- Template: `spawn-r2-character` script key

## Script templates (smart kit)

Create via Scripts tab sparkle button or AI `list_script_templates` / `create_script_from_template`.

| Key | Role |
|-----|------|
| `wasd-character-controller` | SI walk/run/jump + gait events |
| `third-person-camera` | Orbit follow, zoom, pitch clamp |
| `network-manager-mirror` | Mirror/uMMORPG-style room pose send |
| `remote-player-interpolator` | Smooth remote avatars |
| `outline-select-highlight` | Soft target outline events |
| `spawn-r2-character` | builtin character hook |
| **`island-spawn-on-terrain`** | **Spawn on pirate-islands/heightmap (Rapier raycast, SI, Y-up)** |
| **`simple-interactable`** | **E-key proximity interact (no fetch/require/process)** |
| **`camera-follow-island`** | **Island third-person follow (SI, Y-up, zoom, smooth lerp)** |
| **`puter-project-note`** | **Documents Puter FS scope (projects only, not island state)** |

Source: `artifacts/game-forge/src/ai/tools/scripting/templates.ts`

### Island-aware patterns (production)

- **SI metres:** 1 unit = 1 metre. Human ~1.8m. Never 100× giants.
- **Y-up:** Ground is XZ plane; Y is vertical.
- **Ground snap:** Rapier `castRay(origin, [0,-1,0], maxDist, [], ["Terrain"])` for foot placement.
- **Island SSOT:** Railway Postgres `/api/island` (NOT Puter FS).
- **Live lobby map:** `pirate-islands` scene.glb (R2 CDN, `builtin:map-pirate-islands-scene`).
- **home-island-contract 1.4.0:** `rtsHeightmapResolution: 128`, `terrainBounds` config.
- **No fetch/require/process:** Player scripts run in browser; use `ctx.scene` / `ctx.events` for comms.
- **Puter FS:** Editor project files only (scripts, scenes, prefabs) — NOT island state.
- **One physics engine:** `@dimforge/rapier3d-compat` only (no Cannon, no second Rapier).
- **One AnimationMixer:** Bip001 packs; `list_animations` → `apply_animation`.


## Reference stacks (do not vendor blindly)

1. **grudgecontrol multiplayer-gltf** — Firebase room pose, character list, spawn points, camera min/max distance  
   https://github.com/MolochDaGod/grudgecontrol/blob/master/example/multiplayer-gltf.js
2. **three-player-controller** — third-person / player controller patterns  
   https://github.com/hh-hang/three-player-controller
3. **Unity uMMORPG / Mirror** — NetworkManager, client authority, interest management → map to Grudge live WS / Carrier, not full C# Mirror in browser

## AI agent rules

1. Prefer templates over inventing multiplayer from scratch.
2. Characters: `builtin:` / Fast assets only — never random hosts.
3. Pair `wasd-character-controller` + `camera-follow-island` (or `third-person-camera`) for TPS playtest.
4. Network: emit `playerPose` events; attach real transport via fleet live servers skill.
5. Frame with **F** after spawning hierarchy (parent + children).
6. Save: Ctrl+S → Puter or local project; Cloud Save for Puter snapshot.
7. **Island spawn:** Use `island-spawn-on-terrain` for terrain-aware placement (Rapier raycast, SI, Y-up).
8. **Interactables:** Use `simple-interactable` for E-key proximity (no fetch/require/process).
9. **Camera:** Use `camera-follow-island` for island-scale follow (SI, smooth lerp, zoom).
10. **Puter scope:** Project files only (NOT island state). Island state lives on Railway.
11. **One physics:** Rapier only (`@dimforge/rapier3d-compat`). No Cannon, no second Rapier instance.
12. **One mixer:** Bip001 packs via `list_animations` → `apply_animation`.


## Deploy

- SPA: GHA Deploy Forge SPA → forge.grudge-studio.com
- Edge free-ai: catalog + agent jobs + Groq
- Play data: Railway (player bag) vs Puter (editor projects)
- Live multiplayer rooms: grudge-live-servers skill

## See also

`forge-editor` · `grudge-warlords-assets` · `grudge-character-correctness` · `grudge-live-servers` · `grudge-fleet-combat`
