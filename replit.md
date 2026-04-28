# Grudge GameForge

A browser-based 3D game prototyping environment — a Unity / Godot-flavoured editor that runs entirely in the browser. Build scenes by composing primitives, attach physics + scripts, hit Play, and iterate. Catalog data (weapons, items, enemies, quests) is pulled live from Grudge Studio's open data feed.

## Brand — Grudge Studio "Warlord Crafting Suite"

Reference: https://molochdagod.github.io/ObjectStore/brand

Palette tokens live in `artifacts/game-forge/src/index.css` (`:root` and `.dark`). Source colors:

| Role | Hex | CSS token |
| --- | --- | --- |
| BG base | `#0a0a0f` | `--background` |
| Card / panel | `#12121a` | `--card`, `--sidebar` |
| Surface | `#1a1a25` | `--secondary`, `--sidebar-accent` |
| Border | `#2a2a3a` | `--border` |
| **Primary gold** | `#d4af37` | `--primary`, `--ring`, `--sidebar-primary` |
| Gold light | `#f4d03f` | `--accent` (Play button) |
| Parchment | `#e8dfc8` | `--sidebar-foreground`, `--secondary-foreground` |
| Destructive | `#cc3333` | `--destructive` |

Fonts (loaded in `index.html`): `Cinzel Decorative` (display wordmark), `Cinzel` (headings), `Spectral SC` (lore/serif), `Inter` (body), `JetBrains Mono` (code).

Brand utility classes (in `src/index.css`):
- `font-display` / `font-heading` / `font-lore` — type stacks
- `brand-gold` — gold-gradient text fill
- `gold-glow` / `gold-glow-sm` / `gold-glow-lg` — signature `0 0 20px rgba(212,175,55,.2)` glow
- `hover-gold-glow` — interactive elevation

## Stack

| Layer | Technology |
| --- | --- |
| Renderer | three.js + @react-three/fiber + @react-three/drei (TransformControls, OrbitControls, GLTF loader) |
| Physics | Rapier (`@dimforge/rapier3d-compat`) via `@react-three/rapier` |
| Scripting (JS) | `new Function(...)` runtime with `start(entity, ctx)` / `update(entity, ctx)` lifecycle hooks |
| Scripting (C#) | Unity-flavoured C# transpiled to JS in `src/scene/csTranspile.ts` for the in-editor Play Mode preview. The codebase is laid out so the user can drop a real Blazor WebAssembly compile into `public/_framework/` for full .NET runtime support — see "Real Blazor C#" below. |
| State | Zustand (`src/store/editor.ts`) |
| Editor UI | shadcn/ui + Tailwind v4, `react-resizable-panels`, Monaco editor |
| Backend | Express + Drizzle ORM + Postgres |
| Type-safe API | OpenAPI 3.1 → orval → React Query hooks (`@workspace/api-client-react`) + zod validators (`@workspace/api-zod`) |
| External data | Grudge Studio object store proxy (5 min in-memory cache) |
| Asset uploads | Replit App Storage (GCS-backed) via presigned PUT URLs — `@workspace/object-storage-web` `useUpload` hook on the client, `/api/storage/*` routes on the server |

## Layout

```
artifacts/
  game-forge/        Vite + React frontend (the editor)
    src/
      App.tsx                  Top-level layout (toolbar / hierarchy / viewport / inspector / bottom panel)
      store/editor.ts          Zustand store — scene graph, selection, play mode, console
      scene/
        types.ts               SceneEntity, Transform, Environment
        EntityRenderer.tsx     Renders a SceneEntity in three.js (with optional Rapier RigidBody in play mode)
        csTranspile.ts         C# → JS transpiler for the play-mode runtime
        PlayRuntime.ts         Compiles + caches script modules, exposes `(entity, ctx)`
      editor/
        Toolbar.tsx            Top bar — project, scene, gizmo mode, save, play, scene export/import,
                               Templates submenu, prefab-mode banner
        Hierarchy.tsx          Scene list + indented entity TREE with expand/collapse, drag-drop
                               reparenting (cycle-prevented via wouldCycle), per-row Save-as-Prefab
        Inspector.tsx          Selected entity / environment editor (right)
        Viewport.tsx           R3F canvas with edit & play modes, recursive RenderNode for parented
                               entities (children inherit parent transforms), TransformControls, Stats
        ProjectPicker.tsx      Open / create project dialog
        AssetBrowser.tsx       Grudge tabs (weapons / items / enemies / quests) + project assets
        AssetDropZone.tsx      Document-level drag-and-drop ingest (.glb/.gltf/.obj/img/audio/scene-json)
        GlbInspectorDialog.tsx Modal that decodes the GLB binary container after upload
        ScriptEditor.tsx       Monaco editor with JS / C# selector
        Console.tsx            Debug.Log / engine output
        BottomPanel.tsx        Tabbed (Console | Assets | Scripts | Prefabs)
        PrefabsPanel.tsx       Project's prefab library — Spawn (instantiate into scene),
                               Open (sub-scene editor), Save Prefab, Delete
      lib/
        queryClient.ts
        grudge.ts              Grudge SDK wrapper (proxied through api-server)
        keyboard.ts            useKeyboardState — keys map for play-mode scripts
        glbInspect.ts          Pure-JS GLB binary decoder (header / chunks / counts)
        converters.ts          OBJ → GLB transcoder via three's OBJLoader + GLTFExporter
        hierarchy.ts           getDescendants (cycle-safe), wouldCycle, buildTree, cloneSubtree, reidTree
        sceneTemplates.ts      TPS Zombie Graveyard + FPS Turret Arena scene templates

  api-server/        Express backend
    src/
      lib/
        objectStorage.ts   GCS client wrapper + presigned URL generation (Replit sidecar auth)
        objectAcl.ts       ACL framework for protected objects
      routes/
        projects.ts        /api/projects CRUD + summary
        scenes.ts          /api/scenes CRUD nested under project
        scripts.ts         /api/scripts CRUD with default JS / C# templates
        assets.ts          /api/assets CRUD (uploaded + URL + grudge sources)
        grudge.ts          /api/grudge/{weapons,items,enemies,quests} proxy + flattening + 5min cache
        storage.ts         /api/storage/uploads/request-url + /api/storage/{public-objects,objects}/* serving

lib/
  api-spec/          OpenAPI 3.1 source of truth (openapi.yaml)
  api-client-react/  Generated React Query hooks (orval)
  api-zod/           Generated Zod request validators
  db/                Drizzle schemas + migrations
```

## Hotkeys

| Key | Action |
| --- | --- |
| `W` / `E` / `R` | Translate / rotate / scale gizmo |
| `Space` | Toggle Play Mode |
| `Click outside` | Deselect |

## Asset ingest

Drag any of the following onto the editor — `AssetDropZone` (mounted at the App root) routes them automatically:

| Type | Pipeline |
| --- | --- |
| `.glb` | App Storage upload → `inspectGlb()` decodes magic / version / chunks / counts → Inspector dialog → "Add to Scene" creates a `model` entity |
| `.gltf` | App Storage upload → Inspector (chunk view skipped) → "Add to Scene" |
| `.obj` | `objToGlb()` transcodes via three's OBJLoader + GLTFExporter → upload as GLB → Inspector → "Add to Scene" |
| `.png/.jpg/.webp/.ktx2` | App Storage upload → Project Asset record (image) |
| `.mp3/.wav/.ogg/.m4a` | App Storage upload → Project Asset record (audio) |
| `.json / .gfscene.json` | If the JSON has an `entities` array, it replaces the current scene (mark dirty; user must Save) |

The Toolbar `⋮` menu also exposes **Export scene JSON** (downloads `<name>.gfscene.json`) and **Import scene JSON** (opens file picker; same routing as a JSON drop).

## Real Blazor C#

The shipped C# runtime is a JS transpiler that handles a Unity-flavoured subset (`MonoBehaviour`, `Transform.Position.X`, `Input.GetKey`, `Debug.Log`, basic loops/arithmetic). For the full .NET runtime path:

1. Scaffold a Blazor WebAssembly project: `dotnet new blazorwasm -o csharp/GameForgeRuntime`
2. Implement an interop module that exposes `start(entityJson, ctxJson)` / `update(entityJson, ctxJson)` to JS via `[JSInvokable]`.
3. `dotnet publish -c Release` → copy `bin/Release/net9.0/publish/wwwroot/_framework/*` into `artifacts/game-forge/public/_framework/`.
4. The editor calls `blazorRuntimeAvailable()` (`src/scene/csTranspile.ts`) on load — when the boot.json is present, swap `compileCs` to dispatch into the Blazor runtime instead.

The transpiler path is intentionally "good enough" for in-browser iteration; the Blazor path is for shipping.

## Hierarchy & Prefabs

`SceneEntity.parentId` (string id of parent or `null` for root) makes the scene a tree:
- **Edit mode** — children render inside their parent's `<group>` so transforms compose. `TransformControls` writes the *local* transform (relative to parent) back into `entity.transform`.
- **Play mode** — same nesting; for physics children the initial spawn is parent-relative, then Rapier owns world coords from then on (parent moves do not drag children once both are alive).
- The Hierarchy panel is an indented tree with chevron expand/collapse, draggable rows for reparenting, drop on the empty area to unparent, and `wouldCycle` prevents loops.
- Cascade ops: `removeEntity`/`duplicateEntity` cover the whole subtree; `cloneSubtree` re-ids and remaps `parentId`s.

**Prefabs** (`lib/db/src/schema/prefabs.ts`, `/api/prefabs` routes) are reusable subtrees:
- **Save** — pick any entity in the hierarchy → click the package icon → enter a name → its subtree is snapshotted (`snapshotSubtree` strips outside parent links) and POSTed to `/api/prefabs`.
- **Spawn** — Prefabs panel "+ Spawn" instantiates a fresh copy with new ids into the current scene; instances are tagged with `prefabId` (visible as a small "P" badge).
- **Open** — Prefabs panel "Open" enters Unity-style sub-scene mode: the editor temporarily swaps `sceneData` for the prefab's entities, and a yellow banner appears in the Toolbar/Hierarchy. While in prefab mode, **Save** updates the prefab record (not a scene), Play is disabled, and the scenes list is hidden. Closing restores the snapshotted parent scene.

**Templates** — Toolbar `⋮` → Load template offers `TPS — Zombie Graveyard` and `FPS — Turret Arena`, both built with parent/child entities (player + parented weapon/muzzle, arena root with parented walls, turrets with parented barrel/eye).

## AI Worker (in-editor chat assistant)

A built-in chat assistant powered by Anthropic Claude (`claude-sonnet-4-6`) that can directly manipulate the editor — opens from the gold "AI Worker" button in the toolbar.

- Auth/transport: Replit AI Integrations proxy (env vars `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — no own API key required).
- Server endpoint: `artifacts/api-server/src/routes/ai.ts` exposes `POST /api/ai/chat` (Server-Sent Events). Stateless thin proxy: client sends `{ messages, tools, system }`, server streams `text_delta` events live and emits one `tool_use` event per tool block when the assistant turn completes.
- Tool definitions + executors live on the **client** (`artifacts/game-forge/src/lib/aiTools.ts`) because only the browser owns the live Zustand store, R3F scene, and undo stack — tool calls run synchronously against `useEditor` and tools that mutate the scene go through the same commands a human Ctrl+Z can undo.
- Conversation loop: `artifacts/game-forge/src/lib/aiClient.ts` parses the SSE stream, dispatches text deltas to the UI, executes tool calls, and POSTs back a `tool_result` user turn — looping until `stop_reason !== "tool_use"` (cap: 8 turns).
- Available tools (see `AI_TOOLS` array): `get_scene_summary`, `list_entities`, `list_builtin_models`, `add_entity`, `add_model_entity`, `update_entity`, `delete_entity`, `set_environment`, `clear_scene`, `generate_map`, `spawn_vfx_prefab`, `list_vfx_prefabs`, `create_script`, `attach_script`, `list_scripts`, `set_player`.
- UI: `artifacts/game-forge/src/editor/AIWorkerPanel.tsx` is a fixed slide-out panel (right edge, 400px) that does NOT block editor interaction — you can keep building while it streams. Each tool call renders as an expandable chip with input + result JSON for full traceability.

## Model entity polish (PlayerImporter-inspired)

`ModelComponent` (`scene/types.ts`) carries optional `clip` (named animation), `tint` (hex color), and `label` (floating sprite tag) fields, surfaced through the AI Worker's `add_model_entity` / `update_entity` tools and rendered by `LoadedModel` in `EntityRenderer.tsx`:
- `clip` overrides the default idle/loop heuristic in `useAnimations`.
- `tint` clones the GLB's MeshStandard/Phong/Basic materials before recoloring so coloring one entity doesn't bleed across other instances of the same builtin model.
- `label` builds a `THREE.CanvasTexture` pill sprite (gold border, dark background) attached above the model's bounding box.

## Database

Run `pnpm --filter @workspace/db run push --force` after any schema change in `lib/db/src/schema/*.ts`.

## API

The OpenAPI spec at `lib/api-spec/openapi.yaml` is the source of truth. Run `pnpm --filter @workspace/api-spec run codegen` after editing it to regenerate the React Query client and Zod validators.
