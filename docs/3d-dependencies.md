---
layout: default
title: 3D dependencies
nav_order: 5
permalink: /3d-dependencies/
description: Best-practice package matrix for Three.js, R3F, Rapier, pathfinding, effects.
---

# 3D dependencies (Forge SSOT)

Pinned via **pnpm catalog** in `pnpm-workspace.yaml` + root `pnpm.overrides`.  
Fleet guide: skill **`grudge-3d-game-packages`**.

## Core stack (required)

| Package | Role | Pin / range |
|---|---|---|
| **three** | Renderer, math, curves, loaders API | **0.185.1** (fleet r185) |
| **@types/three** | TypeScript | **0.185.1** |
| **@react-three/fiber** | React reconcilier for Three | **^9.6.1** |
| **@react-three/drei** | Helpers (Orbit, Grid, Html, curves, GizmoHelper…) | **^10.7.7** |
| **@react-three/rapier** | `<Physics>`, rigid bodies, CCT helpers | **^2.2.0** |
| **@dimforge/rapier3d** | Physics WASM (streaming via vite-plugin-wasm) | **^0.19.3** |
| **@react-three/postprocessing** | R3F EffectComposer bridge | **^3.0.4** |
| **postprocessing** | SSAO, bloom, SMAA, outline, etc. | **^6.39.4** |
| **three-stdlib** | Controls, loaders, helpers (editor DNA) | **^2.36.1** |
| **three-mesh-bvh** | Fast raycast / ground probes | **^0.9.13** |
| **react** / **react-dom** | UI shell | **19.1.0** |
| **Node.js** | Tooling engines | **>=22.12** (workspace engines) |

> **Note:** Imperative fleet games often use `@dimforge/rapier3d-compat` (no separate WASM step). Forge uses **`@dimforge/rapier3d`** + `vite-plugin-wasm` + `vite-plugin-top-level-await` for smaller streaming WASM. Do not mix both in one body graph.

## Pathfinding & AI navigation

| Package | Role |
|---|---|
| **recast-navigation** | Navmesh bake / query (emscripten) |
| **@recast-navigation/three** | Three geometry → Recast |
| **yuka** | Steering / AI agents on navmesh corridors |

Spline paths for cutscenes / roads use **three curves** + **maath** (not a separate “spline” npm required).

## Splines, math, CSG

| Package | Role |
|---|---|
| **maath** | Easing, frames, vector helpers (with drei) |
| **three** `Curves` / `CatmullRomCurve3` | Path spline SSOT |
| **@react-three/drei** `CurveModifier`, `Line` | R3F spline display |
| **three-bvh-csg** | Boolean mesh ops (editor tools) |
| **quickhull3d** / **vhacd-js** | Hull / collider helpers |

## Effects (post)

| Layer | Package |
|---|---|
| R3F wrapper | `@react-three/postprocessing` |
| Engine | `postprocessing` (pmndrs) |
| In-app | `EffectsRig` + quality gate (Cinematic vs Performance) |

Prefer **pmndrs postprocessing** over ad-hoc EffectComposer stacks.

## Convert + editor helpers (P0/P1)

| Package | Role |
|---|---|
| **@gltf-transform/core** (+ extensions, functions) | Offline GLB dedup / prune / weld |
| **meshoptimizer** | EXT_meshopt_compression (local, not esm.sh) |
| **detect-gpu** | Boot-time render quality (`lib/deviceTier.ts`) |
| **idb-keyval** | Large drafts when localStorage quota fails |
| **comlink** | Worker RPC helper (`lib/comlinkWorker.ts`) |

Optional later: **howler** (SFX), **colyseus.js** (play client only) — see [multiplayer deploy]({% link multiplayer-deploy.md %}).

## Fleet assets (D1 + R2 + ObjectStore)

| Layer | Authority | Forge usage |
|---|---|---|
| **Binaries** | R2 `assets.grudge-studio.com` | `builtin:` keys, Fast options, `search_fleet_assets` |
| **Mesh index** | D1 `grudge-assets-db` via `api.grudge-studio.com/assets` | Edge `GET /api/catalog/search` (Worker filters; fleet API has weak query) |
| **Gamedata** | ObjectStore `weapons|equipment|materials.json` | Edge `GET /api/catalog/gamedata` — icons/stats, not meshes |
| **Agent jobs** | D1 `forge-agent` | `POST /api/agent/jobs` only — never store GLBs here |
| **Player bag** | Railway Postgres | Not Forge D1 |

AI tools: `list_fast_assets` · `search_fleet_assets` · `spawn_fleet_asset` · `list_gamedata` · `agent_stack_status`.  
Canonical heroes: `builtin:grudge6:warrior|orc|…` (FBX kits). Weapons: `builtin:race-weapon:*` (grudge6 library).

## Fleet optional (`optionalDependencies`)

| Package | Role |
|---|---|
| `@grudge-studio/sdk` | Umbrella fleet helpers |
| `@grudge-studio/engine` | Physics defaults / debug gate |
| `@grudge-studio/assets` / `asset-resolver` | CDN paths |
| `@grudge-studio/animator` | Bip001 / bake clips |
| `@grudge-studio/core` | Auth origins |

## Chunking (Vite)

`three` + `@react-three/*` + `postprocessing` + `three-stdlib` + `three-mesh-bvh` + `maath` ship as **one** `vendor-3d` chunk. Splitting three vs R3F causes circular TLA init crashes (`prototype` undefined).

## Install / bump

```bash
# From monorepo root
pnpm install
pnpm --filter @workspace/game-forge run typecheck
pnpm --filter @workspace/game-forge run build
```

Bump versions only in **`pnpm-workspace.yaml` catalog** (+ root overrides for `three` / `@types/three`), then reinstall.

## Do not add (by default)

| Package | Why |
|---|---|
| `cannon-es` / Ammo | Second physics engine |
| `babylonjs` | Excluded from workspace |
| `three-pathfinding` | Prefer Recast + Yuka already wired |
| `@dimforge/rapier3d-compat` **alongside** `rapier3d` | Duplicate WASM stacks |

## Related

- [Best practices]({% link best-practices.md %})
- [Deployment]({% link deployment.md %})
- [Multiplayer deploy]({% link multiplayer-deploy.md %})
- Repo skill: `forge-editor` · `forge-gameplay-scripts`
