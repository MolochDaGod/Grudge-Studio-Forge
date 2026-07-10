#!/usr/bin/env bash
# Build the game-forge SPA for production.
# Use on a machine with ≥16 GB free RAM (Vercel 8 GB OOMs; low-RAM desktops too).
#
# Usage:
#   ./scripts/build-spa.sh
#   NODE_OPTIONS=--max-old-space-size=16384 ./scripts/build-spa.sh
#
# Output: artifacts/game-forge/dist/public/

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=16384}"

echo "==> Node $(node -v)  pnpm $(pnpm -v 2>/dev/null || echo 'missing')"
echo "==> NODE_OPTIONS=$NODE_OPTIONS"

# Prefer pnpm 10 (lockfile); fall back to whatever is installed.
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.28.0 --activate 2>/dev/null || true
fi

echo "==> Install (@workspace/game-forge and deps only)"
pnpm install --filter "@workspace/game-forge..."

echo "==> Vite production build"
# exec vite directly — skips the player prebuild (saves RAM + time).
# player.html is already checked into public/ when needed.
pnpm --filter @workspace/game-forge exec vite build --config vite.config.ts

OUT="artifacts/game-forge/dist/public"
if [[ ! -f "$OUT/index.html" ]]; then
  echo "ERROR: missing $OUT/index.html" >&2
  exit 1
fi

SIZE=$(du -sh "$OUT" | awk '{print $1}')
TITLE=$(grep -oP '(?<=<title>)[^<]+' "$OUT/index.html" | head -1 || true)
echo "==> OK  $OUT  ($SIZE)  title=${TITLE:-unknown}"
