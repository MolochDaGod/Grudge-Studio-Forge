<# 
.SYNOPSIS
  Grudge GameForge — 1-click offline setup (Windows)
  Installs Ollama, pulls recommended models, and starts the editor locally.

.DESCRIPTION
  Run this once to go from zero to a fully working local Forge with AI:
    pwsh -File scripts/setup-offline.ps1

  What it does:
    1. Installs Ollama if not found
    2. Starts Ollama service
    3. Pulls qwen2.5-coder:7b (Three.js + code) and llama3.2 (fast general)
    4. Installs pnpm dependencies
    5. Starts api-server + game-forge dev servers
    6. Opens browser to http://localhost:5173
#>

$ErrorActionPreference = "Continue"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }

# ── 1. Check/Install Ollama ──────────────────────────────────────────

Write-Step "Checking for Ollama..."

$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaCmd) {
    Write-Ok "Ollama found at $($ollamaCmd.Source)"
} else {
    Write-Step "Installing Ollama..."
    $installerUrl = "https://ollama.com/download/OllamaSetup.exe"
    $installerPath = Join-Path $env:TEMP "OllamaSetup.exe"
    
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-Ok "Downloaded Ollama installer"
        
        Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait
        Write-Ok "Ollama installed"
        
        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        
        Remove-Item $installerPath -ErrorAction SilentlyContinue
    } catch {
        Write-Warn "Auto-install failed. Please install manually from https://ollama.com/download"
        Write-Host "   Then re-run this script." -ForegroundColor White
        exit 1
    }
}

# ── 2. Start Ollama service ──────────────────────────────────────────

Write-Step "Starting Ollama service..."

$ollamaRunning = $false
try {
    $r = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -ErrorAction SilentlyContinue
    $ollamaRunning = $true
    Write-Ok "Ollama is already running"
} catch {
    Write-Host "   Starting ollama serve in background..."
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    
    # Verify it started
    try {
        Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5 | Out-Null
        $ollamaRunning = $true
        Write-Ok "Ollama service started"
    } catch {
        Write-Warn "Could not start Ollama. Run 'ollama serve' manually in another terminal."
    }
}

# ── 3. Pull recommended models ───────────────────────────────────────

if ($ollamaRunning) {
    Write-Step "Pulling AI models (this may take a few minutes on first run)..."
    
    $models = @("qwen2.5-coder:7b", "llama3.2")
    foreach ($model in $models) {
        Write-Host "   Pulling $model..." -NoNewline
        try {
            & ollama pull $model 2>&1 | Out-Null
            Write-Host " done" -ForegroundColor Green
        } catch {
            Write-Host " failed (pull manually with: ollama pull $model)" -ForegroundColor Yellow
        }
    }
}

# ── 4. Check Node.js / pnpm ─────────────────────────────────────────

Write-Step "Checking Node.js and pnpm..."

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Warn "Node.js not found. Install Node.js 22+ from https://nodejs.org"
    exit 1
}
$nodeVersion = & node --version
Write-Ok "Node.js $nodeVersion"

$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
    Write-Host "   Installing pnpm..."
    & npm install -g pnpm 2>&1 | Out-Null
}
Write-Ok "pnpm $(& pnpm --version)"

# ── 5. Install dependencies ─────────────────────────────────────────

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

Write-Step "Installing dependencies..."
Push-Location $projectRoot
try {
    & pnpm install --frozen-lockfile 2>&1 | Out-Null
    Write-Ok "Dependencies installed"
} catch {
    Write-Warn "pnpm install failed, trying without frozen lockfile..."
    & pnpm install 2>&1 | Out-Null
}

# ── 6. Start dev servers ─────────────────────────────────────────────

Write-Step "Starting Grudge GameForge..."
Write-Host ""
Write-Host "   Editor:     http://localhost:5173" -ForegroundColor White
Write-Host "   API Server: http://localhost:8080" -ForegroundColor White
Write-Host "   Ollama:     http://localhost:11434" -ForegroundColor White
Write-Host ""
Write-Host "   Select 'Qwen 2.5 Coder 7B' or 'Llama 3.2 3B' in the AI model picker" -ForegroundColor DarkGray
Write-Host "   for fully offline AI assistance." -ForegroundColor DarkGray
Write-Host ""

# Open browser after a short delay
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 8
    Start-Process "http://localhost:5173"
} | Out-Null

# Start both dev servers (api-server builds first, then starts)
$apiJob = Start-Job -ScriptBlock {
    Set-Location $using:projectRoot
    & pnpm --filter @workspace/api-server run dev 2>&1
}

# Wait a moment for api-server to build, then start the frontend
Start-Sleep -Seconds 5
& pnpm --filter @workspace/game-forge run dev

Pop-Location
