# Forge edge workers + MCP tooling

## What you should use (MCP)

| MCP server | Use for |
|---|---|
| **cloudflare-builds** | `workers_list`, `workers_get_worker_code`, builds/logs for Workers CI |
| **cloudflare-docs** / **cloudflare-api** | Workers/R2/D1/DNS product questions + OpenAPI search |
| **vercel** | List SPA deployments for `forge` / grudge-studio-forge |
| **github** | PRs, secrets scanning, Actions |
| **wrangler CLI** (local) | `wrangler deploy` — **not** fully covered by MCP write deploy today |

Agents should **probe production** after deploy:

```bash
curl -s https://forge.grudge-studio.com/__edge/health | jq .
curl -s https://forge.grudge-studio.com/api/healthz
curl -sI https://forge.grudge-studio.com/_framework/blazor.boot.json
```

## Production workers (Forge-critical)

| Worker | Role | Status notes |
|---|---|---|
| **grudge-gameforge-web** | `forge.grudge-studio.com/*` → ORIGIN SPA + `/api/*` → API_ORIGIN | Source of truth: `workers/gameforge-web/` |
| **grudge-gameforge-api** | Legacy / alternate API edge (may be stale bundle) | Prefer **web worker `/api` proxy** to Railway |
| **grudge-forge-free-ai** | `/api/free-ai/*` free/BYOK LLM keys | Needs `wrangler secret put GROQ_API_KEY` etc. or client BYOK |
| **grudge-ai-gateway** | Fleet AI | Shared, not Forge-specific |
| **grudge-r2-cdn** / **grudge-asset-cdn** | Asset CDN | `assets.grudge-studio.com` |

## Deploy edge worker

```bash
cd workers/gameforge-web
# Confirm vars match production Vercel + Railway
wrangler deploy
```

Dashboard vars (must stay correct after SPA host changes):

| Var | Example |
|---|---|
| `ORIGIN` | `https://grudge-studio-forge.vercel.app` |
| `API_ORIGIN` | Railway forge-api base (no trailing slash) |
| `ASSETS_ORIGIN` | `https://assets.grudge-studio.com` |

## Hybrid Blazor on the edge

- SPA origin **must** serve latest `public/_framework/*` from `main`.
- Worker sets long-cache + `application/wasm` for `*.wasm`.
- `/__edge/health` reports `probes.blazorBoot` so you can see if WASM is reachable.

## Free AI keys

```bash
cd workers/forge-free-ai
wrangler secret put GROQ_API_KEY
# optional: OPENROUTER_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, …
wrangler deploy
```

If all providers show `"false"` on `/api/free-ai/status`, no server keys are set — BYOK via `X-Api-Key` still works.
