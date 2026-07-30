---
layout: default
title: Multiplayer deploy
nav_order: 6
permalink: /multiplayer-deploy/
description: Best multiplayer patterns and deployment for Forge scenes and fleet games.
---

# Multiplayer deployment (Forge + fleet)

Forge is primarily an **editor**. Multiplayer for playtests and shipped games should follow **Grudge live-servers** patterns — not a WebSocket on the Vercel SPA.

**Hard rule:** Vercel static SPA (and the Forge web Worker that only proxies HTML/JS) **cannot** upgrade WebSockets. Realtime lives on Railway Node, a CF Worker that proxies upgrades, or Durable Objects.

## Recommended topology

```
Editor (forge.grudge-studio.com)
  ├── SPA: Vercel prebuilt via CF Worker (no WS upgrade here)
  ├── Scene/scripts: Puter or local project store
  └── "Publish playtest" → ephemeral room ticket (L7) optional

Play clients
  ├── Auth: id.grudge-studio.com
  ├── State: Railway grudge-api (characters / bag)
  ├── Assets: assets.grudge-studio.com (R2)
  └── Realtime: one of L2 / L3+L4 / L6 below
```

## Pattern pick list (best fit)

| Pattern | Stack | When | Deploy how |
|---|---|---|---|
| **L2 Carrier co-located** | One Node process: HTTP `/api/*` + `WS /api/carrier` | Fastest ops; game API already on Railway | `railway up` / existing api-server service |
| **L3 + L4** | CF Worker upgrades WS → Railway room | Custom domain in front of Vercel SPA | `wrangler deploy` edge + Railway room |
| **L6 Durable Objects** | CF DO per `roomId` | Multi-tenant browser rooms at edge | Worker + DO class in wrangler |
| **L7 Ephemeral** | Short-lived room URL + TTL | Forge/Studio “playtest” deploys | Ticket API + auto teardown |

**Default for a new browser multiplayer game:** L0 assets (CDN) + **L2** (or **L3+L4** if the front door is Vercel-only).

### Decision tree

```text
Is the play origin a long-lived Node host (Railway Express)?
  YES → L2: attach WebSocketServer { noServer: true } on same process
  NO  → Is the browser domain Cloudflare DNS (Worker can own upgrade)?
          YES → L3 Worker upgrade → L4 Railway room (or L6 DO)
          NO  → Point play clients at a dedicated WS host (L4 URL env)
                  or move play under a CF-owned domain

Forge “playtest” only (no permanent rooms)?
  → L7 ephemeral ticket + TTL teardown
```

## Best multiplayer gameplay pattern

Mirror / uMMORPG-style (client **intent**, server **truth**):

| Concern | Client | Server / room |
|---|---|---|
| Movement | Send `move` / look intent | Integrate pose at 20–30 Hz |
| Combat | Send `fire` / skill id | Validate CD, range, damage |
| Remote avatars | Interpolate last snapshots | Broadcast poses ~20 Hz |
| Physics | Local predict (Rapier) | Authoritative hits / loot |
| Seed | Same `WORLD_SEED` | Same sim step (no wall clock) |

**Do not** put multiplayer truth in Puter KV, localStorage, or dual physics engines.

### Forge script templates (client)

1. `wasd-character-controller`
2. `third-person-camera`
3. `network-manager-mirror` — emits `playerPose` / expects `ctx.net`
4. `remote-player-interpolator`

Inject transport at **play start** (not in scene JSON):

```ts
function wsUrl(path = "/api/carrier") {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}
// ctx.net = { playerId, send, on } over that socket
```

Never hardcode `wss://some-railway-host` into saved scenes.

## Deployment methods by pattern

### L2 — Carrier co-located (preferred default)

One Railway (or VPS) Node process serves REST + WS:

```text
Browser
  HTTP  /api/*        → Express
  WS    /api/carrier  → WebSocketServer (noServer) → room
```

```bash
# Typical monorepo api-server / game room
pnpm run build
# Railway: set PORT, ALLOWED_ORIGINS, DATABASE_URL as needed
railway up
# Smoke
curl -sS https://<host>/api/health
# WS: connect wss://<host>/api/carrier (or same-origin via reverse proxy)
```

**Client:** `wsUrl()` from `location.host` when DNS points at this host (or CF proxies both HTTP and WS).

### L3 + L4 — CF edge WS proxy → Railway room

Use when SPA is on Vercel and only the Worker owns `*.grudge-studio.com`:

```text
Browser → CF Worker
            ├─ Upgrade /api/carrier|space|brawl → Railway room
            ├─ /api/characters|…              → Railway game-data
            └─ /* HTML/JS                     → Vercel ORIGIN
```

```bash
# Edge (example GRUDOX-style worker)
cd <repo>/infra/cloudflare/<game-worker>
npx wrangler deploy

# Room
cd artifacts/pvp-server   # or Colyseus / carrier room
railway up
# Env: ALLOWED_ORIGINS includes play origin; TICK_HZ, MAX players
```

**Do not** re-wrap HTTP 101 responses in the Worker (breaks handshakes).

### L6 — Durable Objects (multi-tenant edge)

```text
Worker fetch → idFromName(roomId) → DO Hibernation WebSockets
```

Good for many short rooms without one Railway process per room. Prefer when CPU is light (pose relay, not full physics server).

### L7 — Forge / Studio playtest

1. Build scene → upload GLB/scene JSON to R2 or Puter publish  
2. Provision `roomId` (Carrier / DO / Railway)  
3. Return play URL: `https://<game>/play?scene=<cdn>&room=<id>`  
   (Forge: often `player.html?scene=…`)  
4. TTL teardown for previews  

## What deploys where (Forge vs multiplayer)

| Artifact | Mechanism | Multiplayer? |
|---|---|---|
| Forge SPA | GHA → Vercel prebuilt → CF web Worker | **No** realtime |
| free-ai / catalog / agent | CF Worker + D1 | No |
| Scene / project | Puter or local | No |
| Character / bag | Railway Postgres | Shared identity only |
| Game room | Railway L2/L4 or CF DO L6 | **Yes** |
| Assets | R2 + D1 index | L0 SSOT for all clients |

## Deployment checklist

```text
[ ] Assets on R2 + D1 index (no multi-GB git)
[ ] Grudge ID + CORS allowlist for play origin
[ ] Room host: Railway L2/L4 OR CF DO L6
[ ] If domain is CF Worker + Vercel SPA: WS paths owned by Worker (L3)
[ ] Client uses same-origin wsUrl() or ticket-provided URL (never baked scene host)
[ ] Smoke: HTTP health + WS upgrade + one join
[ ] Open library card if player-facing (L9)
[ ] Rapier only — no second physics stack
```

## Package note

- **Editor (Forge):** no `colyseus.js` required until you ship a Colyseus client in a **play** build.  
- **Game room:** prefer existing fleet `pvp-server` / Carrier / Colyseus on Railway.  
- Optional later: add `colyseus.js` to a **player** package, not the editor shell.
- Convert helpers (`@gltf-transform/*`, `meshoptimizer`) are offline editor tooling — unrelated to room hosting.

## Related

- Skill **`grudge-live-servers`** (L0–L9)
- Skill **`forge-gameplay-scripts`** (templates + Mirror-style net)
- [Deployment mechanisms]({% link deployment.md %})
- [3D dependencies]({% link 3d-dependencies.md %})
- [Game deploy definitions]({% link GAME_DEPLOYMENT_DEFINITIONS.md %})
