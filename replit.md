# Grudge GameForge

## Overview

Grudge GameForge is a browser-based 3D game prototyping environment, akin to Unity or Godot, designed to run entirely in the browser. It allows users to build scenes by composing primitives, applying physics, and attaching scripts for rapid iteration. The platform integrates with Grudge Studio's open data feed for cataloging game assets (weapons, items, enemies, quests). The project aims to provide a comprehensive, accessible tool for game development, enhancing the creative workflow for game designers.

## User Preferences

I prefer iterative development and want to be able to quickly test changes.
I like clear and concise explanations for complex features.
I want to be asked before any major architectural changes are made.
I prefer to have direct control over asset management and scene composition.
I want to easily integrate external assets and scripts into my projects.
I expect the in-editor AI assistant to be helpful and directly manipulate the editor for scene changes.
I need full traceability for AI-driven changes, with expandable chips showing input and result JSON.

## System Architecture

**UI/UX Decisions:**
The editor features a dark theme with a "Warlord Crafting Suite" brand identity. It utilizes `Cinzel Decorative` for the wordmark, `Cinzel` for headings, `Spectral SC` for lore, `Inter` for body text, and `JetBrains Mono` for code. A distinct gold color (`#d4af37`) is used for primary accents, alongside gold glow effects for interactive elements. The UI is built with shadcn/ui and Tailwind v4, featuring resizable panels for a flexible layout.

**Technical Implementations & Feature Specifications:**

*   **Renderer:** three.js, @react-three/fiber, and @react-three/drei (for controls and GLTF loading) power the 3D viewport.
*   **Physics:** Rapier (`@dimforge/rapier3d-compat`) is integrated via `@react-three/rapier` for 3D physics simulation.
*   **Scripting:** Supports JavaScript with `new Function(...)` for `start` and `update` lifecycle hooks. C# scripts run two ways: (1) a Unity-flavored regex transpiler for instant in-editor preview (no .NET install required); (2) a real Blazor WebAssembly .NET 8 runtime built from `csharp/GameForgeRuntime/` (`build.sh` publishes 66 files / ~7.2 MB to `artifacts/game-forge/public/_framework/`) and lazy-loaded at first Play via `src/scene/blazorRuntime.ts`. The .NET runtime exposes a `[JSExport]`-annotated `ScriptHost` (Boot/RegisterScriptType/AttachScript/TickEntity/DetachEntity/ClearAll/SetKey) so user scripts can run as real compiled CIL when the runtime is present, and fall back to the transpiler when it is not. The csproj sets `WasmBuildNative=false`/`RunAOTCompilation=false` because Replit's Nix environment lacks `libatomic.so.1` for the bundled emscripten node — Mono's pre-built `browser-wasm` runtime is used as-is. `DebuggerSupport=false` keeps the publish output free of `.pdb` resources that the runtime would otherwise insist on fetching at boot. The browser-side loader bypasses Vite's `/public` import restriction by building a fully-qualified URL with `window.location.origin` before calling `import()`.
*   **Node Editor:** A bottom-panel `Nodes` tab built on `@xyflow/react` v12 supports three graph kinds: Scene (geometry/material/transform/mesh/light → SceneOutput, compiles to real `SceneEntity` instances via `cmdAddEntity`), Logic (visual scripting, gated until the Blazor runtime ships), and Shader (TSL fragment graphs, gated). State lives in `src/store/nodeGraph.ts` (separate Zustand store from the editor) and an AI prompt-to-graph input is wired at the top.
*   **State Management:** Zustand manages the editor's state, including the scene graph, selection, play mode, and console.
*   **Editor Layout:** A top-level layout includes a toolbar, hierarchy panel, 3D viewport, inspector, and a bottom panel with tabs for Console, Assets, Scripts, and Prefabs. The viewport area itself hosts a **multi-tab system** (`src/store/viewportTabs.ts`, `src/editor/ViewportTabBar.tsx`, `src/editor/ViewportHost.tsx`) supporting tab kinds `scene` / `model` / `prefab` / `rigging` / `animation` / `convert`. The Scene tab is permanent and stays mounted across switches (hidden via CSS `visibility` when inactive) so the heavy Canvas + camera state survive; all other tabs are transient — mounted only while active and torn down on switch, with explicit GLTF resource disposal and `useLoader.clear()` on unmount. Blob URLs owned by closed tabs are revoked on the next macrotask so in-flight loaders can abort cleanly.
*   **three.js Devtools:** A `__THREE_DEVTOOLS__` EventTarget is installed at `main.tsx` module-load time (before any three import) via `src/lib/threeDevtools.ts`. Each Canvas mounts a `<DevtoolsBridge>` that dispatches `observe` events for the scene + renderer (and a synthetic `dispose` on unmount) so the official "three.js developer tools" Chrome extension can inspect every viewport tab independently.
*   **PWA File Handlers:** `public/manifest.webmanifest` registers Grudge Studio Forge as a default opener for `.glb`, `.gltf`, `.obj`, `.fbx`, `.zip`, `.asset`, `.prefab`, `.gfscene` via the `file_handlers` field. `launch_handler.client_mode` is `focus-existing` so OS-level "Open with…" delivers files into the running PWA, where `src/lib/launchQueue.ts` consumes `window.launchQueue` and opens each handle in a fresh viewport tab.
*   **Asset Ingestion:** Supports drag-and-drop for `.glb`, `.gltf`, `.obj`, various image formats, audio formats, and scene JSON files. `.obj` files are transcoded to GLB.
*   **Hierarchy & Prefabs:** The scene is structured as a tree using `SceneEntity.parentId`. The hierarchy panel supports drag-and-drop reparenting and prevents cyclic dependencies. Prefabs are reusable subtrees that can be saved, spawned as instances, and opened in a dedicated sub-scene editor mode.
*   **AI Worker:** An in-editor chat assistant powered by Anthropic Claude (`claude-sonnet-4-6`) directly manipulates the editor state using predefined tools. Tool definitions and executors reside on the client-side to ensure undo capability and synchronous interaction with the Zustand store.
*   **Grudge Studio Puter Auth (session-less, client-managed):** Puter Auth lives entirely client-side. The toolbar's `<UserMenu>` lazy-loads the Puter SDK (`artifacts/game-forge/src/lib/puterSdk.ts` injects `js.puter.com/v2/` on first use), opens the Puter sign-in popup, then makes a single idempotent call to `POST /api/auth/puter/sync` to mirror the user into the **shared** `users` table so other Grudge apps can see them. The server verifies the access token with `https://api.puter.com/whoami` (server-to-server, never trusts the client's claimed identity), upserts the user row under an advisory lock keyed on `puter_uuid`, looks up the canonical Grudge ID in the read-only **shared** `grudge_accounts` table, and falls back to a deterministic ephemeral `GRUDGE-<13digits>-<8hex>` id derived via HMAC(`JWT_SECRET`, `puter_uuid`) when no upstream account exists. Forge does **not** create or own any shared tables (no drizzle for `users`/`accounts`/`grudge_accounts`), and there is no Forge-private link table. There are no cookies, no server sessions, no CSRF surface — the SDK manages token storage and renewal. Endpoints: `GET /api/auth/config`, `POST /api/auth/puter/sync`. Client store: `src/store/auth.ts`. Bootstrap: `bootstrapAuth()` runs once on `App` mount and only re-syncs if the SDK is already loaded and reports a signed-in user; guest visitors stay anonymous and never download the SDK. Signed-in users surface via `user.hasGrudgeAccount` for feature gating ("Linked" vs "Local only" badge in the dropdown).
*   **Model Entity Polish:** `ModelComponent` supports `clip` for animations, `tint` for recoloring models without affecting other instances, and `label` for floating sprite tags.

**System Design Choices:**

*   **API Design:** An OpenAPI 3.1 specification (`openapi.yaml`) serves as the source of truth for the API, generating React Query hooks and Zod validators. ETag generation is disabled globally for small, frequently changing JSON list responses to avoid client-side issues.
*   **Module Structure:** The frontend (GameForge) is a Vite + React application, while the backend is an Express server. Shared libraries include API specifications, React Query clients, Zod validators, and Drizzle schemas.
*   **Performance:** In-memory caches are used for external data proxies (Grudge Studio object store, Poly Haven) to improve performance.

## External Dependencies

*   **Backend Framework:** Express.js
*   **Database:** PostgreSQL (with Drizzle ORM)
*   **3D Graphics:** three.js, @react-three/fiber, @react-three/drei
*   **Physics Engine:** Rapier (`@dimforge/rapier3d-compat`)
*   **State Management:** Zustand
*   **UI Components:** shadcn/ui
*   **Styling:** Tailwind CSS v4
*   **Code Editor:** Monaco editor
*   **API Client Generation:** orval (for React Query hooks)
*   **Data Validation:** Zod
*   **AI Service:** Anthropic Claude (via Replit AI Integrations proxy)
*   **Object Storage:** Replit App Storage (GCS-backed) for asset uploads
*   **External Asset Libraries:**
    *   Grudge Studio's open data feed (weapons, items, enemies, quests)
    *   Poly Haven (proxied for GLTF models, PBR textures, HDRIs)