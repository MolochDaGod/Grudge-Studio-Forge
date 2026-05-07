# Grudge GameForge

Grudge GameForge is a browser-based 3D game prototyping environment for building and scripting interactive scenes, integrating with Grudge Studio's open data feed for assets.

## Run & Operate

*   **Run desktop app:** `pnpm --filter @workspace/game-forge-desktop run dev`
*   **Build desktop app (Windows):** `pnpm --filter @workspace/game-forge-desktop run build:win`
*   **Run web app:** `pnpm --filter @workspace/game-forge run dev`
*   **Build web app:** `pnpm --filter @workspace/game-forge run build`
*   **Run API server:** `pnpm --filter @workspace/api-server run dev`
*   **Run migrations:** `pnpm --filter @workspace/api-server run migrate`
*   **Required Env Vars:** `R2_BUCKET_ASSETS`, `CF_ACCOUNT_ID`, `TEMPLATES_VERSION`, `DATABASE_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`.

## Stack

*   **Frontend:** React 18, Vite, three.js (@react-three/fiber, @react-three/drei)
*   **Backend:** Express.js 4
*   **Database:** PostgreSQL, Drizzle ORM
*   **Physics:** Rapier (@dimforge/rapier3d-compat)
*   **State Management:** Zustand, miniplex 2
*   **UI:** shadcn/ui, Tailwind CSS v4
*   **Build Tool:** Vite
*   **Validation:** Zod
*   **API Client Gen:** orval
*   **Runtime:** Node.js, Browser, Electron

## Where things live

*   **Desktop App:** `artifacts/game-forge-desktop/`
*   **Web App:** `artifacts/game-forge/`
*   **API Server:** `artifacts/api-server/`
*   **Shared Libraries:** `packages/`
*   **DB Schema:** `artifacts/api-server/src/db/schema.ts`
*   **API Contracts:** `packages/api/openapi.yaml`
*   **AI Worker:** `artifacts/game-forge/src/ai/` (tools in `ai/tools/<area>/`)
*   **Navmesh + Collider Bakers:** `artifacts/game-forge/src/lib/navmesh.ts`, `artifacts/game-forge/src/lib/colliderBaker.ts`
*   **Deployment Notes:** `DEPLOYMENT.md`
*   **Skill Docs:** `.agents/skills/`

## Architecture decisions

*   **Monorepo Structure:** All artifacts and shared libraries in a single pnpm monorepo.
*   **Desktop App:** Electron wraps the web app's React tree, using `contextBridge` for platform-specific features.
*   **Scene Template Storage:** Templates are seeded into Cloudflare R2 via the API server at boot-time for public access and versioning.
*   **GLB Decoder Sharing:** A singleton `DRACOLoader` and `MeshoptDecoder` ensure decoders are initialized once.
*   **AI Assistant:** Uses client-side tools and Anthropic Claude via Replit AI proxy for direct editor manipulation.
*   **Physics Layers:** Fixed registry in `@workspace/scene-schema` for Rapier `collisionGroups`.
*   **CommandStack Discipline:** All user-driven editor mutations route through `cmd*` actions for undoability.
*   **Navmesh Storage:** Per-scene Recast bake stored as `Uint8Array` in a session-scoped `window.__navmeshBlobs` map and persisted to R2; `Environment.navmeshAssetId` (FNV-1a id) + `navmeshBlobKey` (raw server id) let `Viewport`, the AI nav tools, and `NavmeshDebugOverlay` lazily call `ensureNavmeshBlob(assetId, blobKey, projectId)` after a reload (cache-first, falls back to `hydrateNavmeshFromServer`).
*   **Area-filtered pathfinding:** `findPath({areaFilter:SurfaceKind[]})` builds a per-call recast `QueryFilter` (`includeFlags = OR(1<<areaId)`) and frees the `dtQueryFilter` after use; same filter flows through `ctx.nav.findPath`, AI `find_path`, and `agentRuntime` (`NavAgentComponent.filter`).
*   **Agent FSM:** Per-entity XState v5 machine — Idle / Patrol / Chase / Climb / Swim / Stuck / Dead / Attack — with global `replan` event. `AgentHandle` exposes `state/currentClip/isStuck/patrol/chase/attack(id)/moveTo(id|vec3)/replan/stop`. Surface guards read `event.surface` (XState v5 child-transition ordering).
*   **Animation crossfade bridge:** `Viewport` publishes `actor.currentClip()` per agent into `window.__agentClips`; `EntityRenderer.LoadedModel` reads it each frame and crossfades (0.2s) between drei `useAnimations` actions. FSM clip > `entity.model.clip` > idle/loop heuristic.
*   **Convex-decomp colliders:** When `colliderType === "convex-decomp"` and `__colliderHullSets[collidersAssetId]` exists, `EntityRenderer` sets `<RigidBody colliders={false}>` and emits one `<ConvexHullCollider/>` per baked hull. Missing cache falls through to the regular collider switch.
*   **V-HACD baker:** `colliderBaker.ts` uses `vhacd-js` (real V-HACD wasm) lazily through a cached `ConvexMeshDecomposition` instance, falling back to a single `quickhull3d` hull per mesh on load/decomposition failure. The package exposes only `module` (no `main`/`exports`), so the import targets `vhacd-js/lib/vhacd.js` directly.
*   **Batched nav-agent assignment:** AI `set_nav_agent` routes through `cmdSetEntityNavAgents(changes[])` → single `setNavAgentsBatchCommand`, so multi-entity setup is one undo step.

## Product

*   Browser-based 3D game prototyping with primitives, physics, and scripting.
*   Integrated 3D viewport, multi-tab system, hierarchy, and inspector.
*   JavaScript and C# scripting with live preview.
*   Visual node editor (future: Scene, Logic, Shader graphs).
*   Drag-and-drop asset ingestion (3D models, images, audio, scene JSON).
*   Reusable Prefabs with dedicated editor mode.
*   In-editor AI chat assistant for scene manipulation.
*   Desktop app with native file dialogs and 3D format conversion tools.
*   PWA with file handler registration.
*   Deathmatch game mode with AI enemies and scripting API extensions.
*   Publishing functionality to Puter hosting.

## User preferences

I prefer iterative development and want to be able to quickly test changes.
I like clear and concise explanations for complex features.
I want to be asked before any major architectural changes are made.
I prefer to have direct control over asset management and scene composition.
I want to easily integrate external assets and scripts into my projects.
I expect the in-editor AI assistant to be helpful and directly manipulate the editor for scene changes.
I need full traceability for AI-driven changes, with expandable chips showing input and result JSON.

## Gotchas

*   **R2 `ContentMD5`:** Do not set `ContentMD5` on `PutObjectCommand` for Cloudflare R2; use AWS SDK v3's flexible-checksums.
*   **React/Radix Chunking:** Avoid separating React/Radix into their own chunks due to `vite-plugin-top-level-await` causing a `forwardRef` crash in production.
*   **Template Loading Dialog:** Adhere to its specific contract for progress bar and auto-closing behavior.
*   **Entity IDs:** Scene template entity IDs are deterministic for ETag-based idempotency checks.

## Pointers

*   **Deployment Details:** `DEPLOYMENT.md`
*   **3D Animation & Skinned Meshes:** `.agents/skills/animation-and-skinned-meshes/SKILL.md`
*   **Spatial Queries & Surfaces:** `.agents/skills/spatial-queries-and-surfaces/SKILL.md`
*   **three.js Documentation:** [https://threejs.org/docs/](https://threejs.org/docs/)
*   **Rapier Documentation:** [https://rapier.rs/docs/](https://rapier.rs/docs/)
*   **Zustand Documentation:** [https://zustand-demo.pmnd.rs/](https://zustand-demo.pmnd.rs/)
*   **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
*   **shadcn/ui Documentation:** [https://ui.shadcn.com/docs](https://ui.shadcn.com/docs)