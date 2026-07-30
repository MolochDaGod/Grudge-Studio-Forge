---
layout: default
title: Home
nav_order: 1
description: Grudge GameForge documentation — deploy path, best practices, edge stack.
permalink: /
---

# Grudge GameForge Docs

Browser **Three.js / R3F / Rapier** scene editor with agentic AI, Puter projects, and fleet R2 assets.

| | |
|---|---|
| **Live editor** | [forge.grudge-studio.com](https://forge.grudge-studio.com/editor) |
| **Source** | [MolochDaGod/Grudge-Studio-Forge](https://github.com/MolochDaGod/Grudge-Studio-Forge) |
| **Releases** | [GitHub Releases](https://github.com/MolochDaGod/Grudge-Studio-Forge/releases) |
| **Repo README** | [README.md](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/README.md) |

[Open editor](https://forge.grudge-studio.com/editor){: .btn .btn-primary }
[Latest release](https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/latest){: .btn }
[Deployment mechanisms]({% link deployment.md %}){: .btn }

## Documentation map

| Page | Purpose |
|---|---|
| [Deployment mechanisms]({% link deployment.md %}) | DNS → Workers → Vercel SPA, GHA, smoke checks |
| [Best practices]({% link best-practices.md %}) | Engine, assets, agent, projects, hotkeys |
| [Releases]({% link releases.md %}) | Semver, tags, desktop + SPA ship process |
| [Edge & MCP]({% link EDGE_AND_MCP.md %}) | CF edge, MCP, workers |
| [Hybrid C#]({% link HYBRID_CSHARP.md %}) | JS / transpile / Blazor packs |
| [three.js editor parity]({% link THREEJS_EDITOR_PARITY.md %}) | Commands, hierarchy, loaders |
| [Puter patterns]({% link PUTER_PATTERNS.md %}) | Auth, cloud FS, publish |
| [Game deploy defs]({% link GAME_DEPLOYMENT_DEFINITIONS.md %}) | Fleet game surfaces |

## Production path (one glance)

```
Browser → forge.grudge-studio.com (Cloudflare)
       → grudge-gameforge-web (Worker)
            ├─ /api/free-ai|catalog|agent/* → free-ai Worker (+ D1)
            ├─ /api/*                       → API Worker / Railway
            └─ /*  SPA HTML/JS/CSS          → Vercel prebuilt ORIGIN
```

Full detail: [Deployment mechanisms]({% link deployment.md %}).

## Agent skills (in-repo)

- [`.agents/skills/forge-editor/SKILL.md`](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/.agents/skills/forge-editor/SKILL.md)
- [`.agents/skills/forge-gameplay-scripts/SKILL.md`](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/.agents/skills/forge-gameplay-scripts/SKILL.md)
