---
layout: default
title: Project storage & AI planes
nav_order: 16
---

# Project storage & AI environments (Forge)

**Audience:** agents, ops, Grudge cloud users  
**Code:** `src/lib/cloud/projectStorage.ts` · `puterDataProvider.ts` · `forgeEnv.ts` · `workers/forge-free-ai`

## User planes

| User | Project storage | AI | Notes |
|------|-----------------|-----|--------|
| **Guest** (Continue without sign-in) | localStorage indexes + **IndexedDB** scene payloads | Ollama / free-ai BYOK / edge free models | Offline capable; quota → IDB |
| **Puter signed-in** (Grudge cloud) | Puter **KV** indexes + **FS** `Grudge/forge/<col>/<id>.json` | Puter AI + free-ai + optional Anthropic | Cloud Save, publish L7 |
| **Grudge ID only** | Same as guest until Puter linked | Same as guest | SSO identity ≠ Puter FS |

## What lives where (never mix)

| Data | Authority |
|------|-----------|
| Editor projects / scenes / scripts | local **or** Puter (above) |
| Agent jobs | free-ai Worker **D1** `forge-agent` |
| Fast catalog / fleet search | free-ai `/api/catalog/*` |
| Binary meshes | R2 `assets.grudge-studio.com` |
| Weapon/class JSON | ObjectStore |
| Player bag / XP | **Railway** Postgres — not Forge |

## AI stack

| Layer | Endpoint / package | Role |
|-------|-------------------|------|
| Free edge proxy | `/api/free-ai/chat?provider=` | Groq, OpenRouter, Gemini, … (BYOK or secrets) |
| Catalog | `/api/catalog/*` | Fast assets, fleet D1 search, gamedata |
| Agent jobs | `/api/agent/jobs` | Durable generate/bake hints |
| Knowledge brain | `/api/knowledge/*` | Docs, D1 research (read-only) |
| Client providers | `lib/ai/providers/*` | Puter, Ollama, free, Anthropic |
| Tools | `project_storage_status`, `migrate_local_projects_to_puter`, `agent_stack_status` | Diagnose + migrate |

## Migrate local → Puter

After sign-in:

1. AI: `project_storage_status` → see local project count  
2. AI: `migrate_local_projects_to_puter`  
3. Or Cloud Save / normal CRUD (new work writes Puter immediately)

Local copy is **kept** (safe dual-write).

## Node / monorepo (Windows exFAT)

D: exFAT cannot symlink. Use:

```ini
# .npmrc
node-linker=hoisted
symlink=false
store-dir=C:\Users\<you>\AppData\Local\pnpm-store
```

Vite + tsconfig resolve `@workspace/*` via **path aliases** (not node_modules links):

- `@workspace/scene-schema` → `lib/scene-schema/src`
- `@workspace/api-client-react` → Puter `dataLayer.ts`
- etc.

## Deploy free-ai worker

```bash
cd workers/forge-free-ai
# secrets: GROQ_API_KEY, …
npx wrangler deploy
```

Routes on `forge.grudge-studio.com`: `/api/free-ai/*`, `/api/catalog/*`, `/api/agent/*`.
