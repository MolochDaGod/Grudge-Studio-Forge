---
layout: default
title: Account · Puter · Engine DB SSOT
nav_order: 15
---

# Account · Puter.js · Engine database SSOT

**Audience:** agents, ops, product  
**Goal:** one account model, correct Puter usage, no second player database.

Related: [PROJECT_STORAGE_AND_AI.md](./PROJECT_STORAGE_AND_AI.md) · [PUTER_PATTERNS.md](./PUTER_PATTERNS.md) · [AI_FLEET_ATTACH_SSOT.md](./AI_FLEET_ATTACH_SSOT.md) · skill `grudge-production-wiring` · skill `puter`

---

## 1. Identity stack (login order)

| Step | System | What it gives |
|------|--------|----------------|
| 1 | **Grudge ID** `id.grudge-studio.com` | JWT, `grudgeId`, Railway account |
| 2 | **Puter** `js.puter.com` | User-Pays KV/FS/AI, optional link |
| 3 | Guest | Local only; no cloud bag |

**Signed-in for fleet games** = Grudge ID JWT (`grudge_auth_token` …).  
**Puter signed-in** alone = `puterLinked` only — never show as full account for bag/heroes.

---

## 2. Engine database (player SSOT)

| Concern | Authority | API |
|---------|-----------|-----|
| Users / Grudge ID | Railway Postgres | `id…` → `/api/auth/*` |
| Characters / progress | Railway | `/api/characters` |
| Account bag / resources / GBUX | Railway | `/api/account` · `/api/inventory` |
| Wallet / GRUDA | Railway | `/api/wallet` |
| Home island seeds | Railway | `/api/island` |
| Profession XP | Railway | character progress revisioned |

**Base:** `https://grudge-api-production-0d46.up.railway.app`  
**Never SSOT:** Puter KV, D1, localStorage, free-ai D1, Neon (toolkit lab only).

### Account best practices

1. One human → one Grudge ID / `users.grudge_id`.  
2. Many characters per account; UUID primary keys.  
3. Bearer JWT on every mutating call.  
4. **Account scope** (bag, camps, home island) ≠ **character scope** (XP, equip, mastery).  
5. Optimistic concurrency / revision on progress writes.  
6. CORS allowlist includes `forge.grudge-studio.com`, `*.puter.site`, apps.  
7. Puter UUID may **link** via `POST /api/auth/puter` — never replace Railway row.

---

## 3. Puter.js — what it is for

| Puter API | Use | Do not use for |
|-----------|-----|----------------|
| **auth** | Optional cloud shell; link after Grudge ID | Sole “signed in” for games |
| **kv** | Prefs, indexes, mirrors after Railway success | Bag, XP, wallet sole store |
| **fs** | Project JSON, drafts, exports, AI session logs | Production GLB CDN |
| **ai** | User-pays models (no studio key) | Production server keys in browser |
| **hosting** | Static labs `*.puter.site` | Player SSOT, production Warlords binary |
| **workers** | Prototypes only | Combat rooms, bag API |

### Key / path law

```
KV:  grudge:{accountId|guest}:{scope}:{name}
FS:  Grudge/forge/...          (Forge projects)
     /GrudgeStudio/Projects... (PuterJsToolkit)
```

- Secrets / private keys → **never** KV  
- Large blobs → FS or R2  
- After Railway GET/PATCH succeeds → optional KV **mirror** with `note: mirror-only-not-ssot`

---

## 4. What lives where (Forge + fleet)

| Data | Puter | CF Worker D1/KV | R2 CDN | Railway | ObjectStore |
|------|-------|-----------------|--------|---------|-------------|
| Login JWT | no | no | no | **mint/verify** | no |
| Bag / GBUX / wallet | mirror only | no | no | **SSOT** | no |
| Heroes / XP | mirror only | no | no | **SSOT** | no |
| Forge scenes / projects | **yes (signed-in)** | no | no | no | no |
| Forge guest scenes | local IDB | no | no | no | no |
| AI agent jobs | no | **forge-agent D1** | no | no | no |
| Legion API keys / agent roles | no | **grudge-ai-hub D1** | no | JWT secret shared | no |
| Meshes / audio | no | index D1 only | **binaries** | no | defs JSON |
| Recipes / items defs | no | no | no | no | **yes** |
| UI packs / editor prefs | **yes** | optional | no | no | no |

---

## 5. Should we enhance with Puter? (decision matrix)

### SHOULD (do these)

| Enhancement | Why | How |
|-------------|-----|-----|
| **Grudge ID first, Puter second** on Forge/Toolkit | Correct signed-in UX | Welcome: ID → optional Puter |
| **Namespaced KV + FS trees** | Multi-app same Puter account | Shared prefix `grudge:` |
| **Mirror account snapshot after Railway** | Offline prefs UI | `grudge:{id}:account-cache:last` |
| **Migrate local Forge → Puter** | Cloud save after link | existing `migrate_local_projects_to_puter` |
| **GrudgeOS / Toolkit same plane** | One project list | KV `grudge:forge:projects:index` |
| **User-pays AI via Puter** | Zero studio cost labs | puter.ai in orchestrator failover |
| **Static demos on `*.puter.site`** | Free hosting for toys | Sites root `/MolochDaDev/sites/.../deployment` |

### COULD (optional later)

| Enhancement | Caveat |
|-------------|--------|
| Puter Workers as toy APIs | Not bag/combat SSOT |
| Puter hosting for VFX/craft panels | Railway for player writes |
| Cross-device editor prefs only in Puter | OK if no secrets |
| Publish playtest build URL via Puter hosting | Point at fleet SPA, not second game binary |
| Puter FS for user-uploaded GLB **drafts** | Production still convert → R2 |

### SHOULD NOT

| Anti-pattern | Correct |
|--------------|---------|
| Puter KV as character roster | Railway `/api/characters` |
| Puter site as Warlords production | `index_url` → grudgewarlords.com |
| Studio API keys in Puter SPA | free-ai / Legion secrets |
| Desktop-only upload as “deployed” | Resolve Sites/`hosting.list()` root |
| Second Neon/Postgres for bag | Railway only |

---

## 6. Services map (attach, don’t duplicate)

```
id.grudge-studio.com          Identity UI + JWT
Railway grudge-api            Engine DB (account/characters/wallet/island)
ai.grudge-studio.com          Legion LLM brain (Workers AI + BYOK)
forge…/api/free-ai            Edge LLM proxy + catalog + jobs → Legion
assets.grudge-studio.com      R2 binaries
objectstore / info            Definitions JSON
puter.com / js.puter.com      User-Pays auth + KV + FS + optional AI
puter.grudge-studio.com       Toolkit SPA (fleet hub, envs)
*.puter.site                  Static labs (craft, vfx) — not player DB
```

---

## 7. Engine DB best practices (ops)

1. **Backups:** Railway Postgres P0 (`grudge-dev-tool` backup runbook).  
2. **No browser `DATABASE_URL`.**  
3. **Idempotency** on craft/spend; revision on progress.  
4. **CORS** allow Forge, apps, puter.site, warlords.  
5. **Link Puter:** `POST /api/auth/puter` after both sessions exist.  
6. **Toolkit Neon** (if used): lab/app metadata only — not fleet bag.

---

## 8. Puter deploy best practices (MolochDaDev)

| Rule | Detail |
|------|--------|
| Live root | `/MolochDaDev/sites/<sub>/deployment` not Desktop-only |
| CLI account | Deployer MolochDaDev ≠ product user grudachain |
| After upload | Smoke HEAD puter.site + Last-Modified |
| Game apps | Prefer `index_url` → fleet host |

Skill: `puter-grudachain-deploy`.

---

## 9. Enhancement roadmap (ordered)

| # | Work | Surface |
|---|------|---------|
| 1 | Docs (this file) + fix Puter patterns | Forge docs |
| 2 | forgeEnv account API pointers + env snapshot | SPA |
| 3 | Account mirror helper after Grudge ID login | SPA |
| 4 | SPA deploy (Auto AI UI) | Forge |
| 5 | Legion GROQ + free-ai GRUDGE_AI_KEY | Workers |
| 6 | Optional: Puter Worker prototype only | labs |
| 7 | Optional: Vectorize knowledge on Legion | ai hub |

---

## 10. Smoke

```bash
# Engine
curl -s https://grudge-api-production-0d46.up.railway.app/api/health

# Legion
curl -s https://ai.grudge-studio.com/health

# Forge edge
curl -s https://forge.grudge-studio.com/api/free-ai/status

# Identity
curl -sI https://id.grudge-studio.com/login
```
