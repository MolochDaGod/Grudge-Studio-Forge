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

# Merge-blocking migration dry-run gate. Same pattern as the typecheck
# and test gates: a pre-merge `migrate-dryrun` validation gives the
# author visibility on their branch, and THIS hook is the layer that
# actually fails the merge. Applies the same idempotent STATEMENTS list
# the boot-time runner uses, but against an ephemeral schema in the
# shared Grudge DB (see lib/db/src/migrate-dryrun-cli.ts) so a broken
# CREATE TABLE / guarded ALTER never half-applies against `public`.
# A failure here exits non-zero, the platform records the merge as
# failed, the real `migrate` step below is skipped, and the deploy is
# not triggered. See DEPLOYMENT.md ("Migration dry-run gate").
DRYRUN_LOG="/tmp/post-merge-migrate-dryrun.log"
echo "[post-merge] running migration dry-run (merge-blocking gate)..."
if ! pnpm --filter @workspace/db run migrate:dryrun -- --seed 2>&1 | tee "$DRYRUN_LOG"; then
  echo ""
  echo "============================================================"
  echo "[post-merge] MERGE BLOCKED: migration dry-run failed."
  echo "[post-merge] Real DB migration skipped; deploy will not run."
  echo "[post-merge] Full output: $DRYRUN_LOG"
  echo "[post-merge] Reproduce locally: pnpm --filter @workspace/db run migrate:dryrun -- --seed"
  echo "============================================================"
  exit 1
fi

pnpm --filter @workspace/db run migrate
