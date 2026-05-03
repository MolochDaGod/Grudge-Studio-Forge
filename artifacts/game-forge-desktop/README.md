# Grudge GameForge — Windows Desktop

Native Windows shell that wraps the existing `@workspace/game-forge` React
app inside Electron and adds four on-disk 3D tools that the browser build
cannot offer:

| Tool                  | Inputs / outputs                                                                  |
| --------------------- | --------------------------------------------------------------------------------- |
| **3D Converter**      | `.glb`, `.gltf`, `.fbx`, `.obj`, `.stl` → choose target format and output folder. |
| **Unzipper**          | Any `.zip` → extract to a folder, with progress and zip-slip protection.          |
| **Scene Deployer**    | Current GameForge scene → self-contained folder (`index.html` + bundled three.js + `scene.json`), optionally also a single `.zip`. |
| **Script Editor**     | Open / save `.js` / `.ts` files from disk, live preview iframe re-runs on save.   |

## Architecture

```text
artifacts/
├── game-forge/                 ← unchanged web build (still ships to the browser)
└── game-forge-desktop/
    ├── src/
    │   ├── main.ts             ← BrowserWindow, app menu, lifecycle
    │   ├── preload.ts          ← contextBridge: window.desktop = DesktopAPI
    │   ├── update-manager.ts   ← electron-updater wiring
    │   ├── recents.ts          ← per-tool MRU paths via electron-store
    │   └── ipc/
    │       ├── dialogs.ts      ← native open/save/openDirectory + fs.readText/writeText
    │       ├── tools.ts        ← convert3d / unzip / deployScene with progress events
    │       └── script.ts       ← script:read / script:write
    ├── electron-builder.yml    ← NSIS Windows installer + GitHub Releases publish
    └── tsconfig.main.json      ← compiles src → dist/main as CommonJS

lib/desktop-bridge/
└── src/index.ts                ← shared DesktopAPI types + useDesktopBridge() hook
```

The renderer is the **same React tree** as the browser build — no fork.
At runtime the in-app Tools panel calls `useDesktopBridge()` to detect
whether `window.desktop` is present:

- **Desktop:** the panel renders full controls and routes to the IPC
  handlers in `src/ipc/`.
- **Browser:** the panel renders a compact "Available in the desktop
  app" placeholder with a download link, so the same component file
  works in both shells.

## Dev mode

```bash
# 1. Install workspace deps (first time only)
pnpm install

# 2. Launch Vite (web) + Electron together with hot reload
pnpm --filter @workspace/game-forge-desktop run dev
```

`dev:renderer` boots the existing GameForge Vite server on
`PORT=24426`. `dev:main` waits for that URL with `wait-on`, compiles
the main + preload TS to `dist/main/`, then launches Electron with
`GAMEFORGE_DEV_URL=http://localhost:24426/` so the BrowserWindow
loads the Vite-served renderer (full HMR).

You can also run the dev server in the Replit workspace and open
the Electron shell on a Windows machine over your LAN by setting
`GAMEFORGE_DEV_URL` to the LAN URL when launching `electron .`.

## Building the Windows installer

```bash
pnpm --filter @workspace/game-forge-desktop run build:win
```

Steps performed:

1. `build:renderer` — `pnpm --filter @workspace/game-forge run build`
   produces the static bundle at `artifacts/game-forge/dist/public/`.
2. `build:main` — compiles `src/*.ts` → `dist/main/*.js` (CommonJS).
3. `electron-builder --win` — packages everything into
   `dist/installer/GrudgeGameForge-Setup-<version>.exe` (NSIS).

The installer is **unsigned**. Windows SmartScreen will warn until
you provide an Authenticode certificate via electron-builder's
`win.certificateFile` / `CSC_LINK` env var; out of scope for this
task.

To produce an unpacked test build (no installer, much faster):

```bash
pnpm --filter @workspace/game-forge-desktop run build:win:dir
```

The result lives at `dist/installer/win-unpacked/`.

## Auto-updates

Configured in `electron-builder.yml` against GitHub Releases:

```yaml
publish:
  - provider: github
    owner: ${env.GH_OWNER}
    repo:  ${env.GH_REPO}
    releaseType: release
```

To publish a release that triggers updates for installed clients:

```bash
export GH_OWNER=your-org
export GH_REPO=grudge-gameforge
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxx  # repo:public_repo / repo scope
pnpm --filter @workspace/game-forge-desktop run release
```

`UpdateManager` (`src/update-manager.ts`) checks once on launch, and
again whenever the user clicks **Help → Check for Updates**. Renderer
toasts are wired through the `updater:state` channel exposed via
`window.desktop.updates.onChange(listener)`.

## Optional native converters (FBX / OBJ / STL)

GLB ↔ GLTF round-trips ship out of the box via `@gltf-transform/core`.
Cross-format conversions to / from FBX, OBJ, or STL require one of:

- **fbx2gltf** — drop the platform binary into
  `artifacts/game-forge-desktop/bin/fbx2gltf.exe` and re-build; the
  converter will detect and prefer it for any `.fbx` input.
- **assimp-js** — install `assimpjs` and `assimp-wasm` and add an
  alternate code path in `ipc/tools.ts → convert3d`.

Until then the converter writes a `*.unconverted.<ext>` passthrough
copy and surfaces a clear warning in the UI rather than silently
producing an empty file.

## Out of scope (intentional)

- macOS (`.dmg`) and Linux (`.AppImage`) builds — the Electron config
  is structured so adding `mac:` / `linux:` blocks in
  `electron-builder.yml` is a small follow-up.
- Code signing certificates and notarization.
- Microsoft Store packaging.
- Cloud-hosted scene deployment (Scene Deployer produces a local
  folder/zip; uploading is a separate task).
