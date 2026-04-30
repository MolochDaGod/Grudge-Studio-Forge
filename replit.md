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
*   **Game Modes:**
    *   **Deathmatch:** First-to-N-kills mode with built-in player/enemy/gamemode JS behaviors and a HUD. Three starter templates are provided.
    *   **Enemy AI (Yuka):** Implements per-entity finite state machines (PATROL, CHASE, ATTACK, INVESTIGATE, FLEE) using Yuka's `Vehicle` and behaviors, incorporating sensing (view range, FOV, hearing, LoS) and group alerting.
    *   **Script API extensions:** Provides `ctx.input.mouse`, `ctx.scene` utilities (findAll, findById, setPosition, castRay, send, on, freeze, unfreeze), `ctx.events`, `ctx.state`, and `ctx.yuka`.
    *   **Camera ↔ Script arbitration:** Logic for handling conflicts when scripts and camera controllers both attempt to modify entity positions or states.

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
*   **Object Storage:** Replit App Storage (GCS-backed)
*   **External Asset Libraries:** Grudge Studio's open data feed, Poly Haven