---
layout: default
title: three.js editor parity
nav_order: 12
---
# Forge â†” three.js Editor â€” Review, Parity & Best Practices

**Audience:** Forge agents + human maintainers  
**Live editor:** https://forge.grudge-studio.com  
**Reference:** [mrdoob/three.js `editor/`](https://github.com/mrdoob/three.js/tree/master/editor) Â· [threejs.org/docs](https://threejs.org/docs/) Â· [threejs.org/manual](https://threejs.org/manual/) Â· [threejs.org/editor](https://threejs.org/editor/)  
**Code root:** `artifacts/game-forge/`  
**Last review:** 2026-09-05  

This document is the **SSOT** for making Grudge Studio Forge a *genuine* production scene editor: three.js-editor DNA, AI + devtools, importâ†’scene conversion, and deploy discipline.

---

## 1. What the official three.js editor is

The stock editor (`editor/js/Editor.js`) is a **thin, signal-driven host** around a real Three.js scene:

| Piece | Role |
|-------|------|
| **Editor** | Owns `scene`, `camera`, `sceneHelpers`, geometries/materials maps, scripts |
| **signals** | Pub/sub for every mutation (`sceneGraphChanged`, `objectSelected`, â€¦) |
| **History + Command** | `execute(cmd)` / undo / redo â€” all edits go through commands |
| **Loader** | Multi-format open (glTF, OBJ, FBX, STL, â€¦ â†’ Object3D) |
| **toJSON / fromJSON** | Project = camera + scene (`Object3D.toJSON`) + scripts + history + renderer config |
| **Viewport** | Render loop, TransformControls, helpers (grid, camera, light, skeleton) |
| **Sidebar / Menubar** | Scene graph, object props, material, project settings |
| **Player** | Optional runtime preview |

It is **not** a game engine: no Rapier, no fleets, no AI tools, no R2. Forge **extends** this model into Grudge production.

---

## 2. Parity matrix (Forge today)

| three.js editor concept | Forge equivalent | Status | Notes / gaps |
|-------------------------|------------------|--------|--------------|
| `Editor` core | `store/editor.ts` (Zustand) + `scene/` | âœ… | Scene is **entity graph** (`SceneData`), not raw Object3D tree |
| Signals / events | Zustand subscriptions + `commandStack` notify | âœ… | Prefer commands over silent store writes |
| Command history | `lib/commands.ts` `CommandStack` | âœ… | Coalescing transform drags (800 ms) â€” same idea as three.js |
| AI undo | `ai/aiTurn.ts` `makeAITurnCommand` | âœ… | Snapshot before/after each tool |
| Menubar | `editor/MenuBar.tsx` | âœ… | File / Edit / View / Help |
| Hierarchy sidebar | `editor/Hierarchy.tsx` | ✅ | Entity tree + pack/mesh pull (`subNode`, `childrenOnly`) |
| Inspector | `editor/Inspector.tsx` | âœ… | Transform, physics, materials, scripts |
| Viewport + gizmos | `editor/Viewport.tsx` + TransformControls | âœ… | Skill: `threejs-controls` |
| Helpers (grid/light/skeleton) | Viewport toggles + R3F helpers | ðŸŸ¡ | Ensure skeleton + light helpers match three.js View menu completeness |
| Project toJSON | `.gfscene.json` + GitHub sync | âœ… | Game schema, not raw `ObjectLoader` scene dump |
| ObjectLoader project | Optional raw three export | ðŸŸ¡ | Add â€œExport three.js Editor JSONâ€ for interop |
| Multi-format Loader | `lib/assetConverter.ts` + `AssetDropZone` | âœ… | FBX/OBJ/STL/glTF/ZIP â†’ meshopt GLB |
| Materials library | scene-schema materials + AI materials tools | âœ… | Layer Ã— Surface Ã— Material axes |
| Scripts on objects | Monaco + entity scripts | âœ… **stronger** | Runtime `start/update` + AI templates |
| Player preview | Play mode + `artifacts/player` | âœ… | Rapier + same R3F stack |
| three.js DevTools | `lib/threeDevtools.ts` | âœ… | `__THREE_DEVTOOLS__` observe bridge |
| AI Worker | 70+ tools, multi-provider | âœ… **Forge-only** | design / diagnose / batch_generate |
| Physics | Rapier layers | âœ… **Forge-only** | three.js editor has none |
| Deploy / fleet | Vercel SPA + Railway API + CF Worker + R2 | âœ… **Forge-only** | See `DEPLOYMENT.md` |

**Verdict:** Forge already implements the **command + viewport + load/export + hierarchy** spine of the three.js editor, then adds game ECS, AI, Rapier, and fleet deploy. Gaps are mainly **interop** (export raw three.js project), **helper completeness**, and **documented best-practice gates** for agents.

---

## 3. Architecture target (genuine Forge = three.js + Grudge)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Menubar Â· Hotkeys Â· History (CommandStack) Â· AI Worker          â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ Hierarchy    â”‚  Viewport (R3F)              â”‚ Inspector         â”‚
â”‚ Prefabs      â”‚  Â· TransformControls         â”‚ Materials         â”‚
â”‚ Assets       â”‚  Â· Orbit / Map / Fly         â”‚ Physics (Rapier)  â”‚
â”‚ Nodes        â”‚  Â· Helpers (grid/skel/light) â”‚ Scripts (Monaco)  â”‚
â”‚ Console      â”‚  Â· DevTools observe()        â”‚ Layers / Stats    â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  SceneData SSOT (@workspace/scene-schema)                        â”‚
â”‚  Entity graph â†’ EntityRenderer â†’ Three Object3D / SkinnedMesh    â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Import: drop zone â†’ convertFile â†’ R2 + .meta.json               â”‚
â”‚  Export: .gfscene.json Â· GLB scene bake Â· (opt) three Editor JSONâ”‚
â”‚  Deploy: build SPA â†’ origin/Worker Â· API Railway Â· assets R2     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Hard rules (do not regress)

1. **One 3D stack:** Three.js + R3F + Rapier. No Babylon reintroduction.  
2. **Edits go through `CommandStack`** (human + AI). No silent `setScene` for user actions.  
3. **Canonical asset:** production mesh = **GLB + meshopt** (+ optional fleet bake on R2).  
4. **SI units:** 1 unit = 1 metre; human ~1.8 m (`grudge-world-scale`).  
5. **Assets from ObjectStore/R2** â€” no Meshy capsules as shipped content.  
6. **Color management:** `renderer.outputColorSpace = SRGBColorSpace`; textures `SRGBColorSpace` for color maps.  
7. **Dispose** geometries/materials/textures on entity remove (WebGL Insights / three manual).  

---

## 4. File types â†’ scenes (import matrix)

Aligned with [Loading 3D models](https://threejs.org/manual/en/load-gltf.html) + Forge converter:

| Extension | Kind (`fileKind.ts`) | Path | Output |
|-----------|----------------------|------|--------|
| `.glb` | `glb` | Optimize meshopt (passthrough fallback) | `*.glb` + `.meta.json` |
| `.gltf` | `gltf` | Load â†’ `GLTFExporter` binary â†’ meshopt | `.glb` |
| `.fbx` | `fbx` | `FBXLoader` â†’ export GLB | `.glb` |
| `.obj` (+ `.mtl`) | `obj` | OBJ+MTL (+ ZIP siblings) â†’ GLB | `.glb` |
| `.stl` | `stl` | Geometry + default material â†’ GLB | `.glb` |
| `.zip` | `zip` | Extract + convert each 3D | `.glb[]` |
| `.png/.jpg/.webp/.ktx2` | `image` | Passthrough upload | texture asset |
| `.mp3/.wav/.ogg` | `audio` | Passthrough | audio asset |
| `.json` / `.gfscene` / `.gfscene.json` | `scene-json` | Parse as `SceneData` | live scene replace |
| **Planned:** `.ply`, `.dae`, `.usdz` | â€” | Add loaders when needed | convert â†’ `.glb` |

### Scene formats (do not confuse)

| Format | Purpose |
|--------|---------|
| **`.gfscene.json`** | Forge project scene (entities, scripts, physics, layers) â€” **SSOT for games** |
| **GLB scene bake** | Geometry-only snapshot for maps / CDN |
| **three.js editor JSON** | Interop with [threejs.org/editor](https://threejs.org/editor/) (`ObjectLoader`) â€” optional export |
| **GitHub pack** | `forge.project.json` + `scenes/*.gfscene.json` + scripts (`githubSync.ts`) |

### Conversion best practices ([docs](https://threejs.org/docs/#examples/en/exporters/GLTFExporter))

- Prefer **binary GLB** + `embedImages: true` for single-file CDN delivery.  
- Browser path: **meshopt only** (no Basis encoder in SPA). Desktop may add KTX2.  
- After skinned clone, pass **`animations`** explicitly into exporter.  
- Validate broken GLBs at [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/).  
- Strip helpers/gizmos before export.  
- Write **sibling `.meta.json`** (tri/vert/bone/clip counts) for Library UI.  

Code SSOT: `lib/assetConverter.ts`, skill **`threejs-asset-io`**.

---

## 5. Viewport & rendering best practices (three.js manual)

From [Creating a scene](https://threejs.org/manual/en/fundamentals.html), [Lighting](https://threejs.org/manual/en/lights.html), [Responsive](https://threejs.org/manual/en/responsive.html):

| Practice | Forge action |
|----------|----------------|
| Single render loop / rAF | Viewport owns loop; avoid nested loops per panel |
| Resize â†’ update camera aspect + `setSize` | `windowResize` path in Viewport |
| `outputColorSpace = SRGBColorSpace` | Already required on WebGLRenderer |
| Tone mapping | ACESFilmic + exposure in project/env settings |
| Shadows | One sun dir light + selective cast/receive |
| Instancing | Prefer for repeated props (>10 same mesh) |
| Dispose on remove | Entity unmount must dispose GPU resources |
| Helpers | Grid, axes, light, skeleton, camera â€” toggle like three.js View menu |
| DevTools | Call `observeForDevtools(scene)` / renderer on mount (`threeDevtools.ts`) |

Physics-specific: skill **`rapier-physics-patterns`** + layer matrix.

---

## 6. AI + dev tools (Forge-native, three.js-aligned)

### AI Worker (must stay command-safe)

| Rule | Detail |
|------|--------|
| Tools mutate via **commands** | Snapshot â†’ tool â†’ `makeAITurnCommand` |
| Destructive tools | Confirm + `DESTRUCTIVE_TOOLS` set |
| Diagnose first | `ai/tools/systems/diagnose.ts` before mass fix |
| Design tools | lighting / camera / layouts / palette under `ai/tools/design/` |
| Knowledge | Point agents at this doc + three.js manual links |
| Audit log | `ai/aiAuditLog.ts` for â€œundo last AI turnâ€ |

### Dev tools checklist

```
[ ] Chrome three.js Developer Tools extension + __THREE_DEVTOOLS__ bridge
[ ] Console panel (editor/Console.tsx) logs convert/bake errors
[ ] Hotkey cheatsheet (W/E/R, F focus, P play, Esc stop)
[ ] GlbInspectorDialog for dropped assets
[ ] History labels readable (Command.label)
[ ] Performance: entity count, draw calls, physics bodies in status bar
```

---

## 7. Deployment (editor â†’ playable)

See **`DEPLOYMENT.md`** (Forge SPA host) and **`docs/GAME_DEPLOYMENT_DEFINITIONS.md`**
(typed `PublishChannel` / `SurfaceClass` / L0â€“L9 / API systems â€” `lib/gameDeployments.ts`).

**Purged:** `bundle_in_spa`, Replit storage, `api.grudge-studio.com` as player SSOT.

Summary (Forge SPA only):

| Artifact | Host | URL |
|----------|------|-----|
| Editor SPA | CF Worker â†’ origin / Vercel | `forge.grudge-studio.com` |
| API | Railway + Worker `/api` | `forge.grudge-studio.com/api/*` |
| Assets | R2 | `assets.grudge-studio.com` |
| Desktop | GitHub Releases | NSIS installer |
| Player embed | `artifacts/player` | single-file / embed |

### Deploy best practices

1. Build SPA on **â‰¥16 GB RAM** machine (`scripts/build-spa.sh`) â€” Vercel 8 GB OOMs R3F+Monaco+Rapier.  
2. Never ship Replit origin paths (`/api/storage/objects/` dead).  
3. Scenes must reference **R2 / builtin:** URLs, not ephemeral blob: URLs.  
4. Smoke: `scripts/smoke-forge-prod.mjs` + `probe-live-forge.mjs` after deploy.  
5. Publish playtest: scene JSON + asset keys + player build â€” not â€œeditor-onlyâ€ local state.  

---

## 8. Gap backlog (prioritized)

### P0 â€” editor authenticity

| Gap | Improvement |
|-----|-------------|
| View helpers incomplete vs three.js | Menu: Grid / CameraHelpers / LightHelpers / SkeletonHelpers (match three.js View) |
| No three.js Editor JSON export | File â†’ Export â†’ `project.three.json` via scene bake to Object3D + `toJSON` |
| History panel UI | Visual undo stack like three.js sidebar History |
| Silent store writes | Lint / agent rule: user edits only via `commandStack.push` |

### P1 â€” conversion & scenes

| Gap | Improvement |
|-----|-------------|
| No PLY/DAE/USDZ | Add loaders + convert â†’ GLB when demand appears |
| Scene bake of full map | One-click â€œBake map GLBâ€ for pirate-islands / sectors â†’ R2 |
| Animation clips on import | Always list clips in `.meta.json`; auto-suggest idle |
| Color space on converted mats | Force MeshStandard + sRGB maps in converter |

### P2 â€” AI / fleet

| Gap | Improvement |
|-----|-------------|
| AI knowledge of three.js docs | Inject short â€œmanual bulletsâ€ into system prompt from this file |
| Fleet CDN keys in AssetBrowser | Prefill `assets.grudge-studio.com` production maps |
| Character / grudge6 kits | Deep link Space / Foundry bake JSON into model entities |

### P3 â€” polish

| Gap | Improvement |
|-----|-------------|
| Path tracer / viewport shading modes | Optional solid/normals like three.js |
| XR offer | Only if product needs WebXR preview |

---

## 9. Agent checklist (before â€œForge work doneâ€)

```
[ ] Loaded forge-editor + threejs-asset-io (+ controls/physics as needed)
[ ] Mutations use CommandStack (or makeAITurnCommand for AI)
[ ] Imports land as meshopt GLB + meta sidecar when 3D
[ ] Scenes saved as .gfscene.json with R2/builtin asset URLs
[ ] Viewport: sRGB, SI metres, dispose on remove
[ ] DevTools observe wired for new canvases
[ ] Deploy path matches DEPLOYMENT.md (no Replit)
[ ] Best-practices tips available in context menu for the surface edited
[ ] No Babylon / second engine
```

---

## 10. Key code map

| Concern | Path |
|---------|------|
| Commands | `artifacts/game-forge/src/lib/commands.ts` |
| File kinds | `â€¦/lib/fileKind.ts` |
| Convert pipeline | `â€¦/lib/assetConverter.ts` |
| Drop zone | `â€¦/editor/AssetDropZone.tsx` |
| DevTools | `â€¦/lib/threeDevtools.ts` |
| Best practices UI | `â€¦/lib/bestPractices.ts`, `â€¦/editor/BestPracticesMenu.tsx` |
| AI tools | `â€¦/ai/tools/**`, `â€¦/lib/aiTools.ts` |
| Scene schema | `lib/scene-schema/` |
| Deploy | `DEPLOYMENT.md`, `scripts/build-spa.*`, `scripts/deploy-*` |
| Skills | `.agents/skills/forge-editor`, `threejs-asset-io`, `threejs-controls`, … |
| Mesh pull | `…/lib/glbHierarchy.ts`, `…/lib/meshEquipApply.ts`, `store/editor.ts` `explodeGlbHierarchy` |

---

## 11. References

- three.js Editor source: https://github.com/mrdoob/three.js/tree/master/editor  
- three.js Editor live: https://threejs.org/editor/  
- Docs: https://threejs.org/docs/  
- Manual: https://threejs.org/manual/  
- glTF: https://www.khronos.org/gltf/  
- three.js DevTools: https://github.com/threejs/devtools  

**Product line:** Forge is the **genuine Grudge Studio editor** — three.js-editor architecture + game ECS + AI + Rapier + fleet deploy — not a fork of the stock editor, and not a generic sandbox.

---

## 12. Mesh pull (v0.4.4)

Asset GLBs must not stay one fused object when they contain multiple static meshes.

| Step | Path |
|------|------|
| Walk meshes | `lib/glbHierarchy.ts` `collectPullableMeshes` |
| Spawn + explode | `store/editor.ts` `spawnModelAndPull` / `explodeGlbHierarchy` |
| Isolate | `lib/meshEquipApply.ts` `isolateNamedMeshAtOrigin` |
| Schema | `model.subNode` + `model.childrenOnly` (not locators) |
| Nested | `parentOrdinal` → entity `parentId` |

Keep fused: play kits, map shells, packs over 128 meshes. Info: `/catalog/forge-editor.json`.

