# Grudge GameForge

Three.js scene editor, physics engine & AI-assisted game builder — by [Grudge Studio](https://grudge-studio.com).

**Web Editor** → `forge.grudge-studio.com`
**Desktop App** → [Releases](https://github.com/MolochDaGod/Grudge-Studio-Forge/releases)

## Features

- **Visual Scene Editor** — hierarchy panel, property inspector, transform gizmos, asset browser, drag-and-drop
- **Three.js + R3F** — full React Three Fiber pipeline with postprocessing (bloom, SSAO, DOF)
- **Rapier 3D Physics** — rigid bodies, colliders, joints, raycasting — all configurable in-editor
- **Dual AI Assistant** — Claude via Anthropic SSE streaming *or* Puter AI (user-pays, no server key needed). Client owns all tool definitions; server is a thin proxy
- **Babylon.js Runtime** — engine-agnostic scene format; scenes designed in the Three.js editor can be loaded and played in Babylon.js via `@workspace/babylon-runtime`
- **AI Storage** — AI can persist scene snapshots and import remote assets (GLB, textures, audio) into per-project R2 namespaces with SSRF protection
- **Monaco Code Editor** — embedded TypeScript editor for custom scripts and behaviors
- **Recast Navmesh** — client-side baking with server-persisted binary blobs for agent pathfinding (Yuka AI)
- **Scene Templates** — 9+ built-in starter scenes seeded from R2 on boot
- **Poly Haven Integration** — browse and spawn 2000+ CC0 textures, HDRIs, and models directly in the editor
- **Grudge Catalog** — proxy to the Grudge ObjectStore weapons/equipment/enemies/quests databases
- **Asset Pipeline** — FBX→GLB conversion (desktop, via glTF-Transform), presigned R2 upload (Uppy), content-addressed dedup
- **Embeddable Player** — publish scenes as standalone single-file HTML
- **Puter Auth** — session-less server; Puter SDK client-side with server-verified token sync to shared `users` table
- **Desktop App** — Electron 33, FBX import, auto-updater via GitHub Releases

## Architecture

```
Grudge-Studio-Forge/                     pnpm monorepo
├── artifacts/
│   ├── game-forge/                      Editor SPA (Vite + R3F + Rapier + Monaco)
│   ├── api-server/                      Express 5 backend
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── ai.ts                SSE streaming proxy (Anthropic + Puter dual-provider)
│   │       │   ├── aiStorage.ts         Scene snapshots + remote asset import → R2
│   │       │   ├── auth.ts              Puter token verify → shared users table
│   │       │   ├── projects.ts          CRUD projects (Drizzle/Postgres)
│   │       │   ├── scenes.ts            Scene save/load
│   │       │   ├── scripts.ts           Per-entity script persistence
│   │       │   ├── prefabs.ts           Reusable entity prefabs
│   │       │   ├── assets.ts            Asset metadata
│   │       │   ├── storage.ts           Presigned upload URLs + object serving
│   │       │   ├── templates.ts         Built-in scene template manifest + R2 streaming
│   │       │   ├── navmesh.ts           Recast navmesh blob persistence (R2)
│   │       │   ├── grudge.ts            Grudge ObjectStore catalog proxy
│   │       │   ├── polyhaven.ts         Poly Haven CC0 asset proxy + cache
│   │       │   ├── puter.ts             Puter token exchange (read-only verify)
│   │       │   └── health.ts            /api/healthz
│   │       └── lib/
│   │           ├── anthropicClient.ts   Claude SDK (configurable base URL + key)
│   │           ├── r2Storage.ts         Cloudflare R2 via native S3 endpoint
│   │           ├── objectStorage.ts     Replit Object Storage (GCS-based, legacy)
│   │           ├── puterAuth.ts         Server-to-server Puter whoami verification
│   │           ├── puterServerClient.ts Puter chat + image translation shim
│   │           ├── authRepo.ts          Drizzle user upsert + grudge_accounts lookup
│   │           └── seedTemplates.ts     Boot-time R2 template seeder
│   ├── game-forge-desktop/              Electron Windows wrapper
│   ├── player/                          Embeddable scene runtime (single-file HTML)
│   └── mockup-sandbox/                  Dev-only design tool (not deployed)
├── lib/
│   ├── scene-schema/                    Zod schema for the scene graph
│   ├── scene-templates/                 Built-in template builders + tests
│   ├── api-client-react/                React Query hooks for all API routes
│   ├── api-zod/                         Shared request/response validation schemas
│   ├── api-spec/                        API route type definitions
│   ├── db/                              Drizzle ORM schema + idempotent migrations
│   ├── desktop-bridge/                  IPC bridge (Electron ↔ renderer)
│   ├── object-storage-web/              R2/S3 upload via Uppy + presigned URLs
│   └── babylon-runtime/                 Babylon.js scene loader + standalone player
├── csharp/GameForgeRuntime/             Blazor WASM C# transpiler (experimental)
└── scripts/                             Build, merge, and migration utilities
```

## API Routes

All routes live under `/api`. The server is session-less — auth is Puter token verification, not cookies.

| Route | Method | Purpose |
|---|---|---|
| `/api/healthz` | GET | Health check (boot gate) |
| `/api/auth/config` | GET | Public auth config (Puter origin, feature flags) |
| `/api/auth/puter/sync` | POST | Verify Puter token + upsert user row |
| `/api/puter/exchange` | POST | Read-only Puter token verify |
| `/api/projects` | CRUD | Project management |
| `/api/scenes` | CRUD | Scene save/load per project |
| `/api/scripts` | CRUD | Per-entity script persistence |
| `/api/prefabs` | CRUD | Reusable entity prefabs |
| `/api/assets` | CRUD | Asset metadata |
| `/api/templates` | GET | Built-in scene template manifest |
| `/api/templates/:key` | GET | Stream template JSON from R2 |
| `/api/ai/chat` | POST | SSE streaming AI (Anthropic or `?provider=puter`) |
| `/api/ai-storage/scene-snapshot` | POST | AI persists scene snapshot to R2 |
| `/api/ai-storage/import-asset` | POST | AI imports remote asset to R2 (SSRF-safe) |
| `/api/ai-storage/list/:projectId` | GET | List AI-stored assets/snapshots |
| `/api/ai-storage/object/*` | GET | Proxy R2 objects (fallback when no public URL) |
| `/api/navmesh/blob` | POST | Upload baked Recast navmesh (content-addressed) |
| `/api/navmesh/blob/:id` | GET | Stream navmesh binary blob |
| `/api/storage/uploads/request-url` | POST | Presigned upload URL for user assets |
| `/api/storage/public-objects/*` | GET | Serve public objects |
| `/api/storage/objects/*` | GET | Serve private objects |
| `/api/grudge/weapons` | GET | Grudge catalog: weapons |
| `/api/grudge/items` | GET | Grudge catalog: equipment |
| `/api/grudge/enemies` | GET | Grudge catalog: enemy templates |
| `/api/grudge/quests` | GET | Grudge catalog: quests |
| `/api/polyhaven/textures` | GET | Poly Haven CC0 textures (cached) |
| `/api/polyhaven/hdris` | GET | Poly Haven CC0 HDRIs (cached) |
| `/api/polyhaven/models` | GET | Poly Haven CC0 models (cached) |
|| `/api/polyhaven/files/:slug` | GET | Resolve download URLs for a Poly Haven asset |
| `/api/cf-ai/models` | GET | List available CF Workers AI models + config status |
| `/api/cf-ai/text-to-image` | POST | Generate image via CF AI (FLUX/Phoenix/SDXL), auto-upload to R2 |
| `/api/cf-ai/generate-text` | POST | Generate text via CF AI (Llama 3.1 8B) |
| `/api/cf-ai/image-to-text` | POST | Describe image via CF AI (LLaVA 1.5 7B) |

## AI System

The AI assistant uses a **client-driven tool loop**:

1. Client sends `{ messages, tools, system }` in Anthropic message format to `POST /api/ai/chat`
2. Server streams `text_delta` events via SSE as they arrive from the model
3. After the stream, server emits `tool_use` events with parsed JSON
4. Client executes tools against the live editor (Zustand store, R3F scene), appends `tool_result`, and POSTs again
5. Loop ends when the model returns `stop_reason: end_turn`

Tool **definitions** (JSON schemas) live entirely on the client — adding a new editor capability never requires a server change.

### AI Providers

| Provider | Endpoint | Auth | Use Case |
|---|---|---|---|
| **Anthropic Claude** | `POST /api/ai/chat` | Server-side `ANTHROPIC_API_KEY` | Primary AI assistant (SSE streaming, tool loop) |
| **Puter AI** | `POST /api/ai/chat?provider=puter` | Client-side `X-Puter-Token` | User-pays, no server key needed |
| **Cloudflare Workers AI** | `POST /api/cf-ai/*` | Server-side `CF_AI_API_TOKEN` | Image generation, text gen, vision |

**Anthropic rate limiting:** 20 requests/IP/minute sliding window. Model allowlist: `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`. Max 15360 tokens, 64 messages per turn, 15-turn tool loop with cooldown at turns 14–15.

### Cooldown Phase (Turns 14–15)

The AI tool loop supports up to 15 turns per conversation. At turn 14, the system enters a **cooldown phase** where the AI is instructed to:

1. Finalise in-progress changes — no new features
2. Update game info (scene summary, entity counts, environment settings)
3. Run a consistency check (verify names, positions, references)
4. Provide a session summary of all changes made

### Cloudflare Workers AI

The Forge integrates Cloudflare's serverless AI models for asset generation directly inside the editor:

- **Text-to-Image** — FLUX.2 Klein 4B (fast), Phoenix 1.0, Lucid Origin, Stable Diffusion XL. Generated images auto-upload to R2 for immediate use as textures/skyboxes.
- **Text Generation** — Llama 3.1 8B Instruct for lore, NPC dialogue, item descriptions, quest text.
- **Image-to-Text** — LLaVA 1.5 7B for asset labelling and scene description.

The AI assistant has 5 CF AI tools: `generate_texture`, `generate_skybox`, `generate_lore`, `describe_scene`, `list_cf_ai_models`. Rate limited to 10 req/min/IP.

## Tech Stack

| Layer | Tech |
|---|---|
| 3D Engine | Three.js 0.184, React Three Fiber 9, drei, three-mesh-bvh, three-bvh-csg · Babylon.js 7 runtime target |
| Physics | Rapier 3D 0.19 (WASM), @react-three/rapier |
| AI Pathfinding | Yuka 0.7, recast-navigation 0.43 (WASM navmesh baking) |
| State | Zustand 5, Immer, Miniplex 2 (ECS), XState 5 |
| AI | Anthropic Claude SDK (SSE streaming) + Puter AI REST + Cloudflare Workers AI (image gen, text gen, vision) |
| UI | Radix UI, Tailwind CSS 4, shadcn/ui, cmdk, Framer Motion, React Flow |
| Code Editor | Monaco Editor (TypeScript) |
| Backend | Express 5, Drizzle ORM, PostgreSQL, Pino logger |
| Storage | Cloudflare R2 (native S3 via @aws-sdk/client-s3) + Replit Object Storage (GCS) |
| Auth | Puter SDK (client) + server-to-server whoami verification |
| Desktop | Electron 33, electron-builder, electron-updater, glTF-Transform, AssimpJS |
| Build | Vite 7, pnpm 10 workspaces, esbuild, TypeScript 5.9 |
| Test | Vitest, @testing-library/react |

## Local Development

```bash
# Prerequisites: Node.js 24+, pnpm 10+
pnpm install

# Run editor + API server
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/game-forge run dev

# Run desktop app (Windows only)
pnpm --filter @workspace/game-forge-desktop run dev

# Run Babylon.js player (loads .gfscene.json via ?scene= param)
pnpm --filter @workspace/babylon-runtime run dev

# Typecheck everything
pnpm run typecheck

# Run all tests
pnpm run test
```

### Environment Variables

The API server reads these from environment (or `.env`):

**Required:**

| Variable | Purpose |
|---|---|
| `PORT` | Server listen port (default 8080) |
| `DATABASE_URL` | PostgreSQL connection string (shared Grudge DB) |

**AI (optional — one or both):**

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude AI assistant |
| `CF_AI_API_TOKEN` | Cloudflare Workers AI (image gen, text gen, vision) |

If neither is set, the AI assistant falls back to Puter AI (`?provider=puter`), which requires no server key.

**R2 Storage (required for templates, AI storage, navmesh, asset uploads):**

| Variable | Purpose |
|---|---|
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `OBJECT_STORAGE_KEY` | R2 S3 access key ID |
| `OBJECT_STORAGE_SECRET` | R2 S3 secret access key |
| `R2_BUCKET_ASSETS` | R2 bucket name (e.g. `grudge-assets`) |

**Cloudflare Workers AI (optional — enables image/text/vision generation):**

| Variable | Purpose |
|---|---|
| `CF_AI_API_TOKEN` | Cloudflare API token with Workers AI Read + Edit permissions |

**Optional:**

| Variable | Purpose |
|---|---|
| `OBJECT_STORAGE_PUBLIC_URL` | Public R2 CDN URL (e.g. `https://assets.grudge-studio.com`) |
| `PUTER_SITE_ORIGIN` | Puter sign-in origin (default `https://puter.com`) |
| `PUTER_BASE_PATH` | Puter app base path (default `/grudge-gameforge`) |
| `PUTER_API_BASE` | Puter API base URL (default `https://api.puter.com`) |
| `ENABLE_PUTER_CLOUD` | Enable Puter cloud storage features (`true`/`false`) |
| `GRUDGE_AUTH_URL` | URL for the wider Grudge auth page (id.grudge-studio.com) |

## DB Migrations

The Forge tables (`forge_*`) live in a shared Grudge Postgres database alongside ~65 other tables. Migrations are **idempotent** (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`) and run:

- **On boot** — before `app.listen()`, fatal on failure
- **In CI** — via `migrate:dryrun` in a temporary schema with seeded production data

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full migration strategy.

## Deployment

| Artifact | Target | URL |
|---|---|---|
| game-forge (editor SPA) | Vercel (native GitHub integration) | `forge.grudge-studio.com` |
| api-server | Railway (Docker) | `forge-api.grudge-studio.com` |
| game-forge-desktop | Local build / future R2 hosting | — |
| player | Embedded in editor | Single-file HTML export |

### CI

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | push/PR to `main` | Typecheck, test, migration dry-run |

Vercel and Railway auto-deploy on push via their native GitHub integrations — no Actions-based deploy workflows.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment architecture and environment variables.

## Part of Grudge Studio

- **[grudge-studio.com](https://grudge-studio.com)** — Platform hub
- **[dash.grudge-studio.com](https://dash.grudge-studio.com)** — Admin dashboard
- **[grudgewarlords.com](https://grudgewarlords.com)** — Grudge Warlords game client
- **[forge.grudge-studio.com](https://forge.grudge-studio.com)** — GameForge editor (this project)

---

Created by **Racalvin The Pirate King** at Grudge Studio.
