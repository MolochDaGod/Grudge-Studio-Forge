# Changelog

All notable changes to Grudge Forge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-06-02

### Added

- **Browser-side GLB optimization pipeline** (`src/lib/assetConverter.ts`).
  Every uploaded FBX/OBJ/STL → GLB and every dropped GLB now runs through a
  `dedup → prune → weld → meshopt` pass via `@gltf-transform` (dynamic
  import). Typical reduction is 5–10× on geometry payload. Failures fall back
  to the raw `GLTFExporter` output so a busted asset never blocks the user.
- **Per-asset `.meta.json` sidecars** (`src/editor/AssetDropZone.tsx`).
  After a successful model upload, the editor writes a sibling
  `<glbName>.meta.json` with triangle / vertex / mesh / bone counts,
  animation names, material names, bounding box, and `hasTextures`. The
  Library panel can render counts without re-parsing the GLB.
- **Physics layer rename** `Enemy` → `NPC` across `mapGen.ts`,
  `projectConventions.ts`, and the rapier patterns skill. Layer matrix is
  now `Default / Terrain / Player / NPC / Item / Projectile / Trigger /
  Water / IgnoreRaycast / UI3D`.
- **Seven new agent skill files** in `.agents/skills/`:
  - `threejs-controls` — Transform / Orbit / Map / Fly / Drag arbitration
  - `threejs-asset-io` — GLTFLoader/Exporter, FBX/OBJ/STL, meshopt vs Draco vs KTX2
  - `threejs-html-overlays` — CSS2DRenderer + drei `<Html />` for labels and pins
  - `rapier-physics-patterns` — character controller, joints, instancing, heightfields
  - `threejs-positional-audio` — listener-on-camera, perfect-timing, FFT visualizers
  - `threejs-volume-rendering` — Data3DTexture + RaymarchingBox + VolumeNodeMaterial
  - `threejs-tsl` — TSL fundamentals, VFX (tornado / flames), GLSL→TSL transpiler
- **Workspace `.npmrc`** with `virtual-store-dir-max-length=60` to keep the
  pnpm virtual store path under Windows MAX_PATH on long monorepo paths.

### Changed

- **`BottomPanel.tsx`** rewritten — recovered from auto-formatter corruption
  on lines 46–150; preserves the five-tab + Library sub-nav semantics.
- **`MapGenDialog.tsx`** rewritten — recovered the sector + map-kind pickers,
  defensive `value=""` filters so Radix `<Select.Item>` never gets an empty
  dynamic value.
- **Defensive `<SelectItem>` filters** at every dynamic-value call site in
  `Inspector.tsx`, `MapGenDialog.tsx`, `ToolsPanel.tsx`, `AIWorkerPanel.tsx`.

### Fixed

- **Vercel deploy failure** — added the missing `getGetTemplateUrl` export to
  `queryKeys.ts` and re-exported from `dataLayer.ts` so Rollup can resolve
  the import in `loadTemplate.ts`.

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
