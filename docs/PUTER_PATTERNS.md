---
layout: default
title: Puter patterns
nav_order: 13
---

# Puter.js patterns (Forge + fleet)

**SDK:** `https://js.puter.com/v2/`  
**Skill:** `puter` · **Deploy Sites:** `puter-grudachain-deploy`  
**Account law:** [ACCOUNT_PUTER_ENGINE_SSOT.md](./ACCOUNT_PUTER_ENGINE_SSOT.md)

---

## When to use Puter

| Need | Pattern |
|------|---------|
| Guest drafts | localStorage + IndexedDB (`projectStorage`) |
| Signed-in editor projects | `puter.kv` indexes + `puter.fs` payloads under `Grudge/forge/` |
| UI prefs / tool state | `puter.kv` `grudge:{id}:…` |
| User-pays chat | `puter.ai.chat` (orchestrator failover) |
| Static lab site | `puter.hosting` / Sites `…/deployment` |
| Player bag / heroes | **Never Puter** → Railway |

---

## Forge code map

| File | Role |
|------|------|
| `lib/puterSdk.ts` | Load SDK |
| `lib/cloud/puterCloud.ts` | Guest-safe kv/fs wrappers |
| `lib/cloud/puterDataProvider.ts` | Collection index + FS bodies |
| `lib/cloud/projectStorage.ts` | local vs puter backend |
| `lib/authBootstrap.ts` | Puter session restore |
| `lib/grudgeAuthBridge.ts` | Grudge ID JWT (separate from Puter) |
| `lib/forgeEnv.ts` | Public origins + Puter key names |

---

## KV / FS conventions

```
# Forge
KV  grudge:forge:projects:index
KV  grudge:forge:nextId
KV  grudge:forge:<collection>:index
FS  Grudge/forge/<collection>/<id>.json

# Toolkit (puter.grudge-studio.com)
KV  grudge:{accountId}:{scope}:{name}
FS  /GrudgeStudio/Projects|Code|AI-Sessions|Cache

# UI editor (ui.grudge-studio.com)
KV  grudge:{grudgeId}:ui-pack:…
```

### Rules

1. Always namespace with `grudge:`.  
2. Scope by Grudge account id when JWT present (not only Puter uuid).  
3. No passwords, private keys, or `sk-` API secrets in KV.  
4. Prefer FS for > ~200KB JSON.  
5. After Railway success only, write optional mirrors.

---

## Auth UX

1. **Grudge ID** — fleet identity, Legion JWT, bag.  
2. **Puter** — cloud projects + user-pays AI.  
3. Guest — local projects only.

Do not show “Signed in” for Puter-only when product expects Grudge ID.

---

## Sites / apps / workers

| Kind | Use |
|------|-----|
| **Site** `*.puter.site` | Static panels, VFX, craft UI mirrors |
| **App** puter.com/app/… | Shell with `index_url` → fleet SPA |
| **Worker** | Prototypes only |

Deploy live root: `/MolochDaDev/sites/<slug>/deployment` (not Desktop alone).

---

## Orchestrator interaction

Failover (Forge Auto):

1. Grudge AI Legion (JWT)  
2. free-ai Groq/Together  
3. **Puter AI** (if Puter signed in)  
4. BYOK  
5. Ollama  

See [FORGE_AI_ORCHESTRATOR.md](./FORGE_AI_ORCHESTRATOR.md).

---

## Anti-patterns

| Bad | Good |
|-----|------|
| Puter bag SSOT | Railway `/api/account` |
| Key in `VITE_*` | free-ai / Legion secrets |
| Upload Desktop only | Sites deployment root |
| Second Warlords binary on puter.site | `index_url` → grudgewarlords.com |
