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

You can also run the dev server on any host and open the Electron
shell on a separate Windows machine over your LAN by setting
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

If the code-signing env vars described in
[Code signing the Windows installer](#code-signing-the-windows-installer)
are present, the produced `.exe` is Authenticode-signed. With an EV
certificate SmartScreen trusts the installer immediately; with a
standard OV certificate the signature is valid right away but
SmartScreen reputation builds over the first few hundred installs.
If the vars are unset the installer is still produced unsigned
(useful for local smoke tests) and Windows will warn end users on
launch — make sure release CI fails when the signing secrets are
missing so a public release is never shipped unsigned.

To produce an unpacked test build (no installer, much faster):

```bash
pnpm --filter @workspace/game-forge-desktop run build:win:dir
```

The result lives at `dist/installer/win-unpacked/`.

## Code signing the Windows installer

Unsigned installers trigger Windows SmartScreen ("Windows protected
your PC") for every user. To produce a trusted installer the
release build needs an Authenticode code-signing certificate from a
recognised CA (DigiCert, Sectigo, SSL.com, etc.). EV certificates
remove the SmartScreen warning immediately; standard OV certificates
build reputation over the first few hundred installs.

The certificate is **never committed to the repo** — it is supplied
to the build via environment variables / secrets that
electron-builder reads at package time.

### Option A — software certificate (`.pfx` file)

Use this when the CA gave you an exportable `.pfx` / `.p12`.

| Secret               | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| `CSC_LINK`           | Path to the `.pfx` on the build machine, **or** an `https://` URL, **or** the `.pfx` base64-encoded (e.g. `base64 -w0 cert.pfx`). |
| `CSC_KEY_PASSWORD`   | Password that unlocks the `.pfx`.                                   |

Then run the normal release command — electron-builder picks the
vars up automatically:

```bash
export CSC_LINK="$(base64 -w0 ./grudge-codesign.pfx)"
export CSC_KEY_PASSWORD='********'
pnpm --filter @workspace/game-forge-desktop run build:win
```

### Option B — hardware / EV certificate (token or HSM)

EV certs and many modern OV certs ship on a USB token / HSM where
the private key cannot be exported. In that case install the cert
into the Windows certificate store on the build machine and set:

| Secret                  | Value                                                  |
| ----------------------- | ------------------------------------------------------ |
| `WIN_CSC_SUBJECT_NAME`  | The certificate's Subject CN, e.g. `Grudge Studios LLC`. |

`electron-builder.yml` passes this through as `certificateSubjectName`
and electron-builder shells out to `signtool` against the installed
cert. The build must run on a Windows host with the token connected.

### Verifying the signature

After `build:win`, on a Windows machine:

```powershell
Get-AuthenticodeSignature .\dist\installer\GrudgeGameForge-Setup-*.exe
```

`Status` should be `Valid` and `SignerCertificate.Subject` should
match your CA-issued cert. Installing on a fresh Windows 10/11 VM
should no longer show the SmartScreen "unrecognized app" warning.

### CI

In GitHub Actions, store `CSC_LINK` (base64) and `CSC_KEY_PASSWORD`
(or `WIN_CSC_SUBJECT_NAME`) as repository secrets and expose them in
the release job's `env:`. They flow straight into electron-builder
without any extra wiring.

## Auto-updates

Configured in `electron-builder.yml` against GitHub Releases:

```yaml
publish:
  - provider: github
    owner: MolochDaGod
    repo: Grudge-Studio-Forge
    releaseType: release
```

To publish a release that triggers updates for installed clients:

```bash
export GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxx  # repo:public_repo / repo scope
pnpm --filter @workspace/game-forge-desktop run release
```

`UpdateManager` (`src/update-manager.ts`) checks once on launch, and
again whenever the user clicks **Help → Check for Updates**. Renderer
toasts are wired through the `updater:state` channel exposed via
`window.desktop.updates.onChange(listener)`.

## 3D converter format matrix

The 3D Converter handles every pair of GLB / GLTF / FBX / OBJ / STL
end-to-end with no extra binaries to install:

| Source ＼ Target | GLB | GLTF | FBX | OBJ | STL |
| --- | :-: | :-: | :-: | :-: | :-: |
| **GLB**         | ✓ | ✓ | ✓ | ✓ | ✓ |
| **GLTF**        | ✓ | ✓ | ✓ | ✓ | ✓ |
| **FBX**         | ✓ | ✓ | ✓ | ✓ | ✓ |
| **OBJ**         | ✓ | ✓ | ✓ | ✓ | ✓ |
| **STL**         | ✓ | ✓ | ✓ | ✓ | ✓ |

How it works (see `src/ipc/tools.ts → convert3d`):

- **GLB ↔ GLTF** — `@gltf-transform/core` with `prune()` + `dedup()`
  so the output is meaningfully smaller than a re-serialization.
- **FBX / OBJ / STL → GLB / GLTF** — the bundled
  [`assimpjs`](https://www.npmjs.com/package/assimpjs) WASM build of
  Assimp. For OBJ inputs, sibling `.mtl` and texture files are
  auto-included so material references resolve.
- **GLB / GLTF / FBX / OBJ / STL → OBJ / STL** — non-GLTF inputs
  round-trip through GLB via assimpjs first, then a tiny in-process
  serializer walks the gltf-transform document and writes triangles.
- **anything → FBX** — same pipeline, then a minimal ASCII FBX 7.4
  emitter (single Geometry + Model). Verified round-trip in
  Blender 4.x and Unity 2022 LTS.

The Assimp WASM bundle (`node_modules/assimpjs/dist/assimpjs.wasm`,
~2 MB) is automatically included in the installer via electron-builder
because it lives inside `node_modules`. No extra `bin/` files are
required.

## Out of scope (intentional)

- macOS (`.dmg`) and Linux (`.AppImage`) builds — the Electron config
  is structured so adding `mac:` / `linux:` blocks in
  `electron-builder.yml` is a small follow-up.
- macOS notarization (Apple Developer ID). Windows code signing is
  documented above.
- Microsoft Store packaging.
- Cloud-hosted scene deployment (Scene Deployer produces a local
  folder/zip; uploading is a separate task).
