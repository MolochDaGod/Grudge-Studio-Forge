# Deployment

How **Grudge Forge** reaches production. Read before changing Dockerfile, CI,
workers, DNS, or the SPA build.

**Related:** [`docs/EDGE_AND_MCP.md`](./docs/EDGE_AND_MCP.md) · [`docs/HYBRID_CSHARP.md`](./docs/HYBRID_CSHARP.md) · [README](./README.md)

---

## Production map (current)

```
[browser]
    │
    ▼
forge.grudge-studio.com          Cloudflare DNS (proxied)
    │
    ├─ /api/*           → Worker grudge-gameforge-api   (Forge JSON API)
    ├─ /api/free-ai/*   → Worker grudge-forge-free-ai   (BYOK / free LLM proxy)
    └─ /*               → Worker grudge-gameforge-web
                              │
                              ├─ ORIGIN        → https://grudge-studio-forge.vercel.app  (SPA)
                              ├─ ASSETS_ORIGIN → https://assets.grudge-studio.com        (R2)
                              └─ API_ORIGIN    → optional Railway fleet API (not Forge DB)
```

| Surface | Component | URL / host |
| --- | --- | --- |
| Public editor | CF edge + Vercel SPA | https://forge.grudge-studio.com |
| SPA origin | Vercel project `grudge-studio-forge` | https://grudge-studio-forge.vercel.app |
| Forge JSON API | CF Worker `grudge-gameforge-api` | `forge…/api/*` (also `*.workers.dev`) |
| Free AI | CF Worker `grudge-forge-free-ai` | `forge…/api/free-ai/*` |
| Edge health | CF Worker `grudge-gameforge-web` | `GET /__edge/health` |
| Builtin / CDN | R2 | https://assets.grudge-studio.com |
| Desktop | GitHub Releases | NSIS `.exe` on `v*` tags |
| Legacy Express | Railway Docker (optional) | Health: `GET /api/healthz` |

> **Replit is deprecated.** Do not use `grudge-studio-forge.replit.app`.

---

## What deploys where

| Artifact | How it ships | Target |
| --- | --- | --- |
| `artifacts/game-forge` SPA | **GitHub Actions** `Deploy Forge SPA` → prebuilt upload | Vercel `grudge-studio-forge` |
| Edge SPA proxy | `wrangler deploy` in `workers/gameforge-web/` | Worker `grudge-gameforge-web` |
| Free AI proxy | `wrangler deploy` in `workers/forge-free-ai/` | Worker `grudge-forge-free-ai` |
| Forge API | Separate CF Worker (Hono) | Worker `grudge-gameforge-api` |
| Express `api-server` | Docker / Railway (optional fleet path) | Railway + health `/api/healthz` |
| Desktop | `release.yml` on `v*` tags | GitHub Releases |
| Builtins / maps | ObjectStore / R2 bake | `assets.grudge-studio.com` |

**Do not** rely on Vercel’s git auto-build for the full SPA (8 GB builders OOM). Production uses **prebuilt** deploy from GHA.

---

## SPA deploy (authoritative)

### GitHub Actions

Workflow: [`.github/workflows/deploy-spa.yml`](./.github/workflows/deploy-spa.yml)

| Step | Detail |
| --- | --- |
| Trigger | Push to `main`, or `workflow_dispatch` |
| Runner | `ubuntu-latest` + **24G swap** + Node **12G** heap |
| Install | `pnpm install --filter "@workspace/game-forge..."` |
| Build | `pnpm --filter @workspace/game-forge exec vite build` |
| Verify | `index.html`, `vercel.json`, **`_framework/blazor.boot.json`**, **`GameForgeRuntime.wasm`** |
| Deploy | `vercel deploy` of `artifacts/game-forge/dist/public` → production |
| Secrets | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |

### Hybrid Blazor must ship in the SPA

`public/_framework/` (GameForgeRuntime WASM + boot json) is copied by Vite into
`dist/public/_framework/`. Without it, hybrid C# packs fall back to JS.

After a green deploy, hashes should match:

```bash
curl -s https://forge.grudge-studio.com/_framework/blazor.boot.json | jq -r .resources.hash
# compare to artifacts/game-forge/public/_framework/blazor.boot.json
```

Rebuild WASM after C# host changes:

```bash
bash csharp/GameForgeRuntime/build.sh
# → artifacts/game-forge/public/_framework/
git add artifacts/game-forge/public/_framework
```

### Local prebuilt deploy

```bash
pnpm install
pnpm --filter @workspace/game-forge exec vite build --config vite.config.ts
# dist: artifacts/game-forge/dist/public
# Then vercel deploy that folder with project secrets (see GHA job)
```

High-RAM VPS path (optional): `scripts/build-spa.sh` + `scripts/deploy-spa-vps.sh`
and set Worker `ORIGIN` to the VPS origin host.

### Vercel project settings (prebuilt / manual)

| Setting | Value |
| --- | --- |
| Project | `grudge-studio-forge` |
| Output | `artifacts/game-forge/dist/public` |
| Framework | Other |
| Node | 24.x |
| Custom domain on Vercel | **Optional** — prefer CF Worker + `ORIGIN` |

SPA routing + cache: `artifacts/game-forge/public/vercel.json` (rewrites SPA;
long-cache `assets/*` and `_framework/*.wasm`).

---

## Cloudflare edge workers

### `grudge-gameforge-web` (SPA + health)

Source: [`workers/gameforge-web/`](./workers/gameforge-web/)

```bash
cd workers/gameforge-web
wrangler deploy
```

| Binding | Production value |
| --- | --- |
| `ORIGIN` | `https://grudge-studio-forge.vercel.app` |
| `FORGE_API_ORIGIN` | `https://grudge-gameforge-api.grudge.workers.dev` (health probes) |
| `API_ORIGIN` | Optional Railway fleet API (may be a **different** service) |
| `ASSETS_ORIGIN` | `https://assets.grudge-studio.com` |

Routes (Cloudflare):

| Pattern | Worker |
| --- | --- |
| `forge.grudge-studio.com/api/*` | `grudge-gameforge-api` |
| `forge.grudge-studio.com/*` | `grudge-gameforge-web` |

**Never self-fetch** `forge.grudge-studio.com/api/*` from the web worker
(causes CF **522** loops). Health probes use `FORGE_API_ORIGIN`.

### Edge probes

```bash
curl -s https://forge.grudge-studio.com/__edge/health | jq .
# expect: ok=true, probes.spa, probes.forgeApi, probes.blazorBoot

curl -s https://forge.grudge-studio.com/api/healthz
# expect: {"status":"ok"}

curl -sI https://forge.grudge-studio.com/_framework/GameForgeRuntime.wasm
# expect: content-type application/wasm
```

### `grudge-forge-free-ai`

Source: [`workers/forge-free-ai/`](./workers/forge-free-ai/)

```bash
cd workers/forge-free-ai
wrangler secret put GROQ_API_KEY          # optional shared free key
# OPENROUTER_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, …
wrangler deploy
```

If `/api/free-ai/status` shows all providers `false`, only **BYOK** (`X-Api-Key`) works.

### MCP tools for deploy ops

| MCP / tool | Use |
| --- | --- |
| **cloudflare-builds** | List workers, pull live code, CI builds |
| **wrangler CLI** | Deploy workers (`workers write` OAuth) |
| **github** / `gh` | Actions, SPA deploy logs |
| **vercel** MCP | Project / deployment inspection |

Full notes: [`docs/EDGE_AND_MCP.md`](./docs/EDGE_AND_MCP.md).

---

## Production smoke

```bash
node scripts/smoke-forge-prod.mjs
# or: FORGE_BASE=https://grudge-studio-forge.vercel.app node scripts/smoke-forge-prod.mjs
```

Checks: SPA shell, `/editor` rewrite, free-ai status, projects, templates, R2
builtin, **`/__edge/health`**, **`/api/healthz`**, **blazor.boot.json**, WASM HEAD.

GitHub Action **Smoke Forge Production** runs after a successful **Deploy Forge SPA**.

---

## API — Forge worker vs Express / Railway

| Path | Implementation | Notes |
| --- | --- | --- |
| Production `forge…/api/*` | **CF Worker** `grudge-gameforge-api` | Primary; projects/scripts/templates |
| Express `artifacts/api-server` | Docker on Railway (optional) | Health: `/api/healthz` and `/api/health` |
| Fleet `grudge-api-production-…` | Separate Railway service | **Not** the same as Forge scene DB |

Express health (for Railway / docker):

| Setting | Value |
| --- | --- |
| Dockerfile | repo root `Dockerfile` |
| Health check | `GET /api/healthz` → `{"status":"ok"}` |
| Env | `PORT`, `DATABASE_URL`, R2 keys (see below) |

**Required env (Express):**

| Variable | Purpose |
| --- | --- |
| `PORT` | Injected by Railway |
| `DATABASE_URL` | Postgres |
| `CF_ACCOUNT_ID` | R2 |
| `OBJECT_STORAGE_KEY` / `OBJECT_STORAGE_SECRET` | R2 S3 API |
| `R2_BUCKET_ASSETS` | e.g. `grudge-assets` |

Optional: `ANTHROPIC_API_KEY`, `CF_AI_API_TOKEN`, D1 / GitHub tokens for AI knowledge routes.

---

## DNS (Cloudflare)

| Record | Type | Target | Proxy |
| --- | --- | --- | --- |
| `forge` | Worker route / CNAME | **Worker** owns host (not bare Vercel CNAME while edge is on) | Yes |
| `assets` | R2 custom domain | CDN | Yes |

While `grudge-gameforge-web` owns `forge.grudge-studio.com/*`, set SPA host as
Worker **`ORIGIN`**, do not attach `forge` directly to Vercel unless you remove the worker.

---

## Object storage (R2)

Templates, AI snapshots, navmesh, uploads → bucket **`grudge-assets`**.
Public CDN: `https://assets.grudge-studio.com`.

SPA **does not** ship `public/builtin` GLBs (stripped at build); runtime loads from R2.

---

## CI — GitHub Actions

| Workflow | When | What |
| --- | --- | --- |
| **CI** | push/PR `main` | typecheck, test, optional migrate dry-run |
| **Deploy Forge SPA** | push `main` | build + Vercel prebuilt production |
| **Smoke Forge Production** | after SPA success / schedule | `scripts/smoke-forge-prod.mjs` |
| **Release** | `v*` tags | Windows desktop NSIS + draft GitHub Release |
| **Deploy static content to Pages** | push `main` | secondary static host (if enabled) |

---

## DB migrations (Express / shared Postgres)

Forge tables (`forge_*`) share Grudge Postgres. Migrations are idempotent and run
on api-server boot. Prefer guarded `ALTER … IF NOT EXISTS` in
`lib/db/src/migrate.ts` — do not `drizzle-kit push` against the shared DB.

Dry-run: `pnpm --filter @workspace/db run migrate:dryrun -- --seed`

---

## Offline mode

```powershell
pwsh -File scripts/setup-offline.ps1   # Windows
bash scripts/setup-offline.sh          # macOS / Linux
```

Ollama models hit `localhost:11434` from the editor (no server proxy).

| Mode | AI | Storage | Backend |
| --- | --- | --- | --- |
| Offline | Ollama | Local | Local Express / Puter guest |
| Online | Claude + Puter + free-ai | R2 | CF Workers + Vercel SPA |
| Hybrid | Ollama + cloud AI | R2 | Local + cloud |

---

## Quick checklist (ship to production)

1. [ ] `main` green **CI**
2. [ ] **Deploy Forge SPA** green (dist includes `_framework`)
3. [ ] `curl` `/__edge/health` → `ok: true`
4. [ ] `node scripts/smoke-forge-prod.mjs` → all pass
5. [ ] Blazor boot hash matches hybrid rebuild (if C# packs changed)
6. [ ] Free-ai secrets set if shared keys required
7. [ ] Desktop: tag `vX.Y.Z` only when cutting a release

---

## Healthy signals

```text
GET /__edge/health     → {"ok":true,"service":"grudge-gameforge-web",…}
GET /api/healthz       → {"status":"ok"}
GET /api/projects      → JSON array
GET /api/free-ai/status→ {"ok":true,"byok":true,…}
GET /_framework/blazor.boot.json → mainAssemblyName GameForgeRuntime
```
