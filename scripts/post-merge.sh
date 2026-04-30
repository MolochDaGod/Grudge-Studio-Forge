#!/bin/bash
# Post-merge setup. Runs with stdin closed, so every command must be
# strictly non-interactive. See `lib/db/src/migrate.ts` for why we run
# our own idempotent CREATE-IF-NOT-EXISTS migration instead of
# `drizzle-kit push` (push prompts for table renames against the shared
# Grudge database, which would silently destroy data on stdin EOF).
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run migrate
