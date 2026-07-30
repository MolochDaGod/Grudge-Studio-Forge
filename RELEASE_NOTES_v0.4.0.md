## v0.4.0 — Agentic edge, projects, scripts & docs

**Live editor:** https://forge.grudge-studio.com/editor  
**Docs:** https://molochdagod.github.io/Grudge-Studio-Forge/  
**Changelog:** [CHANGELOG.md](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/CHANGELOG.md)

### Highlights

- Cloudflare edge agent stack: free-ai + Fast catalog + D1 jobs on `forge.grudge-studio.com`
- Puter / local project save-load with hydrated scene payloads
- Editor Ctrl+C/V hierarchy, improved **F** frame, long-range viewport
- Smart gameplay scripts (WASD, third-person, NetworkManager, remotes)
- GitHub Pages docs: deployment mechanisms + best practices

### Added

- Agent edge: `/api/free-ai/*`, `/api/catalog/*`, `/api/agent/*` (Worker + optional D1 `forge-agent`)
- Fast assets catalog for SPA + agents (`list_fast_assets` / `spawn_fast_asset`)
- Asset URL policy (`builtin:` + R2 CDN only in scenes)
- Fleet Groq / Together secrets on free-ai Worker
- Scripts tab smart templates (multiplayer / camera / R2 character)
- `forge-gameplay-scripts` AI skill
- Docs site (just-the-docs) via Actions Pages workflow

### Changed

- Production deploy path documented: **GHA prebuilt → Vercel → CF Worker**
- Default agent model prefers fleet Groq
- Fog/camera defaults for island-scale maps

### Fixed

- Scene open/load empty data (index rows hydrated from FS / localStorage)
- Together serverless model IDs

### Deploy mechanisms

| Path | Mechanism |
|---|---|
| SPA | GHA Deploy Forge SPA → Vercel prebuilt → `grudge-gameforge-web` |
| Agent API | `grudge-forge-free-ai` routes on forge domain |
| Assets | R2 `assets.grudge-studio.com` |
| Docs | GHA `pages.yml` → GitHub Pages |
| Desktop | GHA `release.yml` on `v*` tags (NSIS when build succeeds) |

```bash
curl -sS https://forge.grudge-studio.com/__edge/health
curl -sS https://forge.grudge-studio.com/api/catalog/status
curl -sS https://forge.grudge-studio.com/api/free-ai/status
```
