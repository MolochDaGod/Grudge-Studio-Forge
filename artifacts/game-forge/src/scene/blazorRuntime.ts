/**
 * Browser-side loader for the GameForge .NET runtime.
 *
 * The C# project under `csharp/GameForgeRuntime/` is a Blazor WebAssembly
 * project that exposes a small JS-interop surface via `[JSExport]`
 * (`GameForge.ScriptHost`). After `dotnet publish` writes the runtime to
 * `artifacts/game-forge/public/_framework/`, we lazy-load it the first time
 * play mode runs so the dev experience stays snappy for users who never
 * touch real C# scripting.
 *
 * The host-builder `dotnet.create()` API is the lower-level entry point
 * shared by Blazor WASM and the WebAssembly Browser SDK; we use it
 * directly so we get back `getAssemblyExports`, which in turn lets us call
 * `[JSExport]` methods straight from JS without the Blazor component
 * lifecycle.
 */

declare global {
  // eslint-disable-next-line no-var
  var __gameForgeLog: ((level: string, msg: string) => void) | undefined;
  // eslint-disable-next-line no-var
  var __GameForgeRuntime: GameForgeRuntime | null | undefined;
}

export interface ScriptHostExports {
  GameForge: {
    ScriptHost: {
      Boot: () => string;
      RegisterScriptType: (scriptName: string, assemblyBase64: string) => boolean;
      AttachScript: (
        entityId: string,
        entityName: string,
        scriptName: string,
        transformJson: string,
      ) => boolean;
      TickEntity: (entityId: string, deltaTime: number, transformJson: string) => string;
      DetachEntity: (entityId: string) => void;
      ClearAll: () => void;
      SetKey: (key: string, down: boolean) => void;
    };
  };
}

export interface GameForgeRuntime {
  banner: string;
  exports: ScriptHostExports;
}

interface DotnetHostBuilder {
  withDiagnosticTracing(enabled: boolean): DotnetHostBuilder;
  withApplicationArguments(...args: string[]): DotnetHostBuilder;
  withConfig(config: Record<string, unknown>): DotnetHostBuilder;
  withResourceLoader(loader: unknown): DotnetHostBuilder;
  create(): Promise<{
    getAssemblyExports: (name: string) => Promise<unknown>;
    getConfig: () => { mainAssemblyName?: string };
    setModuleImports?: (name: string, imports: Record<string, unknown>) => void;
  }>;
}

interface DotnetModule {
  dotnet: DotnetHostBuilder;
}

let loadPromise: Promise<GameForgeRuntime | null> | null = null;

function installLogBridge(): void {
  if (typeof globalThis.__gameForgeLog === "function") return;
  globalThis.__gameForgeLog = (level: string, msg: string) => {
    const fn =
      level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn("[C#]", msg);
  };
}

function frameworkBase(): string {
  // Vite's `import.meta.env.BASE_URL` is always "/" or "/sub/path/" (with
  // trailing slash). Normalize to ensure exactly one slash before
  // `_framework/` regardless of how the artifact is mounted.
  const raw = import.meta.env.BASE_URL ?? "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

async function frameworkExists(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}_framework/blazor.boot.json`, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

export function loadBlazorRuntime(): Promise<GameForgeRuntime | null> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const baseUrl = frameworkBase();
    if (!(await frameworkExists(baseUrl))) {
      return null;
    }

    installLogBridge();

    try {
      // The `_framework/` directory is shipped from `public/` — Vite refuses
      // to resolve dynamic imports of paths it considers "in /public" because
      // those bypass plugin transforms. Building a fully-qualified URL with
      // the page origin makes Vite treat the specifier as an external module
      // (combined with the @vite-ignore hint), so it round-trips through the
      // browser's own loader rather than Vite's module graph.
      const moduleUrl = new URL(`${baseUrl}_framework/dotnet.js`, window.location.origin).href;
      const mod = (await import(/* @vite-ignore */ moduleUrl)) as DotnetModule;
      const runtime = await mod.dotnet.withDiagnosticTracing(false).create();
      const cfg = runtime.getConfig();
      const mainAssembly = cfg.mainAssemblyName ?? "GameForgeRuntime";
      const exports = (await runtime.getAssemblyExports(mainAssembly)) as ScriptHostExports;
      const banner = exports.GameForge.ScriptHost.Boot();
      // eslint-disable-next-line no-console
      console.log(`[GameForge] ${banner}`);
      const handle: GameForgeRuntime = { banner, exports };
      globalThis.__GameForgeRuntime = handle;
      return handle;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[GameForge] Blazor runtime failed to load:", err);
      globalThis.__GameForgeRuntime = null;
      return null;
    }
  })();
  return loadPromise;
}

export function getLoadedRuntime(): GameForgeRuntime | null {
  return globalThis.__GameForgeRuntime ?? null;
}

export function resetBlazorRuntime(): void {
  const rt = getLoadedRuntime();
  if (rt) {
    try {
      rt.exports.GameForge.ScriptHost.ClearAll();
    } catch {
      /* noop */
    }
  }
}
