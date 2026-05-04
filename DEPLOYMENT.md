# Deployment

How Grudge GameForge gets from this repo onto its public URL. Skim this before
changing anything in `.replit`, `*/artifact.toml`, the api-server build, or the
post-merge hook.

## What deploys

| Artifact | Kind | Deploys? | Why |
| --- | --- | --- | --- |
| `artifacts/api-server` | api (Node/Express) | Yes | Backend for the editor. Has a `[services.production]` block. |
| `artifacts/game-forge` | web (Vite SPA) | Yes | The editor UI. Built static, served as files. |
| `artifacts/mockup-sandbox` | design (Canvas) | **No** | Dev-only component-preview tool. Intentionally has no `[services.production]`. |

The desktop app (`artifacts/game-forge-desktop`) is built and shipped as an
installer out-of-band — it is not part of the autoscale deploy.

## Deployment target & routing

Configured in the root `.replit`:

```toml
[deployment]
router = "application"
deploymentTarget = "autoscale"
```

`router = "application"` means the platform-level reverse proxy reads each
artifact's `.replit-artifact/artifact.toml` and routes by path, **most-specific
match first**:

- `/api/*` → `api-server` (Node, port 8080 internally)
- `/*` → `game-forge` (static files, with a `/* → /index.html` SPA rewrite)

There is no Express middleware proxying frontend assets in production, and the
deployed `game-forge` is static files (no Vite dev server / no Vite proxy in
the request path). The platform router handles both. The Vite dev server's
`/api` proxy in `vite.config.ts` is a local-dev convenience only and is not
involved in deploys.

## Per-artifact build & run

All deploy config lives in each artifact's `.replit-artifact/artifact.toml`.
**Do not edit the root `.replit` for artifact build/run** — only the `[deployment]`
block and ports live there.

### `artifacts/api-server`

```toml
[services.production.build]
args = ["pnpm", "--filter", "@workspace/api-server", "run", "build"]
[services.production.build.env]
NODE_ENV = "production"

[services.production.run]
args = ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
[services.production.run.env]
PORT = "8080"
NODE_ENV = "production"

[services.production.health.startup]
path = "/api/healthz"
```

- Build runs `build.mjs` (esbuild bundle to `dist/index.mjs`). Source maps
  are emitted **only** when `NODE_ENV !== "production"` — see
  `artifacts/api-server/build.mjs`. Dev builds keep `.map` files so local
  stack traces resolve; the deployed image does not ship them.
- Run uses raw `node` (not `pnpm`) for faster cold starts.
- Startup health probe: `/api/healthz` returns `{"status":"ok"}` (see
  `src/routes/health.ts`). The platform won't route traffic to a new instance
  until this returns 200.

### `artifacts/game-forge`

```toml
[services.production]
build = ["pnpm", "--filter", "@workspace/game-forge", "run", "build"]
publicDir = "artifacts/game-forge/dist/public"
serve = "static"

[[services.production.rewrites]]
from = "/*"
to = "/index.html"
```

- Vite builds to `dist/public/`. Files served directly from CDN; no Node
  process at runtime.
- The `/* → /index.html` rewrite is what makes client-side routing work.

### `artifacts/mockup-sandbox`

No `[services.production]`. Skipped at deploy time.

## DB migrations

The Forge tables (`forge_*`) live alongside ~65 other tables in a database
**shared with the rest of the Grudge ecosystem** (warlord, openrts, mmo,
store, ...). This shapes everything below.

**We do not use `drizzle-kit push` against the shared DB.** `push`'s rename
heuristic interprets every unrelated table as a candidate for being renamed
into one of ours. With stdin closed (post-merge / deploy), it would either
hang or accept a catastrophic rename. See `lib/db/src/migrate.ts` for the
long form.

Instead, `runMigrations()` (`@workspace/db/migrate`) executes a flat list of
idempotent statements:

- `CREATE TABLE IF NOT EXISTS forge_*`
- `CREATE INDEX IF NOT EXISTS …`
- `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` (when adding columns)

It can never drop or rename anything. Adding a column is a two-step edit:
update the Drizzle schema in `lib/db/src/schema/*.ts`, then append a guarded
`ALTER` to `STATEMENTS` in `migrate.ts`.

**When migrations run:**

1. **On boot** in production: `src/index.ts` awaits `runMigrations()` (in
   parallel with `seedTemplates()`) **before** `app.listen`. A migration
   failure is fatal — the server refuses to come up rather than serving
   500s from missing tables.
2. **On merge into main**: `scripts/post-merge.sh` runs
   `pnpm --filter @workspace/db run migrate` so the dev DB picks up schema
   changes the moment a branch lands, even if no deploy happens.

Because the statements are idempotent, running them in both places is safe.

## Healthy boot

A clean api-server boot logs roughly:

```
INFO  DB migrations applied
INFO  Scene templates ready  count=9
INFO  Server listening       port=8080
```

If you see `Fatal error during boot`, either Postgres or R2 is unreachable —
check `DATABASE_URL` and the R2 credentials before assuming code is broken.

## Required production env vars

`PORT` is injected by the platform (api-server reads `process.env.PORT`).
The rest are managed via the Secrets pane:

- `DATABASE_URL` — shared Grudge Postgres connection string.
- `R2_BUCKET_ASSETS` — Cloudflare R2 bucket for scene templates
  (default `grudge-assets`).
- `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — R2 S3
  credentials. The seeder (`src/lib/r2Storage.ts`) and the
  `GET /api/templates/{key}` proxy both read these.
- `ANTHROPIC_API_KEY` — only if the in-editor AI worker is enabled in prod.

The static `game-forge` build needs no runtime env vars.

## Publishing

1. Click **Publish** in the Replit workspace.
2. **Geography is permanent on first publish** — pick the right region.
3. Subsequent publishes redeploy in place. Build runs, then each api-server
   instance boots, runs migrations, passes `/api/healthz`, and starts taking
   traffic.

To check status / logs after a publish, open the Deployments pane or use the
deployment-logs tooling — search for `Server listening` to confirm a healthy
boot, or for `Fatal error during boot` / `ERROR` to triage.

## Post-merge vs deploy

Two different hooks touch the database. They serve different purposes:

| | `scripts/post-merge.sh` | Deploy boot |
| --- | --- | --- |
| Trigger | Branch merged into main | `Publish` button / autoscale cold start |
| Runs | `pnpm install --frozen-lockfile` + `pnpm run typecheck` + `pnpm --filter @workspace/db run migrate` | esbuild → `node dist/index.mjs` → `runMigrations()` → `app.listen` |
| Target DB | Dev (shared) | Prod (shared) — same physical DB in this project |
| Interactive? | No (stdin closed) | No |

Both call the same idempotent `runMigrations()`, so re-runs are no-ops. The
post-merge hook exists so dev never lags behind a schema change; the boot
hook exists so a fresh prod instance can never serve a half-migrated DB.

## Typecheck gate (pre-merge and post-merge)

The same workspace-wide `pnpm run typecheck` runs in two places, for two
different audiences:

1. **Pre-merge (per-branch):** registered as a workspace **validation** named
   `typecheck` (shell: `pnpm run typecheck`). It shows up in the workspace UI
   alongside the branch / merge controls so an author can run it — or see it
   fail — on their own branch **before** requesting a merge into main. A
   failing validation is visible at the merge step; fix it on the branch
   instead of finding out from a red post-merge hook.
2. **Post-merge (safety net):** `scripts/post-merge.sh` re-runs
   `pnpm run typecheck` after `pnpm install` and **before**
   `pnpm --filter @workspace/db run migrate`. Because the script is `set -e`,
   a typecheck failure exits non-zero, the post-merge hook is recorded as
   failed, and the publish flow surfaces it in the merge / deploy log
   instead of silently shipping a broken build. This still matters for
   hot-fixes or out-of-band merges that bypass the per-branch validation.

**Why it lives here, not in `[deployment.postBuild]`:**

- The platform's per-artifact build (`artifact.toml` `build = ...`) only
  typechecks the artifact it is currently building. A regression in
  `lib/db` that breaks `api-server` would pass the `game-forge` build and
  could still ship.
- `pnpm run typecheck` covers `tsc --build` for every composite lib **plus**
  `tsc --noEmit` for every leaf workspace package (api-server, game-forge,
  game-forge-desktop, mockup-sandbox, scripts). One command, one gate.
- Wiring the same command into both the pre-merge validation and the
  post-merge hook means the gate fires while the author can still fix it on
  their own branch, *and* again the moment a branch lands on main — before
  the deploy is triggered.

### Where to look when it fails

- **On your branch (pre-merge):** open the `typecheck` validation in the
  workspace UI. The run summary lists the failing command and links to its
  log. You can also reproduce locally with `pnpm run typecheck` from the
  repo root.
- **After merge (post-merge):** check the post-merge hook log for the
  `[post-merge] running workspace typecheck...` line — anything below it is
  the failing `tsc` output. The merge will be marked failed and the deploy
  will not proceed.
- **In a deploy that's already on fire:** suspect a typecheck regression
  that slipped in via a hot-fix that bypassed both gates. Re-run
  `pnpm run typecheck` locally to confirm, then patch forward.

## Out of scope here

- Switching deployment target away from `autoscale`.
- Restructuring artifact routing.
