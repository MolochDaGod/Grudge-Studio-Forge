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
| **Puter signed-in** (Grudge cloud) | Puter **KV** indexes + **FS** `Grudge/forge/<col>/<id>.json` | Fleet AI **GBux** · BYOK · Puter · Ollama | Cloud Save, publish L7 |
| **Grudge ID only** | Same as guest until Puter linked | Same as guest | SSO identity ≠ Puter FS |
| **GrudgeOS** ([puter-monitor-ai](https://puter-monitor-ai.vercel.app)) | Same Puter plane — OS **Forge** app lists KV `grudge:forge:projects:index` | OS Puter AI + fleet AI hub | Deep link `/editor?project=<id>&from=grudgeos` |

### GrudgeOS wiring SSOT

| Piece | Value |
|-------|--------|
| OS shell | `https://puter-monitor-ai.vercel.app` |
| Bridge lib | PuterGrudge `public/grudgeos/lib/forge-cloud-bridge.js` |
| KV index | `grudge:forge:projects:index` |
| FS root | `Grudge/forge/` |
| Open project | `https://forge.grudge-studio.com/editor?project=<id>&edit=1&from=grudgeos` |

## What lives where (never mix)

| Data | Authority |
|------|-----------|
| Editor projects / scenes / scripts | local **or** Puter (above) |
| Agent jobs | free-ai Worker **D1** `forge-agent` |
| Fast catalog / fleet search | free-ai `/api/catalog/*` |
| Binary meshes | R2 `assets.grudge-studio.com` |
| Weapon/class JSON | ObjectStore |
| Player bag / XP / wallet | **Railway** Postgres — not Forge, not Puter SSOT |
| Account mirror (optional) | Puter KV `grudge:forge:account-mirror:{id}` after Railway GET only |

Full matrix: [ACCOUNT_PUTER_ENGINE_SSOT.md](./ACCOUNT_PUTER_ENGINE_SSOT.md) · Puter API patterns: [PUTER_PATTERNS.md](./PUTER_PATTERNS.md)

## AI stack

| Layer | Endpoint / package | Role |
|-------|-------------------|------|
| **Legion brain** | `ai.grudge-studio.com` via free-ai `provider=grudge-ai` | Auto default · agent skills |
| Free edge proxy | `/api/free-ai/chat?provider=` | Groq, Together, OpenRouter, Gemini, … |
| Catalog | `/api/catalog/*` | Fast assets, fleet D1 search, gamedata |
| Agent jobs | `/api/agent/jobs` | Durable generate/bake hints |
| Knowledge brain | `/api/knowledge/*` | Docs, D1 research (read-only) |
| Client providers | `lib/ai/providers/*` | grudge-ai, Puter, Ollama, free, Anthropic |
| Tools | `project_storage_status`, `migrate_local_projects_to_puter`, `agent_stack_status` | Diagnose + migrate |
| Account mirror | `lib/cloud/accountMirror.ts` | Railway snapshot → optional Puter KV |

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
