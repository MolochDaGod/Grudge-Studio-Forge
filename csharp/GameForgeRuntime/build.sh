#!/usr/bin/env bash
# Builds the GameForge .NET runtime for Blazor WebAssembly and copies the
# published _framework/ output into artifacts/game-forge/public/_framework/
# so the Vite dev/build pipeline serves it as static assets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST_DIR="$REPO_ROOT/artifacts/game-forge/public/_framework"

# Replit's Nix environment ships a read-only dotnet SDK, so we use the
# user-local install at $HOME/.dotnet that the agent provisioned via
# dotnet-install.sh. ICU is unavailable, so invariant globalization is forced.
export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

cd "$SCRIPT_DIR"
dotnet publish -c Release --nologo -v minimal

# The Blazor publish target writes the framework files to two places. Prefer
# the publish/wwwroot path when present, fall back to the build wwwroot.
SRC_DIR=""
for cand in \
  "$SCRIPT_DIR/bin/Release/net8.0/publish/wwwroot/_framework" \
  "$SCRIPT_DIR/bin/Release/net8.0/wwwroot/_framework"; do
  if [ -d "$cand" ] && [ -f "$cand/blazor.boot.json" ]; then
    SRC_DIR="$cand"
    break
  fi
done

if [ -z "$SRC_DIR" ]; then
  echo "publish failed: no _framework/blazor.boot.json found" >&2
  exit 1
fi

rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"
cp -R "$SRC_DIR"/. "$DEST_DIR"/

# Strip artifacts the browser does not need: pre-gzipped duplicates (the dev
# server and Replit proxy already negotiate compression) and source maps.
# DO NOT strip *.pdb — `blazor.boot.json` lists every PDB as a "resources.pdb"
# entry and the runtime tries to fetch each up-front; a missing PDB makes
# `dotnet.create()` fail with "TypeError: Failed to fetch" before any user
# code runs. Disabling debugger support in the csproj does not stop the
# Blazor publish target from emitting these references.
find "$DEST_DIR" -name "*.gz" -delete
find "$DEST_DIR" -name "*.map" -delete

echo "GameForge runtime published to $DEST_DIR"
echo "files: $(find "$DEST_DIR" -type f | wc -l)"
echo "size:  $(du -sh "$DEST_DIR" | cut -f1)"
