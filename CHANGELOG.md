# Changelog

All notable changes to **Grudge GameForge** are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

## [0.4.4] — 2026-09-06

### Added

- **Pull child meshes** — asset GLBs explode named (and unnamed) meshes into real child entities (`model.subNode` isolate, pack `childrenOnly`). Nested meshes keep parent/child. Each child can move, script, edit, and deploy independently.
- Hierarchy **pack / mesh** badges, parent › child breadcrumb, Inspector + context-menu pull.
- **Super Terrain** worlds from fleet Cloudflare catalog (`info.grudge-studio.com/api/v1/super-terrain.json`).
- Seeded RTS enemy/ally camps with race-kit occupants.
- Editor **G** ground snap, **H** hide/show, **Ctrl+P** unparent; KTX2 decoder bind on the viewport.
- Info catalog: `catalog/forge-editor.json` (also `info.grudge-studio.com/api/v1/forge-editor.json`).

### Changed

- Fast / catalog / drop spawn auto-pulls child meshes (`spawnModelAndPull`, `spawn_fast_asset.pulledMeshes`).
- **F** frames selection only when asked (no auto-frame).
- Player Vite `@workspace/*` aliases for Windows `symlink=false`.
- **Fast nature is Kenney singles only** — Tree / Tropical / Autumn / Icicle **packs** removed from Fast (57 items). Packs still refuse scatter as one tree.

### Kept fused

- Play kits (skinned + ≥8 bones) and map shells (pirate-islands / Chicken Gun plates). Packs over 128 meshes stay fused.

### Deploy

- SPA: prebuilt Vercel `grudge-studio-forge` → https://forge.grudge-studio.com
- Notes: [`RELEASE_NOTES_v0.4.4.md`](./RELEASE_NOTES_v0.4.4.md)

## [0.4.3] — 2026-08-07

### Added

- **Grudge AI Auto** — primary orchestrator path via free-ai → `ai.grudge-studio.com` Legion skills (`dev`, `toolkit`, `warlords`, `convert`, …)
- **Usage modes** in ⚙ Routing: auto | fleet_free | puter_first | byok | offline
- **Legion agent role** selector (sub-agent skill) in settings
- free-ai Worker **1.5.1**: `provider=grudge-ai` proxy, service binding `LEGION` → `grudge-legion-ai`, status `legionBinding` / `guestLegionKey`
- Docs: [`docs/AI_FLEET_ATTACH_SSOT.md`](./docs/AI_FLEET_ATTACH_SSOT.md) step plan + inventory

### Auth / env

- Puter sign-in for FS/KV; Grudge ID JWT for Legion (`getGrudgeBearerToken`)
- free-ai status: fleet Groq + Together live; Legion health probe

## [0.4.2] — 2026-08-04

### Added

- **Forge AI orchestrator** — no model dropdown; best-available provider + automatic failover (fleet Groq/Together → Puter → BYOK → Ollama)
- **Intent chips** — Auto / Scene / Assets / Physics / Script / Fix / Deploy with knowledge packs
- **⚙ Routing user settings** (`aiUserSettings` + `AiRoutingSettings`):
  - Custom **system prompt** (appended every turn; cannot override SI / CDN policy)
  - **Allowed APIs** allowlist for orchestrator failover
  - **Offline only** / **prefer Ollama when running**
  - **Auto-start Ollama** (probe + desktop IPC if available; else `ollama serve` guidance)
  - Ollama URL + **Start / check**
- Docs: [`docs/FORGE_AI_ORCHESTRATOR.md`](./docs/FORGE_AI_ORCHESTRATOR.md)

### Fixed

- **Builtin assets loaded as wireframe “shapes”** — HTML error pages were treated as GLB; builtins resolve via R2 CDN + edge `/builtin` proxy

### Deploy

- SPA: GHA Deploy Forge SPA → Vercel prebuilt → `forge.grudge-studio.com`
- Workers: `grudge-gameforge-web` (builtin→R2), `grudge-forge-free-ai`
- Live: https://forge.grudge-studio.com/editor

## [0.4.1] — 2026-08-04

### Added

- **uMMORPG catalogs in SPA** — `/data/ummorpg-placeables.json` (118 / 111 spawnable), `/data/ummorpg-skills.json` (134), `ummorpgCatalog.ts` helpers + ObjectStore fallback, extract doc for agents
- **`OrbitGizmoArbitration`** — keeps editor pan/zoom free while a selection gizmo is active

### Fixed

- **Selection hard-blocked viewport camera** — drei `TransformControls` set `OrbitControls.enabled = false` for the whole drag and could leave it stuck after remount; pan/zoom always stay on; rotate only suppressed while the gizmo is actively dragging
- **Celestial star / weather `uTime` shader VALIDATE_STATUS** — vertex/fragment precision mismatch (`highp` vs `mediump`) on three r185; both stages use `highp`; star material named `CelestialStars`

### Deploy

- SPA: GHA Deploy Forge SPA → Vercel prebuilt → `forge.grudge-studio.com`
- Workers: `grudge-gameforge-web`, `grudge-forge-free-ai` (wrangler from `workers/*`)
- Live: https://forge.grudge-studio.com/editor

## [0.4.0] — 2026-07-30

### Added

- **Agent edge stack** — free-ai Worker routes for `/api/free-ai`, `/api/catalog`, `/api/agent` with optional D1 `forge-agent` jobs
- **Fast assets catalog** — SPA + edge JSON (`list_fast_assets` / `spawn_fast_asset`)
- **Asset URL policy** — production allowlist (`builtin:`, assets CDN, Poly Haven)
- **Project save/load** — localStorage guest + Puter cloud; hydrated scene payloads on open
- **Editor clipboard** — Ctrl+C / Ctrl+V hierarchy copy/paste
- **Hierarchy frame (F)** — union AABB of selection + children
- **Long-range viewport** — far plane 500k, fog/grid for island maps
- **Smart script templates** — WASD, third-person camera, Mirror-style NetworkManager, remote interpolator, outline, R2 character
- **Fleet AI secrets** — Groq / Together on free-ai Worker; default agent model Groq
- **Docs site** — GitHub Pages (just-the-docs) with deployment + best practices
- **AI skills** — `forge-editor`, `forge-gameplay-scripts`

### Changed

- Production map documented: CF edge → Vercel prebuilt SPA (no Docker SPA)
- Free AI model picker shows fleet keys without mandatory BYOK
- README production/deploy smoke path

### Fixed

- Scene list returned `data: null` so open/load appeared empty (hydrate from Puter FS / localStorage)
- Together model ids updated to serverless Turbo models

### Deploy

- SPA: GHA → Vercel prebuilt → `forge.grudge-studio.com` via `grudge-gameforge-web`
- Workers: `grudge-forge-free-ai`, `grudge-gameforge-web`
- Docs: `https://molochdagod.github.io/Grudge-Studio-Forge/`

## [0.3.1] — 2026-05-29

### Added

- Asset expansion (96+ models, locomotion, weapons)

## [0.3.0] — 2026-05-29

### Added

- Landing page, AI integration, GitHub sync, visual scripting

## [0.2.0] — 2026-05-28

### Added

- Offline AI, asset pipeline, dungeon prefab

[0.4.2]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.4.2
[0.4.1]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.4.1
[0.4.0]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.4.0
[0.3.1]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.3.1
[0.3.0]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.3.0
[0.2.0]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.2.0
