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
*   **Puter as the only identity & cloud backbone:** `store/auth.ts` exposes `{status: idle|anon|guest|signedIn, user, isPuterSignedIn}`; `lib/authBootstrap.ts` provides `bootstrapAuth/signInWithPuter/continueAsGuest/renameGuest/signOut` against real `puter.auth` (with `attempt_temp_user_creation` for friction-free first sign-in — surfaces an `isTemp` claim chip in `UserMenu`). Guests get a local-only display name in `localStorage` and `isPuterSignedIn:false`, which gates publish, cloud tools, and Puter-AI models. `WelcomeModal` (mounted in `App.tsx`, opens on `status==="anon"`) offers Sign-in-with-Puter or Continue-as-guest. The server's `/api/auth/puter/sync` is the only path to the shared `users` table; `POST /api/puter/exchange` (`routes/puter.ts` → `lib/puterServerClient.exchangePuterToken`) is the lightweight token-verify variant for non-identity flows. `lib/cloud/puterCloud.ts` wraps `puter.fs`/`puter.kv` with structured `{ok:false, reason:"guest"|"sdk-unavailable"}` results so call sites never branch on sign-in state. Path convention: `Grudge/projects/<projectId>/scene.json` for cloud saves, `Grudge/published/<slug>/` for published sites.
*   **Two-provider AI (server-anthropic + Puter) with model picker:** `lib/ai/providers/{types,sse,serverAnthropicProvider,puterProvider,index}.ts` defines a single streaming-provider interface emitting unified `text_delta|text_block|tool_use|stop|error` SSE events. `MODELS` catalog drives the dropdown in `AIWorkerPanel`; selection persists in `localStorage` under `grudge.ai.model` and is captured at turn-start via `selectedModelRef` so mid-stream picker changes don't apply. Puter-only models render disabled with a "(sign in)" hint when `!isPuterSignedIn`. Server-side: `routes/ai.ts` reads `?provider=puter` + `X-Puter-Token` and forwards via `lib/puterServerClient.puterChat()`, re-emitting the same SSE shape so the client tool-loop is provider-agnostic. Three Puter cloud tools (`cloud_save_project`, `publish_to_puter`, `list_my_puter_projects` in `ai/tools/puter/`) feature-detect via `cloud.isAvailable()` and return `{ok:false, error:"Sign in with Puter…"}` for guests; system prompt instructs the model to surface the prompt verbatim instead of retrying. Full integration patterns documented in `docs/PUTER_PATTERNS.md`.
*   **Standalone player bundle for publishing:** `artifacts/player/` is a chrome-free Vite app that imports `PlayScriptRuntime`/`PlayCameraController`/`EffectsRig`/`Physics` from game-forge via vite alias and stubs `@/store/editor` with a minimal zustand `useEditor` (`src/playerStore.ts` — exposes `sceneData`/`scripts`/`pushLog`/`cmdBakeNavmesh` no-op so cross-imported runtime files compile against it). `vite-plugin-singlefile` emits one self-contained `dist/index.html` that fetches sibling `./scene.json` + `./scripts.json` in parallel at boot. The shared `PlayScriptRuntime` (extracted from `Viewport.tsx`'s old `ScriptedEntities`) takes scripts as a prop instead of calling `useListScripts`, so editor play-mode and the player run the exact same gameplay tick (script start/update, XState nav-agent FSMs, surface ticks, navmesh hydration). A `prebuild` script in game-forge builds the player and copies it to `artifacts/game-forge/public/player.html`. `puterPublish.ts` snapshots the project's scripts via `listScripts(projectId)` at publish time, uploads scene.json + scripts.json + the player HTML to `Grudge/published/<slug>/`; falls back to the legacy redirect-to-editor HTML when `/player.html` is unreachable. Result includes `bootstrapper: "player"|"redirect"` so the publish dialog surfaces which experience visitors get.
*   **Per-race character models:** The six playable races live in the toon-rts-characters asset pack on the public Grudge Studio CDN; saved scenes reference them via the durable `builtin:race:<id>` keys (registered in `artifacts/game-forge/src/lib/builtinModels.ts`) so scene JSON stays portable. `getRaceCharacterUrl(race)` in `artifacts/game-forge/src/lib/objectStoreApi.ts` is the canonical type-safe helper for the CDN URL.
*   **Per-model yaw offset + per-race locomotion clips:** `BUILTIN_MODEL_YAW_OFFSETS` and `BUILTIN_MODEL_CLIPS` in `artifacts/game-forge/src/lib/builtinModels.ts` cover the toon-rts character pack. Every `race:*` key gets a `+π` yaw offset (the source GLBs face +Z, three.js convention is -Z) which `EntityRenderer.LoadedModel` applies on a child group inside `groupRef` (so bone animations / selection / picking still work and the physics body keeps canonical yaw — `ModelComponent.yawOffset` per-entity overrides the registry default). `CameraControllers` (TPS + FPS) and the `enemy-rpg` behavior write `idle | walk | run | attack` into `window.__agentClips` from the `BUILTIN_MODEL_CLIPS[race:<id>]` table; `LoadedModel` reads the same bridge and crossfades over 0.2s. Clip names follow the toon-rts manifest's faction-prefix convention (`WK_`, `DWF_`, `BRB_`, `ELF_`, `ORC_`; skeleton reuses WK). Caveat: today the CDN-hosted character GLBs ship with **zero** baked animations and the manifest's `animationsweapons/` packs are not deployed — so the clip writes are no-ops in production until the asset pack re-exports the male_locomotion / 1h_sword clips into the character GLBs. Drei's `useAnimations` silently falls back to the existing idle/loop heuristic when a written clip name doesn't exist, so wiring stays safe.
*   **Tri-axis tagging (Layer / Surface / Material):** Every entity carries three orthogonal tags. Material lives in `@workspace/scene-schema`'s `MATERIAL_KINDS` registry (Solid/Metal/Glass/Wood/Stone/Cloth/Flag/Foliage/Liquid/Particle/Smoke) with per-kind defaults for density/friction/restitution/drag/opacity and the occlusion flags blocksLineOfSight/blocksProjectiles/blocksAudio. `EntityRenderer` stamps `userData.{layer,surface,material,materialBlocks*}` on both the `RigidBody` and the plain `<group>` paths, and consumers (PlayRuntime `raycastEntities`, `groundProbe`, AI perception) walk the THREE.Object3D parent chain to resolve unset axes — same lookup is mirrored on the persisted scene tree by `resolveInheritedFields(entity, indexEntitiesById(entities))` in `scene-schema/inheritance.ts`. `castRay` accepts an optional `materialFilter` (`requireBlocksLineOfSight | requireBlocksProjectiles | requireBlocksAudio | kinds`) so glass/foliage/smoke get correct pass-through for free. Soft entity types `cloth`/`flag`/`particles` auto-default into the matching Material kind. AI tools live at `ai/tools/materials/` (`list_materials`, `set_material`, `find_entities_by_material`); `apply_palette` skips non-palette-friendly kinds (Glass/Liquid/Particle/Smoke/Foliage) unless `force:true`.

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
*   **Per-race character GLB URLs:** `getRaceCharacterUrl(race)` in `artifacts/game-forge/src/lib/objectStoreApi.ts`
*   **three.js Documentation:** [https://threejs.org/docs/](https://threejs.org/docs/)
*   **Rapier Documentation:** [https://rapier.rs/docs/](https://rapier.rs/docs/)
*   **Zustand Documentation:** [https://zustand-demo.pmnd.rs/](https://zustand-demo.pmnd.rs/)
*   **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
*   **shadcn/ui Documentation:** [https://ui.shadcn.com/docs](https://ui.shadcn.com/docs)