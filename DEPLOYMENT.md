# Deployment

How Grudge Forge gets from this repo onto its public URLs. Read this before
changing the Dockerfile, api-server build, CI workflow, or database migrations.

## What deploys where

| Artifact | Target | URL |
| --- | --- | --- |
| `artifacts/game-forge` | **Vercel** (static SPA) | `forge.grudge-studio.com` |
| `artifacts/api-server` | **Railway** (Docker) | `forge-api.grudge-studio.com` |
| `artifacts/game-forge-desktop` | **GitHub Releases** (NSIS `.exe` via CI) | GitHub Releases page |
| `artifacts/mockup-sandbox` | **Not deployed** (dev-only) | — |

## Platform roles

| Platform | Responsibility |
| --- | --- |
| **GitHub** | Repo hosting, CI checks (typecheck + test), GitHub Releases (desktop `.exe`) |
| **Vercel** | Frontend SPA hosting, auto-deploy on push via native GitHub integration |
| **Railway** | API server hosting (Docker), managed PostgreSQL or external DB |
| **Cloudflare** | DNS (`grudge-studio.com`), R2 object storage, Workers AI |

> GitHub is used for repo hosting, CI checks, and **GitHub Releases** for
> the Windows desktop installer. Web deployment goes through Vercel, Railway,
> and Cloudflare.

> **⚠️ Replit is deprecated.** The old `grudge-studio-forge.replit.app` deployment
> is no longer maintained. Its Object Storage references are broken (GLTF
> `scene.bin` buffer loads fail). Do NOT use it. All traffic should go to
> `forge.grudge-studio.com` (Vercel) with the API at `forge-api.grudge-studio.com`
> (Railway). Any scenes saved on Replit that reference `/api/storage/objects/`
> paths need their models re-uploaded as `.glb` files through the editor.

## Frontend — Vercel

The editor SPA (`artifacts/game-forge`) deploys to Vercel via their **native
GitHub integration** (not a GitHub Actions workflow). Vercel watches the `main`
branch and auto-deploys on push.

### Vercel project settings

| Setting | Value |
| --- | --- |
| Build command | `pnpm --filter @workspace/game-forge run build` |
| Install command | `pnpm install --frozen-lockfile` |
| Output directory | `artifacts/game-forge/dist/public` |
| Framework | Other |
| Node version | 24.x |

### Routing

Configured in `vercel.json`:

- `/api/*` → proxied to `https://forge-api.grudge-studio.com/api/*`
- `/*` → rewritten to `/index.html` (SPA client-side routing)

The frontend build is fully static — no Node process at runtime.

### Custom domain

Add `forge.grudge-studio.com` as a custom domain in the Vercel dashboard, then
point a CNAME in Cloudflare:

```
forge  CNAME  cname.vercel-dns.com  (proxied)
```

## API Server — Railway

The Express backend (`artifacts/api-server`) runs as a Docker container on
Railway. The `Dockerfile` at the repo root builds a multi-stage image:

1. **deps** — installs pnpm workspace dependencies
2. **build** — typechecks libs, bundles api-server via esbuild
3. **runtime** — slim Node 22 image with only `dist/index.mjs`

### Railway project settings

| Setting | Value |
| --- | --- |
| Source | GitHub repo (auto-deploy on push) |
| Dockerfile path | `./Dockerfile` |
| Health check | `GET /api/healthz` (returns `{"status":"ok"}`) |

### Environment variables (Railway)

Set these in the Railway service variables:

**Required:**

| Variable | Purpose |
| --- | --- |
| `PORT` | Railway injects this automatically |
| `DATABASE_URL` | Shared Grudge PostgreSQL connection string |

**R2 Storage (required for templates, AI storage, navmesh, uploads):**

| Variable | Purpose |
| --- | --- |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `OBJECT_STORAGE_KEY` | R2 S3 access key ID |
| `OBJECT_STORAGE_SECRET` | R2 S3 secret access key |
| `R2_BUCKET_ASSETS` | R2 bucket name (e.g. `grudge-assets`) |

**AI (optional):**

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude AI assistant |
| `CF_AI_API_TOKEN` | Cloudflare Workers AI (image gen, text gen, vision) |

**Puter Auth (optional):**

| Variable | Purpose |
| --- | --- |
| `PUTER_SITE_ORIGIN` | Default `https://puter.com` |
| `PUTER_BASE_PATH` | Default `/grudge-forge` |
| `PUTER_API_BASE` | Default `https://api.puter.com` |

### Custom domain

Add `forge-api.grudge-studio.com` as a custom domain in Railway, then point a
CNAME in Cloudflare:

```
forge-api  CNAME  <railway-public-hostname>  (proxied)
```

### Local development (Docker Compose)

For local/VPS development, `docker-compose.yml` spins up Postgres + the API:

```bash
cp .env.example .env   # fill in real values
docker compose up -d
```

## DNS — Cloudflare

All DNS for `grudge-studio.com` is managed in Cloudflare. Required records for
Forge:

| Record | Type | Target | Proxy |
| --- | --- | --- | --- |
| `forge` | CNAME | `cname.vercel-dns.com` | Yes |
| `forge-api` | CNAME | Railway public hostname | Yes |

## Object Storage — Cloudflare R2

Scene templates, AI snapshots, navmesh blobs, and user-uploaded assets are
stored in a Cloudflare R2 bucket (`grudge-assets`). The api-server accesses R2
via the native S3 endpoint (`https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com`).

Optional: set `OBJECT_STORAGE_PUBLIC_URL` to a public R2 CDN URL (e.g.
`https://assets.grudge-studio.com`) for direct-to-client asset serving.

## CI — GitHub Actions

Two workflows run via GitHub Actions:

**`ci.yml`** — runs on push/PR to `main` (check-only, does not deploy):
1. **Typecheck** — `pnpm run typecheck` (all workspace packages)
2. **Test** — `pnpm run test` (365 tests across 3 packages)
3. **Migration dry-run** — `pnpm --filter @workspace/db run migrate:dryrun -- --seed` (only if `DATABASE_URL` secret is set)

**`release.yml`** — runs on `v*` tag push (Windows desktop build):
1. Typechecks libs
2. Builds renderer SPA + Electron main process
3. Packages NSIS installer via electron-builder
4. Uploads `.exe` + `latest.yml` as a **draft** GitHub Release

## DB Migrations

The Forge tables (`forge_*`) live alongside ~65 other tables in a shared Grudge
PostgreSQL database. Migrations are **idempotent** (`CREATE TABLE IF NOT EXISTS`,
`ALTER TABLE ADD COLUMN IF NOT EXISTS`) and run:

- **On boot** — `src/index.ts` awaits `runMigrations()` before `app.listen()`.
  A migration failure is fatal — the server refuses to start.
- **In CI** — via `migrate:dryrun` in a temp schema (see below).

We do **not** use `drizzle-kit push` against the shared DB — its rename
heuristic would interpret unrelated tables as rename candidates.

### Adding a column

1. Update the Drizzle schema in `lib/db/src/schema/*.ts`
2. Append a guarded `ALTER TABLE … ADD COLUMN IF NOT EXISTS` to `STATEMENTS` in `lib/db/src/migrate.ts`
3. CI's dry-run gate validates the statement against seeded production data

### Migration dry-run

`pnpm --filter @workspace/db run migrate:dryrun -- --seed` creates a throwaway
schema, seeds it with production data, runs all migration statements, then drops
the schema. This catches data-incompatible migrations before they hit the real DB.

## Healthy boot

A clean api-server boot logs:

```
INFO  DB migrations applied
INFO  Scene templates ready  count=7
INFO  Server listening       port=8080
```

If you see `Fatal error during boot`, check `DATABASE_URL` and R2 credentials
before assuming code is broken.

## Offline Mode (Ollama)

The Forge can run fully offline with local AI via Ollama. A 1-click setup
script handles everything:

**Windows:**
```powershell
pwsh -File scripts/setup-offline.ps1
```

**macOS / Linux:**
```bash
bash scripts/setup-offline.sh
```

The script:
1. Installs Ollama if not found
2. Pulls `qwen2.5-coder:7b` (best for Three.js/code) and `llama3.2` (fast general)
3. Installs pnpm dependencies
4. Starts the API server + editor dev server
5. Opens the browser to `http://localhost:5173`

In the editor, select any model with a "Local" hint in the AI model picker.
Ollama models connect directly to `localhost:11434` — no server proxy needed.

### Deployment Modes

| Mode | AI | Storage | Backend | Use Case |
| --- | --- | --- | --- | --- |
| **Offline** | Ollama (local) | Local filesystem | Local Express | Development, no internet |
| **Online** | Claude + Puter + CF AI | Cloudflare R2 | Railway | Production at forge.grudge-studio.com |
| **Hybrid** | Ollama + Claude | Cloudflare R2 | Local Express | Dev with cloud storage |

## Asset Conversion

The Forge supports browser-side asset conversion (no desktop app needed):

| Input | Output | Engine |
| --- | --- | --- |
| FBX | GLB | assimpjs WASM |
| OBJ (+MTL) | GLB | assimpjs WASM |
| STL | GLB | assimpjs WASM |
| GLTF | GLB | three.js |
| ZIP | GLB[] | fflate extract + assimpjs |
| PNG/JPG/WebP | passthrough | direct R2 upload |
| JSON | passthrough | direct R2 upload |

The desktop app additionally supports GLB → OBJ/STL/FBX export and
glTF-Transform optimization (Draco, dedup, prune).

## AI Providers

| Provider | Models | Auth | Offline? |
| --- | --- | --- | --- |
| **Ollama** | qwen2.5-coder:7b, llama3.2, codellama:13b, deepseek-coder-v2:16b | None (local) | Yes |
| **Anthropic Claude** | claude-sonnet-4-6, claude-haiku-4-5 | Server-side API key | No |
| **Puter AI** | Claude 3.5/3.7, GPT-4o, Gemini 2.0, Llama 3.3, DeepSeek | Client Puter token | No |
| **Cloudflare Workers AI** | FLUX, Phoenix, SDXL, Llama 3.1, LLaVA | Server-side CF token | No |

## Desktop App — GitHub Releases

The Electron desktop app (`artifacts/game-forge-desktop`) is built and
published via GitHub Actions (`release.yml`). Pushing a `v*` tag triggers a
Windows build on `windows-latest`, which packages an NSIS installer and
uploads it as a **draft** GitHub Release with `latest.yml` for auto-updates.

### Cutting a release

```bash
# 1. Bump version in artifacts/game-forge-desktop/package.json
# 2. Commit + tag:
git add -A && git commit -m "release: v0.1.0"
git tag v0.1.0 -m "v0.1.0"
git push origin main --follow-tags
```

The workflow builds the installer and uploads it as a draft. Then:

```bash
gh release edit v0.1.0 --draft=false   # publish when ready
```

### Local build (dev/testing)

```bash
pnpm --filter @workspace/game-forge-desktop run build:win
```

The resulting `.exe` installer is in `artifacts/game-forge-desktop/dist/installer/`.

### Auto-updates

Installed clients check GitHub Releases for `latest.yml` on launch and when
the user clicks **Help → Check for Updates**. The publish config in
`electron-builder.yml` points to `MolochDaGod/Grudge-Studio-Forge`.
