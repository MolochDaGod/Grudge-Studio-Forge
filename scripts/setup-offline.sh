#!/usr/bin/env bash
# Grudge GameForge — 1-click offline setup (macOS / Linux)
# Installs Ollama, pulls recommended models, and starts the editor locally.
#
# Usage:
#   bash scripts/setup-offline.sh

set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
step()  { printf "\n${CYAN}>> %s${NC}\n" "$1"; }
ok()    { printf "   ${GREEN}OK: %s${NC}\n" "$1"; }
warn()  { printf "   ${YELLOW}WARN: %s${NC}\n" "$1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# ── 1. Check/Install Ollama ──────────────────────────────────────────

step "Checking for Ollama..."
if command -v ollama &>/dev/null; then
    ok "Ollama found at $(command -v ollama)"
else
    step "Installing Ollama..."
    if curl -fsSL https://ollama.com/install.sh | sh; then
        ok "Ollama installed"
    else
        warn "Auto-install failed. Install manually: https://ollama.com/download"
        exit 1
    fi
fi

# ── 2. Start Ollama service ──────────────────────────────────────────

step "Starting Ollama service..."
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    ok "Ollama is already running"
else
    ollama serve &>/dev/null &
    OLLAMA_PID=$!
    sleep 3
    if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
        ok "Ollama service started (PID $OLLAMA_PID)"
    else
        warn "Could not start Ollama. Run 'ollama serve' manually."
    fi
fi

# ── 3. Pull recommended models ───────────────────────────────────────

step "Pulling AI models (first run may take a few minutes)..."
for model in qwen2.5-coder:7b llama3.2; do
    printf "   Pulling %s..." "$model"
    if ollama pull "$model" >/dev/null 2>&1; then
        printf " ${GREEN}done${NC}\n"
    else
        printf " ${YELLOW}failed (run: ollama pull %s)${NC}\n" "$model"
    fi
done

# ── 4. Check Node.js / pnpm ─────────────────────────────────────────

step "Checking Node.js and pnpm..."
if ! command -v node &>/dev/null; then
    warn "Node.js not found. Install Node.js 22+ from https://nodejs.org"
    exit 1
fi
ok "Node.js $(node --version)"

if ! command -v pnpm &>/dev/null; then
    printf "   Installing pnpm...\n"
    npm install -g pnpm >/dev/null 2>&1
fi
ok "pnpm $(pnpm --version)"

# ── 5. Install dependencies ─────────────────────────────────────────

step "Installing dependencies..."
cd "$PROJECT_ROOT"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
ok "Dependencies installed"

# ── 6. Start dev servers ─────────────────────────────────────────────

step "Starting Grudge GameForge..."
echo ""
echo "   Editor:     http://localhost:5173"
echo "   API Server: http://localhost:8080"
echo "   Ollama:     http://localhost:11434"
echo ""
echo "   Select 'Qwen 2.5 Coder 7B' or 'Llama 3.2 3B' in the AI model picker"
echo "   for fully offline AI assistance."
echo ""

# Open browser after delay (best-effort)
(sleep 8 && (xdg-open http://localhost:5173 2>/dev/null || open http://localhost:5173 2>/dev/null || true)) &

# Start api-server in background, then frontend in foreground
pnpm --filter @workspace/api-server run dev &
sleep 5
pnpm --filter @workspace/game-forge run dev
