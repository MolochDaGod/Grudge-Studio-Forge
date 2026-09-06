---
name: forge-editor
description: "Grudge Studio Forge (GameForge) editor development skill. Use when working on F:\\GitHub\\Grudge-Studio-Forge, forge.grudge-studio.com, the Three.js scene editor, AI Worker, Rapier physics, scene templates, script system, node graph, asset pipeline, or any Forge editor feature. Covers: pnpm monorepo structure (9 lib + 5 artifact packages), R3F viewport, Zustand store, AI providers (Anthropic/Puter/Ollama/CF Workers AI), Monaco script editor, @xyflow node graph, Drizzle DB schema, R2 storage, Puter auth, Vercel+Railway+Cloudflare deployment, Electron desktop app. Trigger on: 'forge', 'game-forge', 'scene editor', 'scene template', 'AI Worker', 'node graph', 'script template', 'asset converter', 'builtin model', 'prefab', 'Rapier physics', 'navmesh', 'forge-scene', 'landing page', 'forge.grudge-studio.com'."
---

# Grudge Studio Forge — Project Skill

## Project Location
`F:\GitHub\Grudge-Studio-Forge` — pnpm monorepo, TypeScript 5.9

## Architecture Overview
```
Grudge-Studio-Forge/
├── artifacts/
│   ├── game-forge/           # Editor SPA (Vite + R3F + Rapier + Monaco)
│   ├── api-server/           # Express 5 backend
│   ├── game-forge-desktop/   # Electron Windows wrapper
│   ├── player/               # Embeddable scene runtime (single-file HTML)
│   └── mockup-sandbox/       # Dev-only design tool
├── lib/
│   ├── scene-schema/         # Zod schema for scene graph
│   ├── scene-templates/      # Built-in template builders + tests
│   ├── api-client-react/     # React Query hooks
│   ├── api-zod/              # Shared request/response validation
│   ├── api-spec/             # API route type definitions
│   ├── db/                   # Drizzle ORM schema + idempotent migrations
│   ├── desktop-bridge/       # IPC bridge (Electron ↔ renderer)
│   └── object-storage-web/   # R2/S3 upload via Uppy
│   # (no babylon-runtime — play path is artifacts/player R3F+Rapier only)
├── scripts/
│   ├── setup-offline.ps1     # 1-click offline setup (Windows)
│   └── setup-offline.sh      # 1-click offline setup (Mac/Linux)
└── DEPLOYMENT.md             # Full deployment guide
```

## Key Files & Systems

### AI System
- `lib/ai/providers/types.ts` — provider abstraction, MODELS catalog (13 models)
- `lib/ai/providers/serverAnthropicProvider.ts` — Claude via server proxy
- `lib/ai/providers/puterProvider.ts` — Puter AI (9 free models)
- `lib/ai/providers/ollamaProvider.ts` — Ollama local (4 offline models)
- `lib/ai/providers/index.ts` — provider registry
- `lib/aiClient.ts` — runConversation tool loop (MAX_TURNS=15, COOLDOWN_TURN=14)
- `lib/aiTools.ts` — 70+ AI tool definitions + executors
- `editor/AIWorkerPanel.tsx` — slide-out AI chat panel
- `editor/AIInlinePrompt.tsx` — per-tab contextual AI bar
- `editor/AIIcon3D.tsx` — spinning 3D gem icon (R3F Canvas)
- `api-server/src/routes/ai.ts` — SSE streaming proxy (MAX_TOKENS_CAP=15360)
- `api-server/src/routes/cfAi.ts` — Cloudflare Workers AI (image/text/vision)

### Scene & Entities
- `store/editor.ts` — Zustand store (SceneData, entities, selection, undo stack)
- `scene/types.ts` — SceneEntity, EntityType, Vec3, SceneData, Environment
- Entity types: box, sphere, cylinder, plane, light, camera, model, empty, cloth, flag, particles
- IDs: nanoid(8) for existing entities, UUID v4 via `projectConventions.ts` for new ones
- `lib/builtinModels.ts` — GLB asset registry (resolves `builtin:` scheme)
- **Mesh pull (v0.4.4):** `lib/glbHierarchy.ts` `collectPullableMeshes` → `store/editor.ts` `explodeGlbHierarchy` / `spawnModelAndPull`. Pack root `model.childrenOnly`; children isolate `model.subNode`. Nested meshes keep `parentId`. Play kits + map shells stay fused. Cap 128.

### Script System (hybrid — canonical)
- `editor/ScriptEditor.tsx` — Monaco editor with script CRUD
- `ai/tools/scripting/templates.ts` — JS templates + **Blazor pack** templates (`blazor-spin` / `blazor-bob` / `blazor-strafe`)
- **JS scripts:** `exports.start(entity, ctx)` / `exports.update(entity, ctx)`
- **C# hybrid:**
  - **Default (live edit):** Unity-flavoured subset → JS via `csTranspile.ts` (no WASM required)
  - **Production packs:** `// @forge-runtime: blazor` + `// @forge-pack: Spin|Bob|Strafe` → real .NET `RegisterBuiltin` → `AttachScript` → `TickEntity` each frame (`blazorScriptSession.ts`)
  - **Mod packs:** `// @forge-assembly: <base64 dll>` → `RegisterScriptType` then attach/tick
- Builtins live in `csharp/GameForgeRuntime/Behaviours/`; rebuild: `bash csharp/GameForgeRuntime/build.sh` → `public/_framework/`
- ctx members (JS): ctx.scene, ctx.events, ctx.state, ctx.time, ctx.input, ctx.log
- Drag entity from Hierarchy → Scripts tab auto-creates & attaches script
- See `scene/csHybrid.ts` for directive grammar

### Node Graph (Visual Scripting)
- `editor/NodesPanel.tsx` — @xyflow/react visual node editor
- `store/nodeGraph.ts` — Zustand store for node graphs (scene/logic/shader)
- `editor/nodes/types.ts` — SceneNodeKind (geomBox, geomSphere, material, mesh, light, transform, sceneOutput)
- `editor/nodes/aiGraphGen.ts` — prompt-to-graph generator (pattern matching, zero latency)
- `editor/nodes/sceneCompile.ts` — compiles node graph → scene entities
- Drop assets from AssetBrowser → creates Mesh node
- Drop entities from Hierarchy → creates Transform node

### Asset Pipeline
- `lib/assetConverter.ts` — browser FBX/OBJ/STL→GLB via **three-stdlib** + gltf-transform meshopt
- Fleet production bake: ObjectStore **`grudge-convert`** → `assets.grudge-studio.com` (not a second CDN)
- `lib/animationLibrary.ts` — 22-clip animation catalog (Mixamo patterns)
- `desktop/src/ipc/tools.ts` — desktop conversion (Assimp + glTF-Transform)
- `lib/object-storage-web/` — R2 upload via Uppy + presigned URLs
- `api-server/src/lib/r2Storage.ts` — Cloudflare R2 via native S3 endpoint

### GitHub Integration
- `lib/githubSync.ts` — serialize/push/pull projects to GitHub repos
- File structure: forge.project.json, scenes/*.gfscene.json, scripts/001-*.js, prefabs/*.prefab.json
- Uses Git tree API (blobs → tree → commit → update ref)
- PAT stored in localStorage, direct browser→GitHub API

### Project Conventions
- `lib/projectConventions.ts` — naming rules, UUID v4, project audit
- Entity names: PascalCase; Script names: camelCase; File names: kebab-case
- `auditProject()` returns 0-100 organization score

### Templates
- `lib/scene-templates/src/builders.ts` — 5 templates (3× deathmatch, RPG village, dungeon interior)
- `lib/scene-templates/src/index.ts` — manifest + version (TEMPLATES_VERSION = "20260528.1")
- Templates are pure functions returning SceneData, seeded to R2 on API boot

### Landing Page
- `pages/LandingPage.tsx` — dark cinematic design at `/`
- wouter routing: `/` = landing, `/editor` (or any other path) = editor (lazy-loaded)

## three.js editor parity (genuine Forge)

**SSOT:** `docs/THREEJS_EDITOR_PARITY.md` — review vs [mrdoob/three.js/editor](https://github.com/mrdoob/three.js/tree/master/editor) + [docs](https://threejs.org/docs/) + [manual](https://threejs.org/manual/).

| three.js editor | Forge |
|-----------------|--------|
| `Editor` + signals | Zustand `store/editor.ts` + entity `SceneData` |
| Command history | `lib/commands.ts` (+ AI `makeAITurnCommand`) |
| Loader multi-format | `lib/assetConverter.ts` + `fileKind.ts` → meshopt GLB |
| toJSON project | `.gfscene.json` + GitHub pack (not raw ObjectLoader by default) |
| Viewport helpers | R3F Viewport + `threeDevtools.ts` bridge |
| Sidebar / Menubar | Hierarchy, Inspector, MenuBar |
| Object3D children | **Pull child meshes** — real entities, not locators |
| **Plus** | Rapier, AI Worker (70+ tools), fleet R2 deploy |

**Agent rules when editing the editor:**

1. User/AI scene mutations → **CommandStack** only.  
2. 3D import → convert to **meshopt GLB** + `.meta.json`; scenes as **`.gfscene.json`**.  
3. SI metres, sRGB color management, dispose GPU resources.  
4. Deploy via **`DEPLOYMENT.md`** (no Replit object paths).  
5. Surface tips via `lib/bestPractices.ts` / AI tool `list_forge_best_practices`.  
6. Deploy channels via `lib/gameDeployments.ts` / AI `list_game_deployments` — **docs/GAME_DEPLOYMENT_DEFINITIONS.md**.  
7. Skills: `threejs-asset-io`, `threejs-controls`, `rapier-physics-patterns` as needed.

### Purged (never recommend)

| Purged | Use instead |
|--------|-------------|
| `bundle_in_spa` | `r2_user_assets` + CDN |
| Replit object storage | Forge R2 upload |
| `api.grudge-studio.com` as player SSOT | Railway same-origin `/api/*` |
| batch_generate as fleet deploy | `fleet_satellite` + onboarding |

### File → scene pipeline

| Kind | Pipeline |
|------|----------|
| glb/gltf/fbx/obj/stl/zip | Implemented convert → R2 |
| .gfscene.json | Live scene import |
| ply/dae/usdz | Classified, planned (desktop Assimp interim) |

## Deployment
- **Frontend SPA**: CF Worker → origin / high-RAM build (`scripts/build-spa.*`) — see **DEPLOYMENT.md**
- **API Server**: Railway (Docker, `Dockerfile` in repo root)
- **DNS/CDN/Storage**: Cloudflare (R2, Workers AI, DNS for grudge-studio.com)
- **Desktop**: Local build via electron-builder + GitHub Releases
- **Offline**: Ollama + setup scripts (pwsh/bash)
- GitHub: repo hosting + CI + desktop Releases

## Common Tasks

### Adding a new AI tool
1. Add tool def + executor in `lib/aiTools.ts` (or a sub-module in `ai/tools/<area>/`)
2. If destructive, add name to `DESTRUCTIVE_TOOLS` set
3. Tool definitions are JSON schema — shipped with every AI request

### Optional next step — `batch_generate` (shipped, not P0 deploy)
- Module: `artifacts/game-forge/src/ai/tools/batchGenerate/`
- Tool name: `batch_generate` — multi-job CF texture / skybox / lore + primitive packs (grid/ring/line/scatter/cluster)
- Caps: 12 jobs, 48 primitives/job, concurrency 1–4 (default 2)
- **Not** fleet one-click ship / `@grudge-studio/*` wiring — those remain the deploy P0 slice
- AI system prompt marks it optional; use when filling many surfaces/props at once

### Adding a new script template
1. Add entry to `SCRIPT_TEMPLATES` array in `ai/tools/scripting/templates.ts`
2. Use the `exports.start/update` shape with `ctx.scene/events/state/time/keys/log`

### Adding a new builtin model
1. Place GLB in `artifacts/game-forge/public/builtin/`
2. Add key to `BUILTIN_MODELS` in `lib/builtinModels.ts`
3. Reference in scenes as `builtin:<key>`

### Adding a new scene template
1. Add builder function in `lib/scene-templates/src/builders.ts`
2. Register in `SCENE_TEMPLATES` array in `index.ts`
3. Export from `index.ts`
4. Bump `TEMPLATES_VERSION`
5. Update `index.test.ts` manifest assertion

### Running locally
```bash
pnpm install
pnpm --filter @workspace/api-server run dev   # API on :8080
pnpm --filter @workspace/game-forge run dev   # Editor on :5173
```

### Typecheck + Test
```bash
pnpm run typecheck    # All 6 packages
pnpm run test         # 365 tests across 3 packages
```

## Tech Stack Summary (single engine — no Babylon)

| Layer | Tech |
|---|---|
| 3D Engine | **Three.js 0.184** (pnpm catalog + override), **R3F 9**, drei, three-mesh-bvh, three-stdlib |
| Play runtime | `artifacts/player` — same R3F + Rapier + EffectsRig as editor |
| Physics | **Rapier 3D 0.19 only** (no Havok / Babylon physics) |
| Post FX | `@react-three/postprocessing` + `postprocessing` (EffectsRig) |
| AI Pathfinding | Yuka 0.7, recast-navigation 0.43 |
| State | Zustand 5, Immer, Miniplex 2 (ECS), XState 5 |
| AI Worker | Anthropic Claude + Puter + Ollama + CF Workers AI via forge-api |
| UI | Radix UI, Tailwind CSS 4, shadcn/ui, cmdk, Framer Motion |
| Code Editor | Monaco Editor |
| Node Graph | @xyflow/react |
| Backend | Express 5, Drizzle ORM, PostgreSQL (forge-api Railway) |
| Storage | Cloudflare R2 (`assets.grudge-studio.com`) |
| Auth | Puter SDK + server-verified tokens; fleet Grudge ID for studio SSO |
| Desktop | Electron 33, glTF-Transform, AssimpJS |
| Build | Vite 7, **pnpm 10** workspaces, TypeScript 5.9 |
| Test | Vitest, @testing-library/react, happy-dom |

**Hard rule:** one 3D stack. Do not reintroduce `@babylonjs/*` or a second player engine.
