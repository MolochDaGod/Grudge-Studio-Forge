# Changelog

All notable changes to Grudge Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] — 2026-05-30

### Added
- **GitHub Actions release workflow** (`release.yml`) — pushes a `v*` tag to
  build a Windows NSIS installer and upload it as a draft GitHub Release with
  `latest.yml` for auto-updates.
- **7 scene templates** — Cyberpunk Deathmatch, Fort Royale, Forest Encampment,
  RPG Village (all 6 races), Dungeon Interior (prefab), Survival Camp, and
  City Sandbox (open-world GTA-style).
- **100+ builtin 3D models** — 14 maps, 12 characters/monsters, 14 VFX,
  28 locomotion clips, 16 magic casting clips, 7 vehicles, 9 nature packs,
  5 buildings, 8 props, 6 race characters + weapons.
- **7 vehicle models** — Cop car, Sedan ×2, Sports car ×2, SUV, Taxi
  (Realistic Car Pack, OBJ→GLB conversion).
- **City sandbox map** — Dude Theft Wars low-poly city (7009 nodes, 3105
  meshes, 46 materials, Draco-compressed 71 MB → 10 MB GLB).
- **RPG/MMO UI asset pack** — 250+ craftpix.net textures (unit frames, action
  bars, tooltips, nameplates, minimap, chat, notifications, quest tracker,
  controls, spell icons, equip slots, windows, lobby) at `public/ui/rpg-mmo/`.
- **RPG UI primitives** (`ui/rpg/index.tsx`) — `RPGFrame`, `RPGBar`,
  `RPGUnitFrame`, `RPGActionSlot`, `RPGTooltip`, `RPGNotification`.
- **Rajdhani font** — `@font-face` declarations for the RPG UI font family
  (300–700 weights).
- **Icon generation script** (`scripts/generate-icons.mjs`) — generates
  favicon.ico, PWA 192/512/maskable, and OG image from a source PNG via
  `sharp-cli`.

### Changed
- **Full rebrand** from "Grudge GameForge" → **"Grudge Forge"** across all
  surfaces: HTML title, OG meta, PWA manifest, Electron window title, about
  dialog, installer name, NSIS shortcut, appId (`com.grudge.forge`).
- **PlayHUD** upgraded to use RPG textured unit frame for health, textured
  scoreboard, and notification components for kill-feed.
- **Landing page** stats updated to reflect actual counts (100+ models,
  7 templates, 13 AI models, 15K token cap).
- **Package versions** aligned: api-server and game-forge bumped `0.0.0` →
  `0.1.0` to match desktop.

### Fixed
- **Dockerfile** healthcheck path `/api/health` → `/api/healthz` (matching
  the actual Express route).
- **electron-builder.yml** publish owner/repo replaced `${env.GH_OWNER}` /
  `${env.GH_REPO}` placeholders with hardcoded `MolochDaGod` /
  `Grudge-Studio-Forge`.
- **Desktop README** removed Replit workspace reference, fixed `your-org` /
  `grudge-gameforge` placeholders.
- **`.env.example`** fixed `pub-xxxxx` R2 placeholder, commented it out.

### Removed
- All Replit deployment references (deprecated; Object Storage broken).
