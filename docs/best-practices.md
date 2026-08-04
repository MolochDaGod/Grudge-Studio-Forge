---
layout: default
title: Best practices
nav_order: 3
permalink: /best-practices/
description: Production best practices for Forge editor, assets, agents, and scripts.
---

# Best practices

## Engine

- **Three.js + Rapier only** on the play path (no Babylon / Havok).
- **`three@0.184`** via pnpm catalog — all packages use `"three": "catalog:"`.
- SI units (1.8 m human yardstick); log depth buffer for large maps.
- Command stack for all hierarchy edits (undo/redo).

## Assets & CDN

- Prefer **`builtin:<key>`** or `https://assets.grudge-studio.com/…`.
- Agent tools: `list_fast_assets` → `spawn_fast_asset` before inventing URLs.
- Reject Replit, localhost, bare `blob:` in persisted scene JSON (`assetUrlPolicy.ts`).
- Production bake: `grudge-asset-convert` → R2; in-editor convert is convenience only.

## Projects & identity

| Mode | Storage |
|---|---|
| Guest | Browser `localStorage` |
| Puter signed-in | Puter KV + FS under `Grudge/forge/…` |
| Cloud Save menu | Snapshot `Grudge/projects/<id>/scene.json` |

Auth: **Grudge ID** + Puter for cloud FS/publish. Player bag/wallet stay on Railway.

## Editor UX

| Key | Action |
|---|---|
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+C / Ctrl+V | Copy / paste hierarchy |
| Ctrl+D | Duplicate |
| **F** | Frame selection **+ children** |
| Ctrl+S | Save scene |
| P | Play / stop |

Viewport: far plane ~500 000, fog defaults for islands, infinite grid with long fade.

## Agentic AI

- **Orchestrator (no model dropdown):** best-available provider + failover — see [Forge AI Orchestrator]({% link FORGE_AI_ORCHESTRATOR.md %}).
- Default fleet model: **Groq** via `/api/free-ai` (server secrets + optional BYOK in ⚙ Routing).
- Edge catalog: `/api/catalog/fast-assets` (embedded fallback on free-ai Worker).
- Jobs: `/api/agent/jobs` with D1 `forge-agent` when bound.
- Tools: Fast assets, stack status, script templates — see `forge-gameplay-scripts` skill.
- Intent chips: Auto / Scene / Assets / Physics / Script / Fix / Deploy.

## Scripts

- JS: `exports.start` / `exports.update` + `ctx`.
- Smart templates: WASD, third-person camera, Mirror-style NetworkManager, remote interp, R2 character hook.
- C#: live transpile or Blazor packs (`@forge-runtime: blazor`) — [Hybrid C#]({% link HYBRID_CSHARP.md %}).

## CI / shipping

- SPA: **prebuilt** GHA only (not Vercel git build).
- Do not force-push `main` or rewrite published release tags.
- Smoke forge after every SPA deploy before announcing.

## References

- [three.js editor parity]({% link THREEJS_EDITOR_PARITY.md %})
- [Puter patterns]({% link PUTER_PATTERNS.md %})
- [Edge & MCP]({% link EDGE_AND_MCP.md %})
