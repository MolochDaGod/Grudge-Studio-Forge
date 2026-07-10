#!/usr/bin/env bash
# rsync built SPA to a VPS (nginx static origin).
#
# Prerequisites:
#   - ./scripts/build-spa.sh already succeeded
#   - SSH access to VPS
#   - nginx site from deploy/nginx-forge-origin.conf installed
#
# Env (or args):
#   FORGE_VPS_HOST   e.g. root@vps.grudge-studio.com  or  user@1.2.3.4
#   FORGE_VPS_PATH   default /var/www/forge-origin
#
# Usage:
#   FORGE_VPS_HOST=user@vps ./scripts/deploy-spa-vps.sh
#   ./scripts/deploy-spa-vps.sh user@vps /var/www/forge-origin

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/artifacts/game-forge/dist/public"

HOST="${1:-${FORGE_VPS_HOST:-}}"
REMOTE="${2:-${FORGE_VPS_PATH:-/var/www/forge-origin}}"

if [[ -z "$HOST" ]]; then
  echo "Usage: FORGE_VPS_HOST=user@host $0" >&2
  echo "   or: $0 user@host [/var/www/forge-origin]" >&2
  exit 1
fi

if [[ ! -f "$OUT/index.html" ]]; then
  echo "ERROR: build missing. Run ./scripts/build-spa.sh first." >&2
  exit 1
fi

echo "==> rsync $OUT/ → $HOST:$REMOTE/"
ssh "$HOST" "mkdir -p '$REMOTE'"
rsync -avz --delete \
  --exclude '.DS_Store' \
  "$OUT/" \
  "$HOST:$REMOTE/"

echo "==> Done. Point Worker ORIGIN at this host's public HTTPS URL, e.g.:"
echo "    https://forge-origin.grudge-studio.com"
echo "    (see DEPLOYMENT.md → Build on VPS / second PC)"
