# Grudge GameForge

Three.js scene editor, physics, AI-assisted game builder, and hybrid scripting runtime — by [Grudge Studio](https://grudge-studio.com).

| | |
|---|---|
| **Production editor** | [forge.grudge-studio.com](https://forge.grudge-studio.com) |
| **GitHub** | [MolochDaGod/Grudge-Studio-Forge](https://github.com/MolochDaGod/Grudge-Studio-Forge) |
| **Branch** | `main` (auto-deploy SPA + CI) |
| **AI skills** | [`forge-editor`](.agents/skills/forge-editor/SKILL.md) · [`forge-gameplay-scripts`](.agents/skills/forge-gameplay-scripts/SKILL.md) |
| **Hybrid C# docs** | [`docs/HYBRID_CSHARP.md`](./docs/HYBRID_CSHARP.md) |
| **Deploy guide** | [`DEPLOYMENT.md`](./DEPLOYMENT.md) |
| **Docs site (Pages)** | [molochdagod.github.io/Grudge-Studio-Forge](https://molochdagod.github.io/Grudge-Studio-Forge/) |
| **Changelog** | [`CHANGELOG.md`](./CHANGELOG.md) · latest **[v0.4.2](./RELEASE_NOTES_v0.4.2.md)** |
| **Forge AI orchestrator** | [`docs/FORGE_AI_ORCHESTRATOR.md`](./docs/FORGE_AI_ORCHESTRATOR.md) |
| **Edge + MCP** | [`docs/EDGE_AND_MCP.md`](./docs/EDGE_AND_MCP.md) |

## Production status (current)

| Surface | Stack | Deploy |
|---|---|---|
| Editor SPA (`artifacts/game-forge`) | Three **0.185** · R3F · Rapier · Monaco · Blazor WASM | **GHA → Vercel prebuilt** · CF edge `forge.grudge-studio.com` |
| Edge SPA proxy | Worker `grudge-gameforge-web` | `ORIGIN` = Vercel · `ASSETS_ORIGIN` = R2 CDN |
| Free AI + agent catalog | Worker `grudge-forge-free-ai` + optional **D1** `forge-agent` | `/api/free-ai/*` · `/api/catalog/*` · `/api/agent/*` |
| JSON API | Worker `grudge-gameforge-api` / Railway fleet | `/api/*` (storage upload, health) |
| Player (`artifacts/player`) | Same Three + R3F + Rapier as editor | Bundled / published with SPA |
| Desktop | Electron 33 | GitHub Releases |
| Assets CDN | R2 `grudge-assets` + `builtin:` keys | [assets.grudge-studio.com](https://assets.grudge-studio.com) |
| ObjectStore | Fleet catalog / upload API | [objectstore.grudge-studio.com](https://objectstore.grudge-studio.com) |

**Stack principles (agentic editor):** SPA on Vercel (not Docker); binaries on **R2**; agent jobs/catalog on **Workers + optional D1**; player bag/island on **Railway Postgres** (not Forge D1); models only `builtin:` or `assets.grudge-studio.com`.

**Hard rules (production):**

- **One 3D engine:** Three.js + Rapier only (no Babylon / Havok on the play path).
- **`three@0.185.1`** pinned in the pnpm workspace catalog — every scene/game package uses `"three": "catalog:"` (fleet r185).
- **Scripting hybrid:** JS `exports.start/update` for designers; C# live-edit via transpile; production packs via Blazor WASM attach/tick.
- **Asset policy:** no Replit / localhost URLs in saved scenes — see `assetUrlPolicy.ts`.
- **Babylon runtime** is excluded from the workspace (`!lib/babylon-runtime`) so it cannot install by accident.

## Features

- **Visual Scene Editor** — hierarchy, inspector, transform gizmos, asset browser, drag-and-drop
- **Editor hotkeys** — **Ctrl+Z/Y** undo/redo · **Ctrl+C/V** copy/paste hierarchy · **Ctrl+D** duplicate · **F** frame selection **+ children** · **Ctrl+S** save
- **Long-range viewport** — camera far **500 000**, log depth, fog/grid sized for islands & city maps
- **Three.js + R3F** — React Three Fiber, postprocessing (SSAO, bloom, ACES, SMAA)
- **Rapier 3D Physics** — rigid bodies, colliders, joints, raycasting, layer matrix
- **Projects** — create/open/save scenes **local** (browser) or **Puter cloud** when signed in
- **Fast options** — one-click races, maps, VFX, RTS, weapons (`list_fast_assets` / Asset Browser → Fast)
- **Agent edge** — fleet Groq/Together via `/api/free-ai`, Fast catalog, D1 agent jobs
- **Forge AI orchestrator** — no model dropdown; best-available failover + intent chips (Scene / Fix / Deploy / …); knowledge packs
- **⚙ Routing settings** — custom system prompt, allowed APIs allowlist, offline / prefer Ollama, auto-start Ollama + URL check (localStorage)
- **AI providers** — Puter · fleet free-ai (Groq/Together) · BYOK (OpenRouter, Gemini, …) · Ollama offline · optional Anthropic
- **Inline AI** — contextual prompt bar on Console / Assets / Scripts / Prefabs / Nodes / Layers
- **Visual scripting** — @xyflow node graph + AI prompt-to-graph
- **Monaco scripts** — smart templates (WASD, third-person camera, Mirror-style NetworkManager, remotes, outline, R2 character) + Blazor packs
- **Hybrid C#** — see below
- **Asset pipeline** — browser FBX/OBJ/STL→GLB; desktop Assimp; fleet bake via `grudge-convert` → R2
- **Animation library** — Mixamo-pattern catalog · Bip001 / grudge6 bake path
- **RTS / skirmish** — Fort Royale-style modes with units, buildings, economy HUD
- **GitHub project sync** — scenes + scripts as a project tree
- **Scene templates** — deathmatch, RPG village, dungeon interior
- **Builtin + CDN models** — `builtin:` keys resolve to R2 (edge `/builtin` proxy); Fast catalog for agentic spawn — not HTML placeholders
- **R3F player runtime** — same stack as the editor (`artifacts/player`)
- **Recast + Yuka** — navmesh bake and AI agents
- **Puter + Grudge ID** — SSO, cloud FS, publish paths for fleet games

## Hybrid C# scripting (production)

Canonical model — full detail in [`docs/HYBRID_CSHARP.md`](./docs/HYBRID_CSHARP.md):

| Mode | When | Runtime |
|---|---|---|
| **JS** | `language: "js"` | `exports.start` / `exports.update` + `ctx` |
| **C# transpile** | `language: "cs"` without pack headers | Unity-flavoured subset → JS (fast live edit) |
| **C# Blazor packs** | `// @forge-runtime: blazor` + pack/assembly | `GameForgeRuntime.wasm` → `RegisterBuiltin` → **Attach** → **Tick** |

**Built-in production packs** (shipped in `public/_framework/`):

| Pack | Behaviour |
|---|---|
| `Spin` | Y-axis spin |
| `Bob` | Vertical bob |
| `Strafe` | WASD/arrows via C# `Input` + JS `SetKey` bridge |

```csharp
// @forge-runtime: blazor
// @forge-pack: Spin
```

Rebuild WASM after C# host changes:

```bash
bash csharp/GameForgeRuntime/build.sh
# → artifacts/game-forge/public/_framework/
```

If WASM is stale, packs fall back to JS equivalents so play mode still works.

## Tech stack

| Layer | Tech |
|---|---|
| 3D | **Three.js 0.185** (catalog), R3F 9.6, drei, three-mesh-bvh, three-stdlib — see [`docs/3d-dependencies.md`](./docs/3d-dependencies.md) |
| Physics | Rapier 0.19 (`@dimforge/rapier3d` + WASM) + `@react-three/rapier` only |
| Play | `@workspace/player` — R3F + Rapier + EffectsRig |
| Pathfinding | Yuka 0.7, recast-navigation 0.43 |
| Scripting | JS + hybrid C# (transpile / Blazor packs) |
| State | Zustand, Immer, Miniplex, XState |
| AI | Puter · fleet free-ai (Groq/Together) · Ollama · optional Anthropic |
| UI | Radix, Tailwind 4, shadcn, cmdk, Framer Motion |
| Editor | Monaco |
| Graph | @xyflow/react |
| API | Express 5, Drizzle, PostgreSQL |
| Storage | Cloudflare R2 |
| Desktop | Electron 33 |
| Build | Vite 7, **pnpm 10**, TypeScript 5.9 |
| Test | Vitest, Testing Library, happy-dom |

## Local development

```bash
# Prerequisites: Node.js 20+ (24 OK), pnpm 10+
pnpm install

pnpm --filter @workspace/api-server run dev   # API :8080
pnpm --filter @workspace/game-forge run dev   # Editor :5173

# Offline (Ollama + models)
pwsh -File scripts/setup-offline.ps1    # Windows
bash scripts/setup-offline.sh           # Mac/Linux

pnpm run typecheck
pnpm run test
```

## Deployment path (browser → frontend)

How a user hits the **live editor SPA** (verified production path):

```
Browser
  → https://forge.grudge-studio.com          Cloudflare DNS (proxied)
    → Worker grudge-gameforge-web            zone route forge.grudge-studio.com/*
        ├─ /api/free-ai|catalog|agent/*      → grudge-forge-free-ai (more-specific routes)
        ├─ /api/*                            → gameforge-api / Railway
        └─ /*  (HTML, JS, CSS, /editor)      → ORIGIN = Vercel prebuilt SPA
              https://grudge-studio-forge.vercel.app
```

| Step | Check | Expect |
|---|---|---|
| 1. DNS / edge | `GET /__edge/health` | `"ok": true`, `spa.ok`, bindings `ORIGIN` + `ASSETS_ORIGIN` |
| 2. SPA shell | `GET /` and `GET /editor` | **200** HTML, title **Grudge Forge — Game Editor** |
| 3. Origin | Edge probe `spa` | Vercel returns index.html (not 522/5xx) |
| 4. Agent edge | `GET /api/catalog/status` · `/api/free-ai/status` | **200** JSON from free-ai worker |
| 5. Ship | GHA **Deploy Forge SPA** on `main` | Success → Vercel production → next edge fetch |

```bash
# Smoke the path (PowerShell / bash)
curl -sS -o /dev/null -w "%{http_code}\n" https://forge.grudge-studio.com/
curl -sS -o /dev/null -w "%{http_code}\n" https://forge.grudge-studio.com/editor
curl -sS https://forge.grudge-studio.com/__edge/health
curl -sS https://forge.grudge-studio.com/api/catalog/status
curl -sS https://forge.grudge-studio.com/api/free-ai/status
# Optional full smoke:
node scripts/smoke-forge-prod.mjs
```

### Deploy artifacts

| Artifact | How | URL |
|---|---|---|
| Editor SPA | GHA **Deploy Forge SPA** → Vercel prebuilt (`grudge-studio-forge`) | origin `*.vercel.app` |
| Public host | CF Worker **`grudge-gameforge-web`** (`ORIGIN` = Vercel) | https://forge.grudge-studio.com |
| JSON API | CF Worker **`grudge-gameforge-api`** | `forge…/api/*` |
| Free AI + catalog + agent jobs | CF Worker **`grudge-forge-free-ai`** (+ D1 `forge-agent`) | `forge…/api/free-ai/*` · `/api/catalog/*` · `/api/agent/*` |
| Assets | R2 CDN | https://assets.grudge-studio.com |
| Desktop | GHA **Release** on `v*` tags | GitHub Releases |

**Ship rules**

- Push **`main`** → CI + SPA deploy (**prebuilt** only — do not rely on Vercel git auto-build; OOM risk).
- Hybrid C# needs `_framework/` in the SPA dist (verified in GHA).
- Worker secrets (never commit): `GROQ_API_KEY`, `TOGETHER_API_KEY`, … via `wrangler secret put` in `workers/forge-free-ai/`.
- Full guide: [`DEPLOYMENT.md`](./DEPLOYMENT.md) · edge notes: [`docs/EDGE_AND_MCP.md`](./docs/EDGE_AND_MCP.md) · Blazor: [`docs/HYBRID_CSHARP.md`](./docs/HYBRID_CSHARP.md)

## Projects, login, and save/load

| Mode | When | Storage |
|---|---|---|
| **Local** | Guest / no Puter | Browser `localStorage` |
| **Puter cloud** | Signed in (toolbar **Sign in**) | Puter KV index + FS under `Grudge/forge/…` |
| **File → Cloud Save** | Puter session | Snapshot at `Grudge/projects/<id>/scene.json` |

Ctrl+S saves the open scene into the active project. Hierarchy auto-loads the first scene (with hydrated payloads) after open/create.

## Editor hotkeys (production)

| Key | Action |
|---|---|
| **Ctrl+Z** | Undo |
| **Ctrl+Y** / **Ctrl+Shift+Z** | Redo |
| **Ctrl+C** / **Ctrl+V** | Copy / paste entity + hierarchy |
| **Ctrl+D** | Duplicate |
| **F** | Frame selection **including children** |
| **Ctrl+S** | Save scene / prefab |
| **P** | Play / stop |
| **W E R** | Translate / rotate / scale gizmo |

Cheatsheet: press **?** in the editor.

## AI skills for agents

| Skill | Coverage |
|---|---|
| [`forge-editor`](.agents/skills/forge-editor/SKILL.md) | Monorepo, AI tools, hybrid scripts, deploy |
| [`forge-gameplay-scripts`](.agents/skills/forge-gameplay-scripts/SKILL.md) | Hotkeys, framing, multiplayer templates, R2 characters, NetworkManager |
| `animation-and-skinned-meshes` | SkeletonUtils.clone, mixers, crowds, cross-fades |
| `spatial-queries-and-surfaces` | Raycasts, probes, surface tags |
| `threejs-controls` | Orbit / Transform / Map arbitration |
| `threejs-asset-io` | GLTF / FBX / meshopt pipeline |
| `threejs-html-overlays` | CSS2D / drei Html labels |
| `rapier-physics-patterns` | Controllers, joints, heightfields, layers |
| `threejs-positional-audio` | Listener, timing, cones |
| `threejs-volume-rendering` | Volumes, god rays |
| `threejs-tsl` | TSL / WebGPU materials |

**Agent tools (selection):** `list_fast_assets`, `spawn_fast_asset`, `agent_stack_status`, `list_script_templates`, `create_script_from_template`, `list_builtin_models`.

## Part of Grudge Studio

- [grudge-studio.com](https://grudge-studio.com) — platform hub  
- [dash.grudge-studio.com](https://dash.grudge-studio.com) — admin  
- [grudgewarlords.com](https://grudgewarlords.com) — Warlords client  
- [forge.grudge-studio.com](https://forge.grudge-studio.com) — GameForge (this repo)  

---

Created by **Racalvin The Pirate King** at Grudge Studio.
