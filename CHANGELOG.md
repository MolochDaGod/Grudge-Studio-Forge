# Changelog

All notable changes to **Grudge GameForge** are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

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

[0.4.0]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.4.0
[0.3.1]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.3.1
[0.3.0]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.3.0
[0.2.0]: https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/tag/v0.2.0
