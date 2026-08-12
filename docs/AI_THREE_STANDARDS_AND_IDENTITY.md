---
layout: default
title: AI Three.js Standards · Verification · Identity
nav_order: 16
---

# AI Worker · Three.js standards · verification · identity

**Audience:** Forge AI Worker, sub-agents, redeploy ops  
**Extends:** `lib/ai/threeStandards.ts` · `lib/ai/sceneVerification.ts` · orchestrator packs · `docs/ACCOUNT_PUTER_ENGINE_SSOT.md`

---

## 1. AI tool surface (do not invent parallel tools)

| Tool | Purpose |
|------|---------|
| `list_threejs_standards` | Condensed SSOT by topic (terrain, textures, rapier, raycast, controller, animation, character, identity, redeploy) |
| `verify_mesh_scale` | SI / 100× / hero band / weapon≠1.8 m |
| `verify_textures` | Placeholder hosts, untrusted CDN, missing character mesh |
| `verify_character_animation` | CCT kinematic, clips, Mixamo-on-Bip001, placeholder heroes |
| `verify_terrain_physics` | Fixed ground, Terrain layer, raycast readiness |
| `verify_scene_full` | All of the above + summary |
| `diagnose_scene` | Existing lint **plus** verification rules |
| `list_animations` / `apply_animation` / `set_physics` | Motion + Rapier |
| `create_agent_job` / `get_agent_job` | Edge D1 sub-jobs (not player bag) |

**Done gate for agents:**

```
diagnose_scene → verify_scene_full → (auto_fix_scene if needed) → re-verify
list_threejs_standards({ topic }) when unsure
```

---

## 2. Three.js / Rapier standards (summary)

| Domain | Law |
|--------|-----|
| Units | 1 unit = 1 m; human ~1.8 m |
| Color | sRGB output + color maps |
| Terrain | Fixed colliders; layer=Terrain; surface=Walk; same height for feet+body |
| Raycast | Rapier castRay/shapeCast for physics; down for ground |
| Controller | One kinematic CCT + capsule; play camera sole writer |
| Animation | One mixer; Bip001 packs; strip position tracks; no Mixamo on Bip001 |
| Character mesh | grudge6 Toon play only; no Meshy/capsule heroes |
| Redeploy | GHA SPA; free-ai wrangler; Legion dual workers; smoke matrix |

Full text: AI tool `list_threejs_standards` or `lib/ai/threeStandards.ts`.

---

## 3. Sub-agents & correct redeployment

| Worker / path | Role |
|---------------|------|
| **Legion** `ai.grudge-studio.com` | Brain (models, skills, JWT) |
| **free-ai** `forge…/api/free-ai` | Hands (proxy, catalog, D1 jobs) |
| **gameforge-web** | SPA edge shell + health |
| **GHA Deploy Forge SPA** | Production editor binary |
| **Railway grudge-api** | Player account / bag / characters |

Rules:

1. Do not invent a second public AI domain.  
2. Secrets only via `wrangler secret put` (e.g. `GRUDGE_AI_KEY`).  
3. Intentional single-intent deploys; smoke after.  
4. Agent D1 jobs ≠ Railway player SSOT.

---

## 4. Identity review (id.grudge-studio.com)

| Plane | Authority | Forge UX |
|-------|-----------|----------|
| **Grudge ID** | JWT · Railway `users.grudge_id` | Primary “signed in” for fleet/AI bag |
| **Puter** | User-Pays FS/KV/AI | Cloud projects only (`isPuterSignedIn`) |
| **Guest** | localStorage | Local editor |
| **Email / Discord / wallet** | ID hub mint | Same Grudge ID row |

### Live contract (verified 2026-08)

| Path | Status |
|------|--------|
| `GET /login?redirect_uri=` | **200** — use this |
| `GET /auth/popup` | **404** — never use |
| `POST /api/auth/session/claim` | exists (needs cookie session) |
| `GET /api/auth/me` | **401** without Bearer (expected) |
| `grudge-game-bootstrap.js` | **200** fleet token dual-write |

### Handoff law

1. Prefer **`sso_token`** (session JWT) over **`grudge_token`** (launch).  
2. Dual-write: `grudge.open.token`, `grudge_auth_token`, `sso_token`, …  
3. postMessage: `grudge-auth:success` + legacy `grudge:auth:success`.  
4. Popup blocked → full-page redirect to `/login`.

Code: `artifacts/game-forge/src/lib/grudgeAuthBridge.ts`.

---

## 5. Account & game studio systems (best practice)

| Concern | SSOT |
|---------|------|
| Login UI | `id.grudge-studio.com` only |
| Player bag / XP / island | Railway Postgres |
| Forge projects | Puter FS/KV (signed-in) or local IDB (guest) |
| Agent jobs | free-ai D1 `forge-agent` |
| Meshes | R2 `assets.grudge-studio.com` |
| Game eras | One account, many characters per era (Steam model) |

**Never:** Puter as bag SSOT · D1 as characters · Replit storage · localStorage-only production heroes.

---

## 6. Related skills (load order)

1. `grudge-studio`  
2. `threejs-skills` / leaves (fundamentals, textures, animation, helpers-physics-terrain)  
3. `grudge-rapier` · `grudge-character-correctness` · `grudge6-full-stack`  
4. `grudge-production-wiring` · `puter` · `forge-editor`

---

## 7. Smoke

```bash
curl -sS https://forge.grudge-studio.com/api/free-ai/status
curl -sS https://id.grudge-studio.com/login -o /dev/null -w "%{http_code}"
# In editor AI: list_threejs_standards({topic:'all'}) · verify_scene_full({})
```
