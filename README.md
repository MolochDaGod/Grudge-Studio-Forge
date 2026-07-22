# Grudge GameForge

Three.js scene editor, physics engine & AI-assisted game builder — by [Grudge Studio](https://grudge-studio.com).

**Web Editor** → [`forge.grudge-studio.com`](https://forge.grudge-studio.com)
**Landing Page** → [`forge.grudge-studio.com`](https://forge.grudge-studio.com) (root `/`)
**GitHub** → [`MolochDaGod/Grudge-Studio-Forge`](https://github.com/MolochDaGod/Grudge-Studio-Forge)
**AI Skill** → [`.agents/skills/forge-editor/SKILL.md`](.agents/skills/forge-editor/SKILL.md)

## Features

- **Visual Scene Editor** — hierarchy panel, property inspector, transform gizmos, asset browser, drag-and-drop
- **Three.js + R3F** — full React Three Fiber pipeline with postprocessing (SSAO, bloom, ACES, SMAA)
- **Rapier 3D Physics** — rigid bodies, colliders, joints, raycasting — all configurable in-editor
- **4 AI Providers** — Claude (server), Puter AI (free, 9 models), Ollama (offline, 4 local models), Cloudflare Workers AI (image/text/vision)
- **Inline AI Assistant** — contextual AI prompt bar in every bottom-panel tab (Console, Assets, Scripts, Prefabs, Nodes, Layers)
- **Visual Scripting** — @xyflow node graph with AI prompt-to-graph generation + drag-and-drop from Assets/Hierarchy
- **Monaco Code Editor** — embedded TypeScript editor for custom scripts and behaviors with 15 built-in templates
- **Asset Pipeline** — browser-side FBX/OBJ/STL→GLB via three-stdlib + fflate ZIP + `@gltf-transform` meshopt; desktop Assimp/glTF-Transform; **fleet production bake** via ObjectStore `grudge-convert` → R2
- **Animation Library** — 22-clip catalog (locomotion, combat, emote, utility) with Mixamo patterns
- **GitHub Project Sync** — push/pull projects to GitHub repos via Git tree API
- **Project Conventions** — UUID v4, PascalCase/camelCase/kebab-case naming, project audit scoring
- **Scene Templates** — 5 built-in starter scenes (3× deathmatch, RPG village, dungeon interior)
- **30+ Builtin Models** — characters, monsters, VFX, maps ready to drag into any scene
- **R3F Player Runtime** — same Three + R3F + Rapier stack as the editor (`artifacts/player`)
- **Hybrid C# packs** — live edit via transpile; production `// @forge-pack: Spin|Bob|Strafe` → Blazor WASM attach/tick
- **Recast Navmesh** — client-side baking with Yuka AI agent pathfinding
- **Puter Auth** — session-less server; Puter SDK client-side with server-verified tokens
- **1-Click Offline Setup** — install Ollama + models + start editor with one command
- **Desktop App** — Electron 33, FBX import, glTF-Transform, auto-updater

## AI System

15-turn tool loop with cooldown at turns 14–15. 15K token response cap. 70+ editor tools.

| Provider | Models | Auth | Offline? |
|---|---|---|---|
| **Anthropic Claude** | Sonnet 4.6, Haiku 4.5 | Server API key | No |
| **Ollama** | qwen2.5-coder:7b, llama3.2, codellama:13b, deepseek-coder-v2:16b | None (local) | **Yes** |
| **Puter AI** | Claude 3.5/3.7, GPT-4o, Gemini 2.0, Llama 3.3, DeepSeek | Client token | No |
| **CF Workers AI** | FLUX, Phoenix, SDXL, Llama 3.1, LLaVA | Server token | No |

## Builtin Assets (30+)

| Category | Assets | Examples |
|---|---|---|
| Characters | 10 | Blake, 6 race rigs, Boss Orc, Distortus Rex, Lava Sancho, Crow |
| VFX | 12 | Fire Hurricane, Explosions A/B, Fire Anim, Freeze, Tornado, Circuits |
| Maps | 8 | Cyberpunk, Encampment, Fort Royale, Desert Town, Chinese Market, Winter Base |
| Props | Rifle, forge-scene (822-mesh dungeon) |

Full manifest: [`public/builtin/asset-manifest.json`](artifacts/game-forge/public/builtin/asset-manifest.json)

## Tech Stack

| Layer | Tech |
|---|---|
| 3D Engine | **Three.js 0.184** (workspace catalog/override), **R3F 9**, drei, three-mesh-bvh, three-stdlib |
| Physics | **Rapier 3D 0.19** (WASM), @react-three/rapier — only physics engine (no Havok/Babylon) |
| Play runtime | `@workspace/player` — R3F + Rapier + EffectsRig (not Babylon) |
| AI Pathfinding | Yuka 0.7, recast-navigation 0.43 (WASM navmesh baking) |
| Scripting | **JS** `start/update` + **hybrid C#** (transpile live / Blazor packs Spin·Bob·Strafe) — see `docs/HYBRID_CSHARP.md` |
| State | Zustand 5, Immer, Miniplex 2 (ECS), XState 5 |
| AI | Anthropic Claude SDK + Puter AI + Ollama + CF Workers AI |
| UI | Radix UI, Tailwind CSS 4, shadcn/ui, cmdk, Framer Motion |
| Code Editor | Monaco Editor (TypeScript / C#) |
| Node Graph | @xyflow/react |
| Backend | Express 5, Drizzle ORM, PostgreSQL, Pino logger |
| Storage | Cloudflare R2 (native S3 via @aws-sdk/client-s3) |
| Auth | Puter SDK (client) + server-to-server whoami verification |
| Desktop | Electron 33, electron-builder, glTF-Transform, AssimpJS |
| Build | Vite 7, pnpm 10 workspaces, esbuild, TypeScript 5.9 |
| Test | Vitest, @testing-library/react, happy-dom |

## Local Development

```bash
# Prerequisites: Node.js 24+, pnpm 10+
pnpm install

# Run editor + API server
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/game-forge run dev

# 1-click offline (installs Ollama + models + starts everything)
pwsh -File scripts/setup-offline.ps1    # Windows
bash scripts/setup-offline.sh           # Mac/Linux

# Typecheck + test
pnpm run typecheck    # All 6 packages
pnpm run test         # 365 tests
```

## Deployment

| Artifact | Target | URL |
|---|---|---|
| game-forge (SPA) | Vercel | `forge.grudge-studio.com` |
| game-forge-desktop | GitHub Releases | `.exe` installer |

**Backend**: Puter KV + FS (user-pays, $0 infra cost). No api-server or database needed.
**AI**: Puter AI (9 free models, client-side) + Ollama (offline, local).
**Builtin assets**: Static R2 CDN at `assets.grudge-studio.com`.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full deployment guide including offline/online/hybrid modes.

## AI Skill for Developers

The project includes a comprehensive AI skill at [`.agents/skills/forge-editor/SKILL.md`](.agents/skills/forge-editor/SKILL.md) that gives any AI agent working on this codebase instant knowledge of:

- Full monorepo structure (9 lib + 5 artifact packages)
- Every key file path and its purpose
- AI system architecture (providers, tool loop, cooldown)
- Script API shape (`exports.start/update`, `ctx.scene/events/state`)
- How to add new tools, templates, models, and scripts
- Deployment stack and environment variables
- Tech stack reference

Alongside it ships a catalog of focused 3D / engine skills under [`.agents/skills/`](.agents/skills/):

| Skill | Coverage |
|---|---|
| `animation-and-skinned-meshes` | SkeletonUtils.clone, mixer / actions, shared-skeleton crowds, cross-fades |
| `spatial-queries-and-surfaces` | Raycasts, shape casts, 8-dir probe fan, surface tagging |
| `threejs-controls` | Transform / Orbit / Map / Fly / Drag arbitration |
| `threejs-asset-io` | GLTF / FBX / OBJ / STL, meshopt vs Draco vs KTX2, the canonical pipeline |
| `threejs-html-overlays` | CSS2DRenderer + drei `<Html />` for labels, sector pins, damage numbers |
| `rapier-physics-patterns` | Kinematic controller, joints, instancing, heightfields — mapped to our 10 layers |
| `threejs-positional-audio` | Listener-on-camera, perfect-timing, directional cones, FFT visualizers |
| `threejs-volume-rendering` | `Data3DTexture` + `RaymarchingBox` (clouds) + `VolumeNodeMaterial` (god rays) |
| `threejs-tsl` | TSL fundamentals, VFX (tornado / flames), GLSL→TSL transpiler workflow |

## Part of Grudge Studio

- **[grudge-studio.com](https://grudge-studio.com)** — Platform hub
- **[dash.grudge-studio.com](https://dash.grudge-studio.com)** — Admin dashboard
- **[grudgewarlords.com](https://grudgewarlords.com)** — Grudge Warlords game client
- **[forge.grudge-studio.com](https://forge.grudge-studio.com)** — GameForge editor (this project)

---

Created by **Racalvin The Pirate King** at Grudge Studio.
