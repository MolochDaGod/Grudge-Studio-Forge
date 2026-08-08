---
layout: default
title: AI Fleet Attach SSOT
nav_order: 14
---

# AI Fleet Attach SSOT — Legion + Forge

**One brain, one Forge edge.** Do not invent a second public AI domain.

| Host | Role |
|------|------|
| **https://ai.grudge-studio.com** | **Brain** — models, agent skills, Workers AI, Gemini BYOK, JWT |
| **https://forge.grudge-studio.com/api/free-ai/** | **Hands** — same-origin proxy, catalog, agent jobs |
| **Forge SPA** | **Face** — Puter + Grudge ID, Auto orchestrator, scene tools |

Related: [FORGE_AI_ORCHESTRATOR.md](./FORGE_AI_ORCHESTRATOR.md) · [DEPLOYMENT.md](../DEPLOYMENT.md) · Legion repo `F:\GitHub\grudge-ai-hub`

---

## Step plan (execute in order)

| Step | Goal | Done when |
|------|------|-----------|
| **1** | This doc + READMEs | Agents/humans share one map |
| **2** | free-ai → Legion service binding + secrets docs | Status shows `legionBinding` / lower latency path |
| **3** | Secrets: Legion GROQ, free-ai `GRUDGE_AI_KEY` | Health `groq` configured; guest Legion works |
| **4** | Deploy Forge SPA | Editor Auto + Usage modes live on forge.grudge-studio.com |
| **5** | Agent jobs → Legion roles | Real sub-agent job kinds (not stubs only) |
| **6** | Optional Vectorize / queue | Knowledge RAG + long tools off request path |

---

## Workers inventory

### Legion (`ai.grudge-studio.com`)

| Worker | Config | Owns |
|--------|--------|------|
| `grudge-ai-hub` | `wrangler.domain.toml` | Custom domain, UI proxy → grudaagent |
| `grudge-legion-ai` | `wrangler.toml` | `/v1/*`, `/health`, `/api/health` |

**Bindings:** `AI` (Workers AI), D1 `grudge-ai-hub`, KV, queue consumer `grudge-ai-events` (domain).

**Secrets (wrangler secret put — never commit):**

| Secret | Workers | Purpose |
|--------|---------|---------|
| `GEMINI_API_KEY` | both | BYOK primary |
| `JWT_SECRET` | both | Grudge ID JWT verify |
| `GROQ_API_KEY` | both | Free mid waterfall (often still missing) |
| `WORKERS_AI_USER_TOKEN` | optional | REST fallback only |
| `OBSERVATORY_KEY` | optional | Telemetry |

**Public routes:** `/health`, `/v1/agents`, `/v1/models`, `/v1/ssot`, `/v1/skills`, `POST /v1/chat`, `POST /v1/agents/:role/chat`

### Forge edge

| Worker | Routes |
|--------|--------|
| `grudge-forge-free-ai` | `/api/free-ai/*`, `/api/catalog/*`, `/api/agent/*` |
| `grudge-gameforge-api` | remaining `/api/*` |
| `grudge-gameforge-web` | SPA shell + health |

**free-ai secrets:**

| Secret | Purpose |
|--------|---------|
| `GROQ_API_KEY` | Fleet chat (live configured) |
| `TOGETHER_API_KEY` | Fleet chat (live configured) |
| `GRUDGE_AI_KEY` | Guest Legion without user JWT (optional) |
| `GEMINI_API_KEY` / OpenRouter / … | Optional fleet BYOK |

---

## LLM waterfall (do not reorder without reason)

### Legion (brain)

1. Gemini BYOK  
2. Groq (if secret)  
3. Workers AI binding: strong → fast  
4. Workers AI REST (optional token)  

### Forge orchestrator (face → hands → brain)

1. **grudge-ai** (Legion proxy)  
2. Fleet Groq / Together on free-ai  
3. Puter user-pays (signed in)  
4. Browser BYOK keys  
5. Ollama local  

---

## Auth planes

| Plane | Auth | Used for |
|-------|------|----------|
| Grudge ID | JWT | Legion chat, Railway bag |
| Puter | Puter session | Forge project FS/KV (User-Pays) |
| free-ai BYOK | `X-Api-Key` | Optional personal Groq/etc. |
| free-ai guest Legion | `GRUDGE_AI_KEY` server secret | Optional shared key |

**Never:** Puter as bag/wallet SSOT · AI secrets in SPA `VITE_*`.

---

## Smoke matrix

```bash
# Legion
curl -s https://ai.grudge-studio.com/health
curl -s https://ai.grudge-studio.com/v1/skills | head -c 200

# Forge free-ai
curl -s https://forge.grudge-studio.com/api/free-ai/status
curl -s https://forge.grudge-studio.com/api/catalog/status

# Expect free-ai JSON fields:
#   grudgeAi: true, legion: true, legionVersion: "1.5.x"
#   providers.groq: true, providers.together: true, providers["grudge-ai"]: true
```

---

## Deploy commands

```bash
# Legion (both workers)
cd F:\GitHub\grudge-ai-hub
npm run deploy

# Forge free-ai edge
cd F:\GitHub\Grudge-Studio-Forge\workers\forge-free-ai
npx wrangler deploy

# Forge SPA (editor UI)
cd F:\GitHub\Grudge-Studio-Forge
pnpm deploy:forge
```

---

## Anti-patterns

| Bad | Good |
|-----|------|
| New `forge-ai.grudge-studio.com` hub | free-ai → Legion |
| Client-only production keys | free-ai / Legion secrets |
| Dual Workers AI stacks on Forge + Legion | Workers AI only on Legion |
| Meshy/capsule as default agent mesh | R2 CDN + catalog tools |

---

## Next step after this doc

**Step 2:** Service binding `LEGION` on free-ai → `grudge-legion-ai` — **done (1.5.1)**.  
**Account / Puter:** [ACCOUNT_PUTER_ENGINE_SSOT.md](./ACCOUNT_PUTER_ENGINE_SSOT.md).  
**Checklist:** [AI_ATTACH_CHECKLIST.md](./AI_ATTACH_CHECKLIST.md).
