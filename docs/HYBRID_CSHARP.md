---
layout: default
title: Hybrid C#
nav_order: 11
---
# Hybrid C# scripting (production)

## Decision

| Layer | Technology |
|-------|------------|
| Engine core | TypeScript (Three.js, Rapier, nav, AI) |
| Designer scripts | JS `exports.start/update` |
| Live C# edit | Subset **transpile â†’ JS** |
| Production C# packs / mods | **Blazor WASM** attach/tick |

Do **not** put animations, island gen, weapon colliders, or network authority in C# or Lua.

## Directives

```csharp
// @forge-runtime: blazor
// @forge-pack: Spin
```

or

```csharp
// @forge-runtime: blazor
// @forge-assembly: <base64-of-precompiled-dll>
```

Without headers, `language: "cs"` uses the transpile path.

## Built-in packs

| Pack | Behaviour |
|------|-----------|
| `Spin` | Rotate Y (deg/s) |
| `Bob` | Vertical sin bob |
| `Strafe` | WASD / arrows via `Input` + JS `SetKey` |

## Rebuild WASM

```bash
# Linux/macOS / Git Bash
bash csharp/GameForgeRuntime/build.sh

# Windows PowerShell
cd csharp/GameForgeRuntime
dotnet publish -c Release
# copy bin/Release/net8.0/publish/wwwroot/_framework â†’ artifacts/game-forge/public/_framework
```

Ship `_framework/` with the Vite static build (Vercel serves `artifacts/game-forge/dist/public`).

## Play lifecycle

1. Play â†’ `ensureBlazorRuntime()` / `loadBlazorRuntime()`
2. `RegisterBuiltin(pack)` or `RegisterScriptType(name, base64)`
3. First frame: `AttachScript(entityId, name, type, transformJson)`
4. Each frame: `SetKey` edges â†’ `TickEntity` â†’ apply pos/rot to Rapier/group
5. Stop play: `ClearAll` / `disposeBlazorScriptSession`

## Degrees vs radians

C# `Transform.Rotation` is **degrees**. Three.js Euler is **radians**. The play loop converts at the Blazor boundary.

