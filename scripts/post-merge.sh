#!/bin/bash
# Post-merge setup. Runs with stdin closed, so every command must be
# strictly non-interactive. See `lib/db/src/migrate.ts` for why we run
# our own idempotent CREATE-IF-NOT-EXISTS migration instead of
# `drizzle-kit push` (push prompts for table renames against the shared
# Grudge database, which would silently destroy data on stdin EOF).
set -e
pnpm install --frozen-lockfile

# Workspace-wide typecheck gate. The platform's per-artifact build only
# typechecks the artifact it is building, so a cross-package regression
# (e.g. a lib change that breaks api-server) can sneak past `Publish`
# and take prod down. Running the full `pnpm run typecheck` here means
# any merge into main that breaks libs or any leaf package fails loudly
# on the post-merge hook BEFORE the deploy is triggered. `set -e` above
# guarantees a non-zero exit aborts the rest of this script.
echo "[post-merge] running workspace typecheck..."
pnpm run typecheck

# Workspace-wide test gate. Mirrors the typecheck gate above: the platform's
# per-artifact build never runs tests, so a logic regression that compiles
# cleanly (broken handler, wrong Drizzle query, regressed component) would
# otherwise sail through to prod. `pnpm run test` fans out across every
# workspace package via `pnpm -r --if-present run test`, so packages that
# don't have a `test` script are silent no-ops and packages that do fail
# loudly here. `set -e` ensures a failure aborts the rest of this script.
echo "[post-merge] running workspace tests..."
pnpm run test

pnpm --filter @workspace/db run migrate
