# Grudge GameForge

## Overview

Grudge GameForge is a browser-based 3D game prototyping environment, similar to Unity or Godot, running entirely in the browser. It enables users to build scenes using primitives, physics, and scripting for rapid iteration. The platform integrates with Grudge Studio's open data feed for cataloging game assets, aiming to provide an accessible and comprehensive tool for game development and enhance the creative workflow for designers.

## User Preferences

I prefer iterative development and want to be able to quickly test changes.
I like clear and concise explanations for complex features.
I want to be asked before any major architectural changes are made.
I prefer to have direct control over asset management and scene composition.
I want to easily integrate external assets and scripts into my projects.
I expect the in-editor AI assistant to be helpful and directly manipulate the editor for scene changes.
I need full traceability for AI-driven changes, with expandable chips showing input and result JSON.

## System Architecture

**Windows Desktop Build (`artifacts/game-forge-desktop/`):** Electron 33 wrapper around the same React tree as the browser build. `src/main.ts` creates the BrowserWindow and installs a File / Tools / Help app menu; `src/preload.ts` exposes a typed `window.desktop` (`@workspace/desktop-bridge` `DesktopAPI`) over `contextBridge`; `src/ipc/{dialogs,tools,script}.ts` implement native open/save dialogs, 3D conversion (`@gltf-transform` for GLB/GLTF; FBX/OBJ/STL fall back to a `*.unconverted.<ext>` passthrough until the optional `fbx2gltf` binary is dropped into `bin/`), `.zip` extraction (`yauzl`, with zip-slip protection), and the Scene Deployer (writes `scene.json` + bundled `three.module.js` + a templated `index.html` viewer; optional `archiver`-zipped output). `src/update-manager.ts` wires `electron-updater` against a GitHub Releases feed configured in `electron-builder.yml`. `src/recents.ts` persists per-tool MRU paths via `electron-store`. The Tools panel UI (`artifacts/game-forge/src/editor/ToolsPanel.tsx`) is shared with the web build: it calls `useDesktopBridge()` and renders a "Available in the desktop app" placeholder for any tool when `window.desktop` is absent, so the four utilities (3D Converter, Unzipper, Scene Deployer, Three.js Script Editor with sandboxed live-preview iframe) live in a single component file. Native menu commands round-trip through `menu:openTool` IPC → `gameforge:openTool` window CustomEvent so the React tree never depends on `ipcRenderer`. Build with `pnpm --filter @workspace/game-forge-desktop run build:win` to produce `dist/installer/GrudgeGameForge-Setup-<version>.exe` (NSIS, unsigned). Dev mode (`pnpm --filter @workspace/game-forge-desktop run dev`) runs Vite on `:24426` and points Electron at it via `GAMEFORGE_DEV_URL`.


**UI/UX Decisions:**
The editor features a dark theme with a "Warlord Crafting Suite" brand identity. It uses `Cinzel Decorative` for the wordmark, `Cinzel` for headings, `Spectral SC` for lore, `Inter` for body text, and `JetBrains Mono` for code. A gold accent color (`#d4af37`) is used with glow effects for interactive elements. The UI is built with shadcn/ui and Tailwind v4, incorporating resizable panels.

**Technical Implementations & Feature Specifications:**

*   **Renderer:** three.js, @react-three/fiber, and @react-three/drei are used for the 3D viewport.
*   **Physics:** Rapier (`@dimforge/rapier3d-compat`) is integrated via `@react-three/rapier` for 3D physics simulation.
*   **Scripting:** Supports JavaScript with `new Function(...)` for `start` and `update` lifecycle hooks. C# scripts run via a Unity-flavored regex transpiler for instant in-editor preview and a real Blazor WebAssembly .NET 8 runtime for compiled execution.
*   **Node Editor:** A `@xyflow/react` based node editor supports Scene, Logic (visual scripting, future), and Shader (TSL fragment graphs, future) graphs.
*   **State Management:** Zustand manages the editor's state.
*   **Editor Layout:** A flexible layout includes a toolbar, hierarchy, 3D viewport with a multi-tab system, inspector, and a bottom panel for console, assets, scripts, and prefabs.
*   **PWA File Handlers:** Registers as a default opener for various 3D model and scene file types, allowing files to be opened directly into the running PWA.
*   **Asset Ingestion:** Supports drag-and-drop for common 3D model formats, images, audio, and scene JSON files.
*   **Hierarchy & Prefabs:** The scene is structured as a tree; prefabs are reusable subtrees with a dedicated editor mode. GLB model entities can have their internal scene-graph exposed as first-class child entities for scripting.
*   **AI Worker:** An in-editor chat assistant powered by Anthropic Claude directly manipulates the editor state using client-side tools for scene-graph mutations, tunable parameters, and ECS queries.
*   **Authentication:** Utilizes a session-less, client-managed Puter Auth for user sign-in and mirroring user data to a shared `users` table.
*   **Day-1 UX surfaces:** Includes first-run template overlays, RMB context menus showing touched entities, "Play as Player Prefab" auto-spawn, and publish to Puter hosting functionality.
*   **Scene Templates ("example maps"):** The 9 starter scenes (`character-showcase`, `tps-zombies`, `fps-arena`, `dm-cyberpunk`, `dm-encampment`, `dm-deserttown`, `dm-fort-royale`, `dm-yard`, `dm-winter-base`) live in the shared `@workspace/scene-templates` lib (pure builder functions). The lib is **not** imported by the editor — it is consumed only by the api-server, which on boot seeds each template into the user's own **Cloudflare R2** bucket (`grudge-assets`, `R2_BUCKET_ASSETS` env) at `templates/<TEMPLATES_VERSION>/<key>.gfscene.json` via the native R2 S3 endpoint `https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com` (region `auto`). Implementation lives in `artifacts/api-server/src/lib/r2Storage.ts` (`R2StorageService`, AWS SDK v3 `@aws-sdk/client-s3`). The seeder calls each builder inside `withIdScope(scope, fn)` so the per-entity IDs are deterministic (counter-based, scoped by `version/key`) instead of `nanoid`-random; this makes the serialized JSON byte-identical across boots, which lets `ensurePublicJson` use an ETag idempotency check — `HeadObject` returns the upload's MD5 hex as the ETag, we compare against `md5(buf)`, and skip the `PutObject` when they match (`written: false` in the boot log). **Critical R2 quirk:** do **not** set `ContentMD5` on `PutObjectCommand` — the AWS SDK v3 flexible-checksums middleware automatically adds a CRC32 checksum, and R2 rejects requests carrying both with `InvalidRequest: You can only specify one non-default checksum at a time`. The CRC32 alone is sufficient for upload integrity. Public reads stream from R2 via `GetObjectCommand` and are proxied through `GET /api/templates/{key}` (the bucket is private; only the api-server holds the credentials). Asset uploads (3D models, textures, audio) still use Replit Object Storage via the legacy `lib/objectStorage.ts` and `routes/assets.ts` — that pipeline is intentionally unchanged. Templates are exposed via:
    *   `GET /api/templates` — manifest array (`key`, `label`, `description`, `entityCount`, `byteSize`, `version`)
    *   `GET /api/templates/{key}` — streams SceneData JSON with `Content-Length` and `Cache-Control: public, max-age=31536000, immutable` (versioned URLs are immutable; bumping `TEMPLATES_VERSION` writes a fresh path without disturbing older share links).
    The editor consumes them via the generated `useListTemplates()` React Query hook plus a custom `loadTemplateWithProgress()` (in `artifacts/game-forge/src/lib/loadTemplate.ts`) that uses `response.body.getReader()` to drive a determinate progress bar. The `TemplateLoadingDialog` follows a best-practices contract: indeterminate for the first 150ms (anti-flash), determinate via bytes-received/Content-Length clamped to 0–99%, then jumps to 100% and holds 250ms before auto-closing. Cancel button aborts the in-flight fetch via `AbortController`. Both `Toolbar.tsx` and `Viewport.tsx` defensively coerce `tplQuery.data` through `Array.isArray(...) ? data : []` before mapping/`length`-checking it, so a transient HMR-induced "Invalid hook call" or a malformed proxy response cannot crash the entire toolbar — the picker just shows "Loading template list…" until the next React Query poll succeeds.
*   **Production chunk strategy (vite.config.ts `manualChunks`):** Heavy long-lived vendors are split into their own chunks for cache stability — `vendor-three`, `vendor-rapier`, `vendor-r3f`, `vendor-monaco`. **React, react-dom, scheduler, AND `@radix-ui/*` are deliberately NOT split** — they live in the main entry chunk. Why: `vite-plugin-top-level-await` (required so Rapier's WASM streaming load works in browsers without native TLA) wraps any chunk containing top-level `await` in a `__tla` promise that consumers must await before reading exports. With React in its own `vendor-react` chunk, Radix's `vendor-radix` chunk would import React's exports and execute `const X = React.forwardRef(...)` at module-init time **before** `vendor-react`'s `__tla_0` promise resolved — producing the production-only crash `"Cannot read properties of undefined (reading 'forwardRef')"` thrown from a renamed import. Keeping React + Radix in the entry sidesteps the race entirely (the entry is always the first thing the browser evaluates), at a ~280 KB cost well under the chunk-size warning limit.
*   **Game Modes:**
    *   **Deathmatch:** First-to-N-kills mode with built-in player/enemy/gamemode JS behaviors and a HUD. Three starter templates are provided.
    *   **Enemy AI (Yuka):** Implements per-entity finite state machines (PATROL, CHASE, ATTACK, INVESTIGATE, FLEE) using Yuka's `Vehicle` and behaviors, incorporating sensing (view range, FOV, hearing, LoS) and group alerting.
    *   **Script API extensions:** Provides `ctx.input.mouse`, `ctx.scene` utilities (findAll, findById, setPosition, castRay, send, on, freeze, unfreeze), `ctx.events`, `ctx.state`, and `ctx.yuka`.
    *   **Camera ↔ Script arbitration:** Logic for handling conflicts when scripts and camera controllers both attempt to modify entity positions or states.
*   **Engine GLB pipeline:** A single `lib/gltfLoaderConfig.ts` exposes `extendGltfLoader(loader)` which wires a singleton DRACOLoader (gstatic decoder path) and the bundled MeshoptDecoder onto any GLTFLoader instance. **Every** load path in the editor — drei `useGLTF` in `EntityRenderer` (called with `useDraco=false, useMeshopt=false` so our extender is authoritative, not overwritten by drei's own decoder setters), the SHARED_LOADER in `lib/glbHierarchy.ts`, and the standalone `useLoader(GLTFLoader, …, extendGltfLoader)` calls in `editor/surfaces/{ModelSurface,PlaceholderSurface}.tsx` — shares the same decoder pool, so DRACO's worker pool and ~200KB WASM download are paid once per session. `LoadedModel` also runs a `useLayoutEffect` that walks the **original** cached `gltf.scene` (not the per-instance `SkeletonUtils.clone`, since materials/textures are shared by reference) and bumps `texture.anisotropy` to `gl.capabilities.getMaxAnisotropy()` for the standard PBR slots, gated by a module-level `WeakSet<THREE.Texture>` so re-mounting a cached GLB never re-walks textures we already touched, and gated by `tex.anisotropy !== maxAniso` so a re-walk is a no-op on the GPU. Layout-effect timing means anisotropy is set before the renderer's first upload, avoiding a second GPU upload. Reference patterns documented in `.agents/skills/animation-and-skinned-meshes/SKILL.md` (cached GLB sharing, SkeletonUtils.clone, mixer/action lifecycle) and `.agents/skills/spatial-queries-and-surfaces/SKILL.md` (raycast / shape-cast / sensor / 8-direction probe-fan model + surface tag vocabulary). The `groundProbe(scene, position)` helper in `scene/PlayRuntime.ts` and the `surfaceTag` prop on `EntityRenderer.LoadedModel` (which stamps `userData.surface` on the cloned root) are the first concrete consumers of those skills.

**System Design Choices:**

*   **API Design:** OpenAPI 3.1 specification serves as the source of truth for API generation.
*   **Module Structure:** Frontend is a Vite + React application; backend is an Express server. Shared libraries include API specs, React Query clients, Zod validators, and Drizzle schemas.
*   **Performance:** In-memory caches are used for external data proxies.

## External Dependencies

*   **Backend Framework:** Express.js
*   **Database:** PostgreSQL (with Drizzle ORM)
*   **3D Graphics:** three.js, @react-three/fiber, @react-three/drei
*   **Physics Engine:** Rapier (`@dimforge/rapier3d-compat`)
*   **State Management:** Zustand, miniplex 2
*   **UI Components:** shadcn/ui
*   **Styling:** Tailwind CSS v4
*   **Code Editor:** Monaco editor
*   **API Client Generation:** orval
*   **Data Validation:** Zod
*   **AI Service:** Anthropic Claude (via Replit AI Integrations proxy)
*   **Object Storage (assets):** Replit App Storage (GCS-backed) — for user-uploaded 3D models, textures, audio.
*   **Object Storage (scene templates):** Cloudflare R2 (`grudge-assets` bucket, native S3 endpoint) — for the seeded starter-map JSON.
*   **External Asset Libraries:** Grudge Studio's open data feed, Poly Haven