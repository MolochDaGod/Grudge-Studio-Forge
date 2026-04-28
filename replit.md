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
        Toolbar.tsx            Top bar — project, scene, gizmo mode, save, play
        Hierarchy.tsx          Scene list + entity tree (left)
        Inspector.tsx          Selected entity / environment editor (right)
        Viewport.tsx           R3F canvas with edit & play modes, TransformControls, Stats
        ProjectPicker.tsx      Open / create project dialog
        AssetBrowser.tsx       Grudge tabs (weapons / items / enemies / quests) + project assets
        ScriptEditor.tsx       Monaco editor with JS / C# selector
        Console.tsx            Debug.Log / engine output
        BottomPanel.tsx        Tabbed (Console | Assets | Scripts)
      lib/
        queryClient.ts
        grudge.ts              Grudge SDK wrapper (proxied through api-server)
        keyboard.ts            useKeyboardState — keys map for play-mode scripts

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

## Real Blazor C#

The shipped C# runtime is a JS transpiler that handles a Unity-flavoured subset (`MonoBehaviour`, `Transform.Position.X`, `Input.GetKey`, `Debug.Log`, basic loops/arithmetic). For the full .NET runtime path:

1. Scaffold a Blazor WebAssembly project: `dotnet new blazorwasm -o csharp/GameForgeRuntime`
2. Implement an interop module that exposes `start(entityJson, ctxJson)` / `update(entityJson, ctxJson)` to JS via `[JSInvokable]`.
3. `dotnet publish -c Release` → copy `bin/Release/net9.0/publish/wwwroot/_framework/*` into `artifacts/game-forge/public/_framework/`.
4. The editor calls `blazorRuntimeAvailable()` (`src/scene/csTranspile.ts`) on load — when the boot.json is present, swap `compileCs` to dispatch into the Blazor runtime instead.

The transpiler path is intentionally "good enough" for in-browser iteration; the Blazor path is for shipping.

## Database

Run `pnpm --filter @workspace/db run push --force` after any schema change in `lib/db/src/schema/*.ts`.

## API

The OpenAPI spec at `lib/api-spec/openapi.yaml` is the source of truth. Run `pnpm --filter @workspace/api-spec run codegen` after editing it to regenerate the React Query client and Zod validators.
