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
| Runs | `pnpm install --frozen-lockfile` + `pnpm run typecheck` + `pnpm run test` + `pnpm --filter @workspace/db run migrate` | esbuild → `node dist/index.mjs` → `runMigrations()` → `app.listen` |
| Target DB | Dev (shared) | Prod (shared) — same physical DB in this project |
| Interactive? | No (stdin closed) | No |

Both call the same idempotent `runMigrations()`, so re-runs are no-ops. The
post-merge hook exists so dev never lags behind a schema change; the boot
hook exists so a fresh prod instance can never serve a half-migrated DB.

## Pre-merge / post-merge gates (typecheck + test)

The same workspace-wide `pnpm run typecheck` and `pnpm run test` run in two places each, for two different audiences. Together they form a **merge-blocking gate** — a red gate stops the merge rather than just flagging it.

Note on the split: the platform here does not expose a per-validation "block the merge button" toggle — `WorkflowMetadata` in `.replit` only supports `isValidation`. So the pre-merge validations are visibility-only (red status next to the merge controls, but the merge button is not itself disabled), and the **post-merge hook is the real enforcement layer**: a non-zero exit there is recorded by the platform as a failed merge, DB migrations are skipped, and the deploy is not triggered.

1. **Pre-merge visibility (per-branch):** registered as workspace **validations** named `typecheck` (shell: `pnpm run typecheck`) and `test` (shell: `pnpm run test`) with `isValidation = true` in `.replit`. They show up in the workspace UI next to the branch / merge controls so an author can run them — or see them fail — on their own branch **before** requesting a merge. The merge UI surfaces the failing run and links to its log so the author can fix it on the branch instead of finding out at the post-merge step.
2. **Post-merge enforcement (the actual block):** `scripts/post-merge.sh` re-runs `pnpm run typecheck` and `pnpm run test` after `pnpm install` and **before** `pnpm --filter @workspace/db run migrate`. On failure the script:
   - exits non-zero (`set -e` plus `set -o pipefail` so the `tee` pipeline doesn't mask `pnpm`'s exit code), so the platform records the merge as **failed**, the merge UI shows it as blocked with a link to this run's log, and the deploy is **not** triggered;
   - prints an explicit `MERGE BLOCKED` banner with the path to the full log (e.g., `/tmp/post-merge-typecheck.log`) and the exact command to reproduce locally (`pnpm run typecheck` or `pnpm run test`);
   - **skips the DB migration step**, so a regression can never apply schema changes to the shared Grudge DB.

This is the layer that makes the gate enforceable rather than advisory: even if the pre-merge validation is ignored, or a hot-fix bypasses the per-branch check, the post-merge hook will still block the merge from reaching main / production.

Both validations show up in the workspace UI alongside the branch / merge
controls. A failing validation is visible at the merge step; fix it on the
branch instead of finding out from a red post-merge hook.

`scripts/post-merge.sh` is `set -e`, so a failure in either gate exits
non-zero, the post-merge hook is recorded as failed, and the publish flow
surfaces it in the merge / deploy log instead of silently shipping a broken
build. The order is: `pnpm install` → `pnpm run typecheck` →
`pnpm run test` → `pnpm --filter @workspace/db run migrate`.

**Why these live here, not in `[deployment.postBuild]`:**

- The platform's per-artifact build (`artifact.toml` `build = ...`) only
  typechecks the artifact it is currently building, and never runs tests at
  all. A regression in `lib/db` that breaks `api-server`, or a broken
  Drizzle query that still compiles, would pass the `game-forge` build and
  could still ship.
- `pnpm run typecheck` covers `tsc --build` for every composite lib **plus**
  `tsc --noEmit` for every leaf workspace package (api-server, game-forge,
  game-forge-desktop, mockup-sandbox, scripts). One command, one gate.
- `pnpm run test` is `pnpm -r --workspace-concurrency=4 --if-present run test`.
  It fans out across every workspace package in parallel (concurrency 4 to
  keep the gate usable on every branch), and `--if-present` means packages
  without a `test` script are silent no-ops. Adding tests to a package is a
  one-line `package.json` edit — no further wiring needed; the gate picks
  it up automatically.
- Wiring the same commands into both the pre-merge validations and the
  post-merge hook means each gate fires while the author can still fix it
  on their own branch, *and* again the moment a branch lands on main —
  before the deploy is triggered.

### Where to look when it fails

- **On your branch (pre-merge):** open the `typecheck` or `test` validation
  in the workspace UI. The run summary lists the failing command and links
  to its log. Reproduce locally with `pnpm run typecheck` or `pnpm run test`
  from the repo root.
- **After merge (post-merge):** check the post-merge hook log for the
  `[post-merge] running workspace typecheck (merge-blocking gate)...` or
  `[post-merge] running workspace tests (merge-blocking gate)...`
  line — anything below it is the failing output, capped by a
  `MERGE BLOCKED` banner. The merge is recorded as failed in the workspace
  UI, DB migrations are skipped, and the deploy does not run. The full
  output is also captured to `/tmp/post-merge-typecheck.log` (or similar).
- **In a deploy that's already on fire:** suspect a regression that slipped
  in via a hot-fix that bypassed both gates. Re-run `pnpm run typecheck`
  and `pnpm run test` locally to confirm, then patch forward.

## Out of scope here

- Switching deployment target away from `autoscale`.
- Restructuring artifact routing.
