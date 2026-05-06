# Grudge GameForge

Grudge GameForge is a browser-based 3D game prototyping environment for building and scripting interactive scenes, integrating with Grudge Studio's open data feed for assets.

## Run & Operate

*   **Run desktop app:** `pnpm --filter @workspace/game-forge-desktop run dev` (sets `GAMEFORGE_DEV_URL`)
*   **Build desktop app (Windows):** `pnpm --filter @workspace/game-forge-desktop run build:win`
*   **Run web app:** `pnpm --filter @workspace/game-forge run dev`
*   **Build web app:** `pnpm --filter @workspace/game-forge run build`
*   **Run API server:** `pnpm --filter @workspace/api-server run dev`
*   **Run migrations:** `pnpm --filter @workspace/api-server run migrate`
*   **Required Env Vars:** `R2_BUCKET_ASSETS`, `CF_ACCOUNT_ID`, `TEMPLATES_VERSION` (for R2-seeded templates), `DATABASE_URL` (PostgreSQL), `AUTH_SECRET` (Puter Auth), `ANTHROPIC_API_KEY` (for AI worker).

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
*   **Runtime:** Node.js (backend), Browser (frontend), Electron (desktop)

## Where things live

*   **Desktop App:** `artifacts/game-forge-desktop/`
*   **Web App:** `artifacts/game-forge/`
*   **API Server:** `artifacts/api-server/`
*   **Shared Libraries (API specs, Zod, Drizzle):** `packages/`
*   **DB Schema:** `artifacts/api-server/src/db/schema.ts`
*   **API Contracts:** `packages/api/openapi.yaml`
*   **Scene Templates:** `@workspace/scene-templates` lib (pure builder functions)
*   **Editor UI Components:** `artifacts/game-forge/src/editor/`
*   **AI Worker:** `artifacts/game-forge/src/ai/`
*   **Deployment Notes:** `DEPLOYMENT.md`
*   **Animation Skill Doc:** `.agents/skills/animation-and-skinned-meshes/SKILL.md`
*   **Spatial Queries Skill Doc:** `.agents/skills/spatial-queries-and-surfaces/SKILL.md`

## Architecture decisions

*   **Monorepo Structure:** All artifacts and shared libraries reside in a single pnpm monorepo for simplified dependency management and code sharing.
*   **Desktop build strategy:** Electron wraps the same React tree as the web build, sharing most UI code, with platform-specific features exposed via a `contextBridge` and IPC.
*   **Scene Template Storage:** Starter scene templates are seeded into Cloudflare R2 via the API server at boot-time for efficient public access and versioning, rather than being bundled with the editor.
*   **GLB Decoder Sharing:** A singleton `DRACOLoader` and `MeshoptDecoder` are wired into all GLTF loading paths to ensure decoders are downloaded and initialized only once per session.
*   **Production Chunking:** Heavy vendors are split, but React and Radix are intentionally kept in the main entry chunk to avoid a production-only `forwardRef` crash caused by `vite-plugin-top-level-await` and module evaluation order.
*   **AI Assistant:** Uses client-side tools and Anthropic Claude via Replit AI proxy for direct editor manipulation.

## Product

*   Browser-based 3D game prototyping with primitives, physics, and scripting.
*   Integrated 3D viewport with multi-tab system, hierarchy, and inspector.
*   Supports JavaScript and C# scripting with live preview.
*   Visual node editor for Scene, Logic (future), and Shader graphs (future).
*   Drag-and-drop asset ingestion (3D models, images, audio, scene JSON).
*   Reusable Prefabs with dedicated editor mode.
*   In-editor AI chat assistant for scene manipulation.
*   Desktop app with native file dialogs and 3D format conversion tools.
*   PWA with file handler registration for direct opening of 3D files.
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

*   **R2 `ContentMD5`:** Do not set `ContentMD5` on `PutObjectCommand` when uploading to Cloudflare R2; the AWS SDK v3's flexible-checksums middleware handles CRC32, and R2 rejects requests with both.
*   **React/Radix Chunking:** Do not separate React, Radix, etc., into their own chunks in `vite.config.ts` due to `vite-plugin-top-level-await` causing a `forwardRef` crash in production.
*   **Template Loading Dialog:** Follows a specific contract for progress bar and auto-closing behavior; ensure changes adhere to it.
*   **Entity IDs:** Scene template entity IDs are deterministic (counter-based, scoped by `version/key`) to enable ETag-based idempotency checks for R2 uploads.

## Pointers

*   **Deployment Details:** `DEPLOYMENT.md`
*   **3D Animation & Skinned Meshes:** `.agents/skills/animation-and-skinned-meshes/SKILL.md`
*   **Spatial Queries & Surfaces:** `.agents/skills/spatial-queries-and-surfaces/SKILL.md`
*   **three.js Documentation:** [https://threejs.org/docs/](https://threejs.org/docs/)
*   **Rapier Documentation:** [https://rapier.rs/docs/](https://rapier.rs/docs/)
*   **Zustand Documentation:** [https://zustand-demo.pmnd.rs/](https://zustand-demo.pmnd.rs/)
*   **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
*   **shadcn/ui Documentation:** [https://ui.shadcn.com/docs](https://ui.shadcn.com/docs)