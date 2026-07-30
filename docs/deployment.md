---
layout: default
title: Deployment mechanisms
nav_order: 2
permalink: /deployment/
description: How Grudge Forge reaches production — SPA, Workers, DNS, smoke checks.
---

# Deployment mechanisms

Canonical long form also lives in the repo root [`DEPLOYMENT.md`](https://github.com/MolochDaGod/Grudge-Studio-Forge/blob/main/DEPLOYMENT.md).

## Path: browser → frontend SPA

```
[browser]
    │
    ▼
forge.grudge-studio.com          Cloudflare DNS (proxied)
    │
    ├─ /api/free-ai/*   → Worker grudge-forge-free-ai
    ├─ /api/catalog/*   → same free-ai worker
    ├─ /api/agent/*     → same free-ai worker (+ D1 forge-agent)
    ├─ /api/*           → grudge-gameforge-api / Railway
    └─ /*               → Worker grudge-gameforge-web
                              │
                              ├─ ORIGIN        → Vercel prebuilt SPA
                              │                 (grudge-studio-forge.vercel.app)
                              ├─ ASSETS_ORIGIN → assets.grudge-studio.com (R2)
                              └─ FREE_AI_ORIGIN → free-ai workers.dev (fallback)
```

| Step | Component | Mechanism |
|---|---|---|
| 1 | **GHA Deploy Forge SPA** | On push `main`: install, Vite build (24G swap), Vercel **prebuilt** production upload |
| 2 | **Vercel** | Hosts static SPA only — **not** git auto-build (OOM risk) |
| 3 | **CF Worker web** | `forge.grudge-studio.com/*` proxies static + sets security/cache headers |
| 4 | **CF Worker free-ai** | More-specific routes for free-ai, catalog, agent jobs |
| 5 | **R2 CDN** | GLB/textures at `assets.grudge-studio.com` |

## What deploys where

| Artifact | Trigger | Target |
|---|---|---|
| Editor SPA | GHA `deploy-spa.yml` on `main` | Vercel `grudge-studio-forge` |
| Edge SPA proxy | `wrangler deploy` in `workers/gameforge-web/` | Worker `grudge-gameforge-web` |
| Free AI + catalog + jobs | `wrangler deploy` in `workers/forge-free-ai/` | Worker + optional D1 |
| Desktop NSIS | GHA `release.yml` on `v*` tags | GitHub Release assets |
| **This docs site** | GHA `pages.yml` on `docs/**` | `molochdagod.github.io/Grudge-Studio-Forge/` |

## Stack principles

| Concern | Use | Do not use |
|---|---|---|
| SPA / editor UI | Vercel prebuilt (GHA) | Docker / Railway for SPA |
| Binaries / GLBs | R2 + `builtin:` keys | Replit, localhost, random hosts |
| Agentic LLM | free-ai Worker (fleet secrets + BYOK) | Ad-hoc AI hosts |
| Agent jobs / catalog | free-ai + optional D1 | New storage product |
| Player bag / island | Railway Postgres | Forge D1 |
| Project scenes | Puter KV/FS or localStorage | Mixing with player DB |

## Secrets (never commit)

```bash
cd workers/forge-free-ai
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put TOGETHER_API_KEY
# optional: OPENROUTER_API_KEY, GEMINI_API_KEY, …
```

SPA only embeds **public** URLs (`fleetConfig.ts`). ObjectStore write keys stay server-side.

## Smoke checks (production)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://forge.grudge-studio.com/
curl -sS -o /dev/null -w "%{http_code}\n" https://forge.grudge-studio.com/editor
curl -sS https://forge.grudge-studio.com/__edge/health
curl -sS https://forge.grudge-studio.com/api/catalog/status
curl -sS https://forge.grudge-studio.com/api/free-ai/status
node scripts/smoke-forge-prod.mjs
```

Expect: HTML **200** with title “Grudge Forge”, edge `"ok": true`, catalog + free-ai JSON, SPA JS under `/assets/*.js`.

## Desktop release path

1. Tag `vX.Y.Z` matching intended product version.
2. Push tag → `release.yml` builds Electron NSIS via `game-forge-desktop`.
3. Review draft Release → publish.
4. SPA still ships from `main` independently (do not wait on desktop for web).

See [Releases]({% link releases.md %}).
