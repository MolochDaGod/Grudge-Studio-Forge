#!/bin/bash
# Post-merge setup. Runs with stdin closed, so every command must be
# strictly non-interactive. See `lib/db/src/migrate.ts` for why we run
# our own idempotent CREATE-IF-NOT-EXISTS migration instead of
# `drizzle-kit push` (push prompts for table renames against the shared
# Grudge database, which would silently destroy data on stdin EOF).
set -e
# pipefail so the typecheck pipeline below propagates `pnpm`'s exit
# status instead of `tee`'s — without it, a failing typecheck would
# silently fall through to the migration step.
set -o pipefail
pnpm install --frozen-lockfile

# Merge-blocking typecheck gate. The same `pnpm run typecheck` is also
# registered as a pre-merge workspace validation (`isValidation = true`)
# for visibility on the author's branch, but THIS hook is the layer that
# actually fails the merge: a non-zero exit here is recorded by the
# platform as a failed merge, so DB migrations are skipped and the
# deploy is not triggered. See DEPLOYMENT.md ("Typecheck gate").
TYPECHECK_LOG="/tmp/post-merge-typecheck.log"
echo "[post-merge] running workspace typecheck (merge-blocking gate)..."
if ! pnpm run typecheck 2>&1 | tee "$TYPECHECK_LOG"; then
  echo ""
  echo "============================================================"
  echo "[post-merge] MERGE BLOCKED: workspace typecheck failed."
  echo "[post-merge] DB migrations skipped; deploy will not run."
  echo "[post-merge] Full output: $TYPECHECK_LOG"
  echo "[post-merge] Reproduce locally: pnpm run typecheck"
  echo "============================================================"
  exit 1
fi

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
