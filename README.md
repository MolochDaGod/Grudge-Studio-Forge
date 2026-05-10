# Grudge GameForge

Three.js scene editor, physics engine & AI-assisted game builder — by [Grudge Studio](https://grudge-studio.com).

## What Is This

GameForge is the core creation tool in the Grudge ecosystem. It lets you build, test, and publish 3D scenes and game levels directly in the browser or as a native Windows desktop app.

**Web Editor** — `forge.grudge-studio.com`
**Desktop App** — Download from [Releases](https://github.com/MolochDaGod/Grudge-Studio-Forge/releases)

## Features

- **Visual Scene Editor** — drag-and-drop 3D objects, transform gizmos, hierarchy panel, property inspector
- **Three.js / React Three Fiber** — full R3F pipeline with post-processing (bloom, SSAO, DOF)
- **Rapier Physics** — rigid bodies, colliders, joints, raycasting — all configurable in the editor
- **AI Assistant** — Anthropic-powered in-editor AI that generates scenes, writes scripts, and explains code
- **Monaco Code Editor** — embedded TypeScript editor for custom scripts and behaviors
- **Scene Templates** — 9+ starter templates seeded from R2 storage
- **Asset Pipeline** — FBX→GLB conversion, glTF-Transform optimization (desktop), Uppy upload to R2
- **Embeddable Player** — publish scenes as standalone single-file HTML
- **Desktop App** — Electron wrapper with local file access, FBX import, and auto-updates

## Architecture

```
Grudge-Studio-Forge/
├── artifacts/
│   ├── game-forge/          # Editor SPA (Vite + R3F + Rapier + Monaco)
│   ├── api-server/          # Express backend (Drizzle, R2, Anthropic AI)
│   ├── game-forge-desktop/  # Electron Windows app
│   ├── player/              # Embeddable scene runtime
│   └── mockup-sandbox/      # Dev-only design tool
├── lib/
│   ├── scene-schema/        # Zod schema for scene graph
│   ├── scene-templates/     # Built-in scene templates
│   ├── api-client-react/    # React Query hooks for the API
│   ├── api-zod/             # Shared API validation schemas
│   ├── api-spec/            # API route definitions
│   ├── db/                  # Drizzle ORM schema + migrations
│   ├── desktop-bridge/      # IPC bridge for Electron ↔ renderer
│   └── object-storage-web/  # R2/S3 upload via Uppy
└── scripts/                 # Build & merge utilities
```

## Tech Stack

| Layer | Tech |
|---|---|
| 3D Engine | Three.js 0.184, React Three Fiber, drei, three-mesh-bvh |
| Physics | Rapier 3D (WASM), @react-three/rapier |
| State | Zustand, Immer, Miniplex (ECS), XState |
| AI | Anthropic Claude (in-editor assistant) |
| UI | Radix UI, Tailwind CSS, shadcn/ui, cmdk, Framer Motion |
| Code Editor | Monaco Editor |
| Backend | Express 5, Drizzle ORM, PostgreSQL, Cloudflare R2 |
| Desktop | Electron 33, electron-builder, electron-updater |
| Build | Vite 7, pnpm workspaces, esbuild |
| AI Pathfinding | Yuka, recast-navigation |

## Local Development

```bash
# Prerequisites: Node.js 24+, pnpm 10+
pnpm install

# Run editor + API server in parallel
pnpm --filter @workspace/api-server run dev &
pnpm --filter @workspace/game-forge run dev

# Run desktop app (requires Windows)
pnpm --filter @workspace/game-forge-desktop run dev
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `R2_BUCKET_ASSETS` | Cloudflare R2 bucket name |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 S3 access key |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret key |
| `ANTHROPIC_API_KEY` | Anthropic API key (for AI assistant) |

## Deployment

| Artifact | Target | URL |
|---|---|---|
| game-forge (editor) | Vercel | `forge.grudge-studio.com` |
| api-server | Railway / VPS | `forge-api.grudge-studio.com` |
| game-forge-desktop | GitHub Releases | `.exe` installer |
| player | Embedded in editor | Single-file HTML export |

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment architecture.

## Downloads

Get the latest Windows installer from [GitHub Releases](https://github.com/MolochDaGod/Grudge-Studio-Forge/releases).

## Part of Grudge Studio

GameForge is one service in the Grudge Studio ecosystem:

- **[grudge-studio.com](https://grudge-studio.com)** — Platform hub
- **[dash.grudge-studio.com](https://dash.grudge-studio.com)** — Admin dashboard
- **[grudgewarlords.com](https://grudgewarlords.com)** — Grudge Warlords game client
- **[forge.grudge-studio.com](https://forge.grudge-studio.com)** — GameForge editor (this project)

---

Created by **Racalvin The Pirate King** at Grudge Studio.
