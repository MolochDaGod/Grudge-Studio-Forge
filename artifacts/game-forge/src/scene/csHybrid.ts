/**
 * Hybrid C# scripting model (canonical):
 *
 * | Mode | When | Runtime |
 * |------|------|---------|
 * | **transpile** (default) | `language: "cs"` source without pack directive | `csTranspile` → JS start/update |
 * | **blazor** | `// @forge-runtime: blazor` + pack or assembly | Real .NET Attach/Tick via WASM |
 *
 * Directives (first 40 lines of source, case-insensitive):
 * ```
 * // @forge-runtime: blazor
 * // @forge-pack: Spin
 * // @forge-assembly: <base64 dll bytes>
 * ```
 *
 * Production packs shipped in GameForgeRuntime: Spin, Bob, Strafe.
 * Mod packs: precompile a MonoBehaviour assembly → base64 → @forge-assembly.
 */

export type CsRuntimeMode = "transpile" | "blazor";

export interface CsHybridMeta {
  mode: CsRuntimeMode;
  /** Builtin pack id (Spin | Bob | Strafe | custom registered). */
  pack?: string;
  /** Base64 of a precompiled assembly containing one MonoBehaviour. */
  assemblyBase64?: string;
  /** Script type key used for Register/Attach (defaults to pack name). */
  scriptTypeName: string;
}

const RUNTIME_RE = /@forge-runtime\s*:\s*(transpile|blazor)/i;
const PACK_RE = /@forge-pack\s*:\s*([A-Za-z0-9_.-]+)/i;
const ASSEMBLY_RE = /@forge-assembly\s*:\s*([A-Za-z0-9+/=]+)/i;

/** Known builtins (must match C# ScriptHost.Builtins). */
export const FORGE_BUILTIN_PACKS = ["Spin", "Bob", "Strafe"] as const;
export type ForgeBuiltinPack = (typeof FORGE_BUILTIN_PACKS)[number];

export function isForgeBuiltinPack(name: string): name is ForgeBuiltinPack {
  return (FORGE_BUILTIN_PACKS as readonly string[]).some(
    (p) => p.toLowerCase() === name.toLowerCase(),
  );
}

/**
 * Parse hybrid directives from C# (or annotated) source.
 * Default: transpile (live edit / preview).
 */
export function parseCsHybridMeta(source: string, scriptName = "Script"): CsHybridMeta {
  const head = source.slice(0, 4000);
  const lines = head.split(/\r?\n/).slice(0, 40).join("\n");

  const runtimeMatch = lines.match(RUNTIME_RE);
  const packMatch = lines.match(PACK_RE);
  const assemblyMatch = lines.match(ASSEMBLY_RE);

  const wantsBlazor =
    (runtimeMatch?.[1]?.toLowerCase() === "blazor") ||
    !!packMatch ||
    !!assemblyMatch;

  if (!wantsBlazor) {
    return { mode: "transpile", scriptTypeName: scriptName };
  }

  const pack = packMatch?.[1]?.trim();
  const assemblyBase64 = assemblyMatch?.[1]?.trim();
  const scriptTypeName = pack || scriptName || "UserScript";

  return {
    mode: "blazor",
    pack: pack || undefined,
    assemblyBase64: assemblyBase64 || undefined,
    scriptTypeName,
  };
}

/** Sample C# source that runs on the real Blazor Spin pack. */
export function blazorPackTemplateSource(pack: ForgeBuiltinPack = "Spin"): string {
  return `// @forge-runtime: blazor
// @forge-pack: ${pack}
//
// Hybrid: this file does not transpile. Play mode loads GameForgeRuntime.wasm,
// registers the built-in "${pack}" MonoBehaviour, then AttachScript + TickEntity
// each frame. Edit live C# without this header → JS transpile instead.
//
// Rebuild runtime after changing C# packs:
//   bash csharp/GameForgeRuntime/build.sh

using GameForge;

public class ${pack}Proxy : MonoBehaviour
{
    // Body lives in GameForge.Behaviours.${pack}Behaviour (WASM builtin).
    public override void Update(float dt) { }
}
`;
}
