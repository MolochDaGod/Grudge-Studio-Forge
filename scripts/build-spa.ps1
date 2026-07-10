# Build the game-forge SPA for production (Windows).
# Use on a machine with ≥16 GB free RAM.
#
# Usage:
#   .\scripts\build-spa.ps1
#   $env:NODE_OPTIONS="--max-old-space-size=16384"; .\scripts\build-spa.ps1
#
# Output: artifacts/game-forge/dist/public/

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = "--max-old-space-size=16384"
}

Write-Host "==> Node $(node -v)"
Write-Host "==> NODE_OPTIONS=$env:NODE_OPTIONS"
Write-Host "==> Root $Root"

try { corepack enable 2>$null } catch {}
try { corepack prepare pnpm@10.28.0 --activate 2>$null } catch {}

Write-Host "==> Install (@workspace/game-forge and deps only)"
pnpm install --filter "@workspace/game-forge..."
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

Write-Host "==> Vite production build"
pnpm --filter @workspace/game-forge exec vite build --config vite.config.ts
if ($LASTEXITCODE -ne 0) { throw "vite build failed" }

$Out = Join-Path $Root "artifacts\game-forge\dist\public"
$Index = Join-Path $Out "index.html"
if (-not (Test-Path $Index)) { throw "missing $Index" }

$sizeMb = [math]::Round(((Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
$titleMatch = Select-String -Path $Index -Pattern '<title>([^<]+)</title>'
$title = if ($titleMatch) { $titleMatch.Matches[0].Groups[1].Value } else { "?" }
Write-Host "==> OK  $Out  (${sizeMb} MB)  title=$title"
