---
layout: default
title: Game deployment definitions
nav_order: 14
---
# Game Deployment Definitions â€” API & Fleet SSOT

**Audience:** Forge agents, game onboarding, deploy ops  
**Live:** forge.grudge-studio.com Â· fleet games  
**Code:** `artifacts/game-forge/src/lib/gameDeployments.ts`  
**Related:** `DEPLOYMENT.md` (Forge SPA only) Â· skills `grudge-fleet` Â· `grudge-live-servers` Â· `grudge-game-onboarding` Â· `grudge-foundry`  
**Last review:** 2026-07-27  

This document **defines** how games, editors, and APIs are classified for deployment. It **replaces** vague â€œpublishâ€ language and purged practices that assumed â€œassets ship inside the SPA bundle.â€

---

## 1. Five-layer data SSOT (every game)

| Layer | Authority | Host / path | Not for |
|-------|-----------|-------------|---------|
| **L-PLAYER** | Railway Postgres | `grudge-api-production-0d46` via same-origin `/api/characters\|account\|island\|wallet\|â€¦` | D1 as bag/XP |
| **L-DEFS** | ObjectStore / info | `objectstore.grudge-studio.com/api/v1` | Random gists |
| **L-BIN** | R2 `grudge-assets` | `https://assets.grudge-studio.com/{r2Key}` | Git LFS large GLBs |
| **L-INDEX** | D1 asset registry | index/search only | Player state |
| **L-WORLD** | Mine-Loader / sectors | world blocks when needed | Character roster |

**Law:** Player write path is Railway. Assets are CDN. Scenes may cache on Puter KV but **must** durable-save via Forge API / R2 / GitHub.

---

## 2. Surface classes (what you are deploying)

| `SurfaceClass` | Meaning | Examples |
|----------------|---------|----------|
| `editor` | Authoring SPA | forge.grudge-studio.com |
| `launcher` | Library / hub | open.grudge-studio.com |
| `play_client` | Live game client | client.grudge-studio.com, grudgewarlords.com |
| `create_foundry` | Character create + select | character.grudge-studio.com |
| `hub_pvp` | Multiplayer hub + WS edge | grudox.grudge-studio.com |
| `api_game_data` | Character/account SSOT API | Railway grudge-api |
| `api_forge` | Forge projects/scenes/scripts | forge `/api/*` â†’ Railway forge-api |
| `api_identity` | Auth gateway | id.grudge-studio.com |
| `api_ai` | AI gateway | ai.grudge-studio.com |
| `cdn_assets` | Binary CDN | assets.grudge-studio.com |
| `objectstore` | JSON catalogs | objectstore.grudge-studio.com |
| `room_ws` | Realtime rooms | Carrier / Colyseus / pvp-server |
| `player_embed` | Scene-only player | Forge `player.html` / Puter host |
| `desktop` | Electron tool | game-forge-desktop |
| `archive` | Do not onboard | Babylon legacy, dead Replit |

---

## 3. Deploy pattern IDs (live-servers L-codes)

| ID | Name | Use when |
|----|------|----------|
| **L0** | Asset SSOT | Always â€” CDN + magic-byte verify |
| **L1** | Open launcher SPA | open.grudge-studio.com |
| **L2** | Co-located HTTP+WS | Single Node process (Carrier) |
| **L3** | CF edge WS proxy | Vercel SPA + Railway room (GRUDOX) |
| **L4** | Dedicated Railway room | Heavy isolation / Colyseus / pvp |
| **L5** | Path-isolated rooms | Multi-room path prefixes |
| **L6** | Durable Object rooms | Edge multi-tenant |
| **L7** | Ephemeral playtest | Forge â€œPublish previewâ€ TTL |
| **L8** | Studio/editor artifact | forge / studio / dash |
| **L9** | Open library entry | Player-facing catalog card |

**Default new browser game:** L0 + L1 entry + L2 (or L3+L4 if fronted by Vercel).  
**Default Forge playtest:** L7 Puter host or player embed â€” **not** full fleet publish.

---

## 4. Publish channels (Forge product)

| `PublishChannel` | What it is | Durable? | Best practice |
|------------------|------------|----------|----------------|
| `forge_api_save` | POST project/scene/scripts to Forge Postgres | Yes | Primary editor save |
| `r2_user_assets` | GLB/textures â†’ R2 `user-assets/<projectId>/â€¦` | Yes | Required for models in scenes |
| `github_pack` | `forge.project.json` + scenes + scripts | Yes | Team / backup |
| `puter_host` | `*.puter.site` player bootstrap + scene.json | User-pays | Share link; **not** fleet prod |
| `player_embed` | Static `player.html` + scene.json | Depends on host | Lightweight play |
| `fleet_satellite` | Vercel game + rewrites to Railway/ID/CDN | Yes | Real games (onboarding skill) |
| `open_library` | GameEntry on Open | Yes | Discovery only |
| **PURGED** `bundle_in_spa` | Ship GLBs inside editor Vite dist | **No** | **Do not use** â€” CDN only |

---

## 5. API game systems (Forge + fleet)

### 5.1 Forge API (`artifacts/api-server`)

| Route group | System | Data |
|-------------|--------|------|
| `/api/projects` | Project CRUD | Postgres `forge_projects` |
| `/api/scenes` | Scene graph JSON | Postgres `forge_scenes` |
| `/api/scripts` | Entity scripts | Postgres `forge_scripts` |
| `/api/assets` | Asset registry rows | Postgres + R2 keys |
| `/api/storage` | Presigned R2 upload | R2 buckets |
| `/api/templates` | Scene templates | Seed + R2 |
| `/api/prefabs` | Prefab library | DB |
| `/api/ai` / `/api/cf-ai` / `/api/free-ai` | AI Worker backends | Keys / CF / free |
| `/api/auth` / Puter | Editor identity | Puter + optional Grudge ID |
| `/api/grudge` | Fleet bridge hooks | Catalog / account read |
| `/api/navmesh` | Bake jobs | Compute |
| `/api/knowledge` | AI brain docs/R2/GitHub | Read-only |

**Definition:** Forge API is the **editor control plane**, not the player bag SSOT. Characters for live Warlords still write **Railway grudge-api**.

### 5.2 Fleet game-data API (Railway)

| Prefix | System |
|--------|--------|
| `/api/characters` | Roster / active character |
| `/api/account` | Profile / tokens |
| `/api/inventory` Â· bag | Items |
| `/api/island` | Home island state |
| `/api/wallet` | In-game wallet |
| Auth segments | Session / guest / bridge (via ID + Railway) |

**Definition:** **L-PLAYER** for all fleet games. Forge play mode may *read* characters; it does not replace this API.

### 5.3 Identity

| Host | System |
|------|--------|
| `id.grudge-studio.com` | Grudge ID login, SSO, token exchange |

### 5.4 Catalogs & binaries

| Host | System |
|------|--------|
| `objectstore.grudge-studio.com/api/v1` | weapons/classes/races JSON |
| `assets.grudge-studio.com` | GLB, PNG, audio |

---

## 5.5 Fleet games + Forge roles (Wargus et al.)

Code: `FLEET_GAME_DEFS` + `forgeWorkflowForGame()` in `gameDeployments.ts`.  
AI: `list_game_deployments` with `{ game: "wargus" }`.

| Game id | Play URL | Forge roles |
|---------|----------|-------------|
| **wargus** | grudge-studio.com/wargus | map_edit, script, playtest, game_manager, inspector, deploy, ai_agent |
| **warlords-client** | client.grudge-studio.com | map + RPG behaviors + playtest |
| **grudox** | grudox.grudge-studio.com | deathmatch maps + L3/L4 rooms |
| **open-launcher** | open.grudge-studio.com | catalog only (L9) |

### Wargus production pattern

1. **Map edit** — Forge Hierarchy/Inspector/Viewport → save `.gfscene` (`forge_api_save` + `r2_user_assets`).
2. **Scripts** — behaviors `gamemode-rts`, `rts-peon`, `rts-footman`, `rts-archer`, `rts-building`, … on entities; templates `wasd-character-controller`, `spawn-r2-character`, …
3. **GameManager** — empty named `GameManager` + `gamemode-rts` (economy, win/lose, enemy AI).
4. **Inspector** — entity props, production queues, rally, layers (Player/NPC/Terrain).
5. **Playtest** — editor Play mode → L7 `puter_host` / `player_embed` (not full fleet publish).
6. **Deploy** — `fleet_satellite` (L0 CDN grudge6 Draco GLBs + L1 Open card); player bag remains Railway.
7. **AI agents** — `list_game_deployments`, `list_script_templates`, `list_fast_assets`, `spawn_fleet_asset`, free-ai edge jobs.

**Assets:** `assets.grudge-studio.com/models/grudge6/` + builtin; SkeletonUtils clones; SI 1.8 m human; never `bundle_in_spa`.

---

## 6. Connection contract (every live game)

```
[Browser game or editor]
  â”œâ”€â”€ Auth:     id.grudge-studio.com  (/login?redirect_uri=)
  â”œâ”€â”€ Player:   same-origin /api/characters|account|â€¦ â†’ Railway
  â”œâ”€â”€ Defs:     objectstore /api/v1  (or proxy)
  â”œâ”€â”€ Binaries: assets.grudge-studio.com  (or proxy)
  â”œâ”€â”€ AI:       ai.grudge-studio.com  (optional)
  â””â”€â”€ Realtime: L2 same host | L3 Workerâ†’Railway | L4 dedicated WS
```

**Dead / purged endpoints (do not assign):**

| Dead | Replace with |
|------|----------------|
| `api.grudge-studio.com` (old tunnel) as player SSOT | Railway via same-origin `/api/*` |
| Replit object storage paths | R2 upload through Forge |
| `bundle_in_spa` for production meshes | R2 CDN keys |
| Babylon GrudgeWorld as fleet play | Open Three / client.grudge-studio.com |

---

## 7. Assigning a Forge scene to a deploy

| Goal | Channel | Pattern | API systems touched |
|------|---------|---------|---------------------|
| Keep working | `forge_api_save` + `r2_user_assets` | L8 | projects, scenes, assets, storage |
| Share playtest | `puter_host` or `player_embed` | L7 | storage + Puter (not Railway characters required) |
| Ship Warlords content | Export GLB/scene â†’ client CDN + Railway characters | L0 + play_client | R2 + grudge-api |
| Ship new browser game | `fleet_satellite` + L9 | L0+L1(+L2/L3) | ID + Railway + ObjectStore + CDN |
| Multiplayer room | room_ws | L2â€“L4 | room process + optional game-data |

---

## 8. Best-practice assignment rules

| Context | Owns | Must not say |
|---------|------|--------------|
| `deploy` | Channels, L-codes, smoke | â€œbundle GLBs in Vite distâ€ |
| `project-asset` | R2 keys, meta sidecars, unused asset cleanup | â€œassets are bundled into published buildâ€ |
| `import` / `export` | Converter + GLB rules | Puter as sole durable store |
| `scene` | CommandStack, `.gfscene.json` | ObjectLoader as game SSOT |
| `ai` | Undoable tools | Fleet one-click ship via batch_generate |
| `viewport` / `physics` | Render + Rapier | â€” |

Code: `lib/bestPractices.ts` Â· AI: `list_forge_best_practices` Â· defs: `lib/gameDeployments.ts`.

---

## 9. Agent checklist

```
[ ] Identify SurfaceClass + PublishChannel
[ ] L-PLAYER writes only Railway; L-BIN only R2
[ ] Forge save â‰  fleet game publish
[ ] Puter host = L7 playtest, not production Warlords
[ ] No Replit / dead api tunnel / SPA-bundled GLBs
[ ] Smoke health + asset HEAD after deploy
[ ] Register Open library (L9) only for player-facing games
```

