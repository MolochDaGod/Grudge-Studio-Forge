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
| Runs | `pnpm install --frozen-lockfile` + `pnpm run typecheck` + `pnpm run test` + `pnpm --filter @workspace/db run migrate:dryrun -- --seed` + `pnpm --filter @workspace/db run migrate` | esbuild → `node dist/index.mjs` → `runMigrations()` → `app.listen` |
| Target DB | Dev (shared) | Prod (shared) — same physical DB in this project |
| Interactive? | No (stdin closed) | No |

Both call the same idempotent `runMigrations()`, so re-runs are no-ops. The
post-merge hook exists so dev never lags behind a schema change; the boot
hook exists so a fresh prod instance can never serve a half-migrated DB.

## Pre-merge / post-merge gates (typecheck + test + migrate-dryrun)

The same workspace-wide `pnpm run typecheck`, `pnpm run test`, and `pnpm --filter @workspace/db run migrate:dryrun -- --seed` each run in two places, for two different audiences. Together they form a **merge-blocking gate** — a red gate stops the merge rather than just flagging it.

Note on the split: the platform here does not expose a per-validation "block the merge button" toggle — `WorkflowMetadata` in `.replit` only supports `isValidation`. So the pre-merge validations are visibility-only (red status next to the merge controls, but the merge button is not itself disabled), and the **post-merge hook is the real enforcement layer**: a non-zero exit there is recorded by the platform as a failed merge, DB migrations are skipped, and the deploy is not triggered.

1. **Pre-merge visibility (per-branch):** registered as workspace **validations** named `typecheck` (shell: `pnpm run typecheck`), `test` (shell: `pnpm run test`), and `migrate-dryrun` (shell: `pnpm --filter @workspace/db run migrate:dryrun -- --seed`) with `isValidation = true` in `.replit`. They show up in the workspace UI next to the branch / merge controls so an author can run them — or see them fail — on their own branch **before** requesting a merge. The merge UI surfaces the failing run and links to its log so the author can fix it on the branch instead of finding out at the post-merge step.
2. **Post-merge enforcement (the actual block):** `scripts/post-merge.sh` re-runs `pnpm run typecheck`, `pnpm run test`, and `pnpm --filter @workspace/db run migrate:dryrun -- --seed` after `pnpm install` and **before** the real `pnpm --filter @workspace/db run migrate`. On failure the script:
   - exits non-zero (`set -e` plus `set -o pipefail` so the `tee` pipeline doesn't mask `pnpm`'s exit code), so the platform records the merge as **failed**, the merge UI shows it as blocked with a link to this run's log, and the deploy is **not** triggered;
   - prints an explicit `MERGE BLOCKED` banner with the path to the full log (e.g., `/tmp/post-merge-typecheck.log`, `/tmp/post-merge-migrate-dryrun.log`) and the exact command to reproduce locally (`pnpm run typecheck`, `pnpm run test`, or `pnpm --filter @workspace/db run migrate:dryrun -- --seed`);
   - **skips the real DB migration step**, so a regression can never apply schema changes to the shared Grudge DB.

This is the layer that makes the gate enforceable rather than advisory: even if the pre-merge validation is ignored, or a hot-fix bypasses the per-branch check, the post-merge hook will still block the merge from reaching main / production.

All three validations show up in the workspace UI alongside the branch / merge
controls. A failing validation is visible at the merge step; fix it on the
branch instead of finding out from a red post-merge hook.

`scripts/post-merge.sh` is `set -e`, so a failure in any gate exits
non-zero, the post-merge hook is recorded as failed, and the publish flow
surfaces it in the merge / deploy log instead of silently shipping a broken
build. The order is: `pnpm install` → `pnpm run typecheck` →
`pnpm run test` → `pnpm --filter @workspace/db run migrate:dryrun -- --seed` →
`pnpm --filter @workspace/db run migrate`.

### Migration dry-run gate

Why this gate exists: the typecheck gate catches schema/code drift, but a
malformed `CREATE TABLE` literal, a typo in a guarded `ALTER TABLE … ADD
COLUMN IF NOT EXISTS`, or a CASCADE/REFERENCES that conflicts with existing
shape will all *typecheck cleanly* — they only blow up when the migration
runner actually executes them. Without this gate, that failure surfaces
post-merge, after the typecheck and test gates have already let the merge
through, and can leave dev half-migrated (some statements applied, the bad
one rolled back, subsequent statements never reached).

How it works: `pnpm --filter @workspace/db run migrate:dryrun -- --seed`
runs `lib/db/src/migrate-dryrun-cli.ts`, which:

1. Connects with the same `DATABASE_URL` / `pg` pool the app uses (so any
   TLS / pooling / network issue surfaces the same way it would in prod).
2. Creates a unique throwaway schema (`forge_migrate_dryrun_<pid>_<rand>`).
3. **Seeds the temp schema with representative production data** (only
   when `--seed` is passed; both pre-merge validation and post-merge
   hook do). For every `public.forge_*` table that currently exists,
   the CLI runs:
   - `CREATE TABLE "<temp>".<t> (LIKE public.<t> INCLUDING ALL)` — copies
     columns, defaults, identity, check constraints, primary key, and
     indexes. Foreign keys are deliberately NOT copied (they aren't
     part of the `LIKE` clause), so a partial `LIMIT N` sample never
     trips an FK check during INSERT.
   - `INSERT INTO "<temp>".<t> SELECT * FROM public.<t> LIMIT N`
     (default 100, override with `--seed-rows=<N>`).
4. Calls `runMigrations()` with `{ searchPath: <temp schema> }`. Because
   every statement in `STATEMENTS` references unqualified relation names
   (`forge_projects`, `REFERENCES forge_projects(id)`, …), they all resolve
   inside the temp schema. With seeding on, `CREATE TABLE IF NOT EXISTS`
   no-ops on the seeded copies and any `ALTER TABLE … ADD COLUMN IF NOT
   EXISTS` lands on a *populated* table — so a guarded `ADD COLUMN ...
   NOT NULL` without a default (or any other constraint that conflicts
   with existing rows) fails on the author's branch instead of
   half-applying post-merge. New tables that don't yet exist in
   `public` are still created empty by `CREATE TABLE IF NOT EXISTS`,
   exactly as before.
5. `DROP SCHEMA "<temp>" CASCADE` in `finally`, then `pool.end()`. The
   cleanup runs even if a statement crashed mid-run, so a failing dry-run
   never leaves dangling tables (or seeded copies) behind.

Without `--seed`, the temp schema starts empty: every `CREATE TABLE`
succeeds and every `ALTER` lands on a zero-row table. That still
catches syntax errors and broken FK targets but cannot catch
data-incompatible migrations — which is why both gates pass `--seed`.

#### Seeding from a separate prod database (`--seed-from`)

The `--seed` path above is faithful **only as long as dev and prod
share one physical database**, which is true for the current autoscale
setup. The moment Forge moves to a separate prod DB (read replica,
logical replica, isolated cluster), seeding from `public.forge_*` on
`DATABASE_URL` silently regresses to "data-incompatible against dev
only" — the gate would still pass `--seed`, but the rows it samples
are dev-only and a `NOT NULL ADD COLUMN` that conflicts with real
prod data would sail through.

To keep the gate honest as the data model diverges, the CLI accepts a
read-only source pointer:

- `--seed-from=<connection-url>` (CLI flag), or
- `MIGRATE_DRYRUN_SEED_DATABASE_URL=<connection-url>` (env var).

When set, the CLI opens a *second* `pg.Pool` against that connection
string and uses it as the source of truth for table discovery, column
shape, and row sampling — instead of the local `public.forge_*`. The
target temp schema still lives in `DATABASE_URL` (i.e. the dev DB), so
no write permission on the prod replica is required. Two safeguards
make the source connection genuinely read-only:

- The session immediately runs
  `SET default_transaction_read_only = on`. Any accidental write
  attempt against the source fails with a clear `read-only
  transaction` error from Postgres.
- The source pool is capped at `max: 1`. The CLI uses exactly one
  client and the pool is short-lived, so a per-connection quota on a
  prod replica is not a concern.

Mechanically, for every `forge_*` table that exists in the source's
`public` schema, the CLI:

1. Introspects columns from `pg_catalog.pg_attribute` /
   `pg_catalog.format_type`. The temp table is built with the
   *source's* column names, types, and `NOT NULL` constraints — not
   the target DB's. A divergent type or nullability constraint gets
   exercised by the migration, which is exactly the point.
2. Issues `CREATE TABLE "<temp>".<t> (col1 type1 [NOT NULL], …)` in
   the target DB. Defaults, identity, indexes, primary key, and
   foreign keys are deliberately omitted — same posture as the
   single-DB `LIKE` path's intentional FK exclusion. Migrations that
   ADD a PK / index / constraint will still run against the seeded
   rows and surface conflicts.
3. `SELECT`s up to `--seed-rows=<N>` rows from the source and
   re-INSERTs them into the temp schema via parameterized batches.
   `jsonb` / `json` values come back from the `pg` driver as parsed
   JS values and are re-serialized before binding; everything else
   (numbers, strings, `Date`, `Buffer`, native arrays for `text[]`)
   round-trips through the driver as-is.

Operational pattern (post-split): set
`MIGRATE_DRYRUN_SEED_DATABASE_URL` in the workspace Secrets pane,
pointing at a prod read replica with the standard `forge_*` tables.
Both the pre-merge `migrate-dryrun` validation and the post-merge
hook will pick it up automatically — the existing
`pnpm --filter @workspace/db run migrate:dryrun -- --seed` invocation
in `.replit` and `scripts/post-merge.sh` does not need to change.
Reproduce locally with:

```sh
MIGRATE_DRYRUN_SEED_DATABASE_URL=<prod-replica-url> \
  pnpm --filter @workspace/db run migrate:dryrun -- --seed
```

or, equivalently, with the explicit flag:

```sh
pnpm --filter @workspace/db run migrate:dryrun -- \
  --seed --seed-from=<prod-replica-url>
```

The run log distinguishes the two modes: the `seed-source=external`
field on the schema-creation line (and the `from external prod source
(--seed-from)` suffix on the seeded-table count) confirms the prod
sample was used. With neither the flag nor the env var set, behaviour
is unchanged: the legacy single-DB `LIKE INCLUDING ALL` +
`INSERT … SELECT * FROM public.<t>` path runs as before.

Defensive guard: if `MIGRATE_DRYRUN_SEED_DATABASE_URL` is set but
`--seed` was not passed on the CLI, the run exits non-zero rather
than silently ignoring the prod sample source — that combination
almost always indicates a misconfigured invocation.

#### Stale schema sweeper

Step 4's `finally` runs in 99% of cases. The 1% it doesn't is when the
Node process is taken out hard between the `CREATE SCHEMA` and the
`finally` — SIGKILL from an OOM, container eviction, the CI runner
being yanked, or a hung pg client that survives `pool.end()`. In those
cases the temp schema is left behind in the shared Grudge DB. The
table contents are isolated from `public.forge_*` so they're harmless,
but they accumulate and clutter `\dn` output.

To keep things tidy, every dry-run runs `sweepStaleDryRunSchemas()`
(`lib/db/src/migrate-dryrun-sweeper.ts`) **before** creating its own
schema. The sweeper:

1. Lists every `forge_migrate_dryrun_*` schema in the current DB.
2. For each one, tries `pg_try_advisory_lock(<key>)` where the key is
   a deterministic FNV-1a hash of the schema name. The live dry-run
   holds that same advisory lock for the lifetime of its session
   (released automatically by Postgres when the connection closes,
   even on a hard crash) — so a successful `try_lock` proves no live
   owner exists and the schema is orphaned.
3. `DROP SCHEMA … CASCADE`s the orphans. Schemas owned by a parallel
   in-flight dry-run on another runner are skipped.

A sweeper failure is downgraded to a `WARN` and never blocks the real
dry-run — the gate exists to catch broken migrations, not to flake on
a transient connection blip during housekeeping. Sweeper output is
prefixed `migrate-dryrun · sweeper` in the run log.

Why a temp **schema** and not a temp **database**: creating a database
requires `CREATEDB` on the role; the shared Grudge role does not have it.
Schemas only need `USAGE` / `CREATE` on the current DB, which the app role
already has. The trade-off is that the dry-run shares a connection pool
and DB-level config with production data, so it can still surface
realistic failures (extension availability, role-level permission errors,
etc.) without needing to provision a separate database.

Pre-merge visibility comes from the `migrate-dryrun` validation
(`isValidation = true`) registered in `.replit`; post-merge enforcement
comes from the `migrate-dryrun` step in `scripts/post-merge.sh`, which
runs **before** the real `pnpm --filter @workspace/db run migrate`. A
failing dry-run prints a `MERGE BLOCKED` banner, captures the full output
to `/tmp/post-merge-migrate-dryrun.log`, and exits non-zero — the platform
records the merge as failed, the real migration is skipped, and the
deploy is not triggered.

Reproduce locally: `pnpm --filter @workspace/db run migrate:dryrun -- --seed`
(needs `DATABASE_URL` set).

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
