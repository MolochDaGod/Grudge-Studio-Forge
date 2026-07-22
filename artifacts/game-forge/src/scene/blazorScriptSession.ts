/**
 * Production Blazor attach/tick session for hybrid C# packs.
 *
 * Lifecycle (play mode):
 *  1. ensureReady() — await loadBlazorRuntime (not fire-and-forget)
 *  2. registerPack / registerAssembly once per script type
 *  3. attach(entity) on first frame for each entity
 *  4. tick(entity, dt) every frame → transform JSON in/out
 *  5. syncKeys(keys) when keyboard changes
 *  6. clear() on play exit
 */

import {
  getLoadedRuntime,
  loadBlazorRuntime,
  resetBlazorRuntime,
  type GameForgeRuntime,
} from "./blazorRuntime";
import { isForgeBuiltinPack, type CsHybridMeta } from "./csHybrid";

export interface BlazorTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export function serializeTransform(t: BlazorTransform): string {
  return JSON.stringify({
    position: t.position,
    rotation: t.rotation,
    scale: t.scale,
  });
}

export function parseTransformJson(json: string, fallback: BlazorTransform): BlazorTransform {
  try {
    const o = JSON.parse(json) as {
      position?: number[];
      rotation?: number[];
      scale?: number[];
    };
    const pos = o.position;
    const rot = o.rotation;
    const scl = o.scale;
    return {
      position:
        Array.isArray(pos) && pos.length === 3
          ? [Number(pos[0]), Number(pos[1]), Number(pos[2])]
          : fallback.position,
      rotation:
        Array.isArray(rot) && rot.length === 3
          ? [Number(rot[0]), Number(rot[1]), Number(rot[2])]
          : fallback.rotation,
      scale:
        Array.isArray(scl) && scl.length === 3
          ? [Number(scl[0]), Number(scl[1]), Number(scl[2])]
          : fallback.scale,
    };
  } catch {
    return fallback;
  }
}

/** JS fallback ticks when WASM lacks RegisterBuiltin (stale _framework). Degrees. */
type FallbackTick = (
  t: BlazorTransform,
  dt: number,
  keys: Record<string, boolean>,
  state: { originY?: number; elapsed: number },
) => BlazorTransform;

const FALLBACK_PACKS: Record<string, FallbackTick> = {
  Spin: (t, dt) => ({
    ...t,
    rotation: [t.rotation[0], t.rotation[1] + 90 * dt, t.rotation[2]],
  }),
  Bob: (t, dt, _keys, state) => {
    state.elapsed += dt;
    if (state.originY === undefined) state.originY = t.position[1];
    const y = state.originY + Math.sin(state.elapsed * 2) * 0.35;
    return { ...t, position: [t.position[0], y, t.position[2]] };
  },
  Strafe: (t, dt, keys) => {
    const h =
      (keys.ArrowRight || keys.d || keys.D ? 1 : 0) - (keys.ArrowLeft || keys.a || keys.A ? 1 : 0);
    const v =
      (keys.ArrowUp || keys.w || keys.W ? 1 : 0) - (keys.ArrowDown || keys.s || keys.S ? 1 : 0);
    if (!h && !v) return t;
    const speed = 4;
    return {
      ...t,
      position: [t.position[0] + h * speed * dt, t.position[1], t.position[2] - v * speed * dt],
    };
  },
};

export class BlazorScriptSession {
  private ready: Promise<GameForgeRuntime | null> | null = null;
  private registered = new Set<string>();
  private attached = new Set<string>();
  private lastKeys = new Map<string, boolean>();
  /** When true, entity uses JS pack fallback (stale WASM without RegisterBuiltin). */
  private fallbackEntities = new Map<string, { pack: string; state: { originY?: number; elapsed: number } }>();
  private keysSnapshot: Record<string, boolean> = {};
  private log: (level: "log" | "warn" | "error", msg: string) => void;

  constructor(log?: (level: "log" | "warn" | "error", msg: string) => void) {
    this.log = log ?? ((level, msg) => {
      const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      fn(`[BlazorSession] ${msg}`);
    });
  }

  ensureReady(): Promise<GameForgeRuntime | null> {
    if (!this.ready) {
      this.ready = loadBlazorRuntime().then((rt) => {
        if (rt) this.log("log", rt.banner);
        else this.log("warn", "Blazor runtime unavailable — hybrid packs will fall back to transpile if source allows");
        return rt;
      });
    }
    return this.ready;
  }

  isReady(): boolean {
    return !!getLoadedRuntime();
  }

  host() {
    return getLoadedRuntime()?.exports.GameForge.ScriptHost ?? null;
  }

  /**
   * Register a hybrid meta (builtin pack and/or assembly). Idempotent per scriptTypeName.
   * Returns true if either real WASM register or JS pack fallback is available.
   */
  register(meta: CsHybridMeta): boolean {
    if (meta.mode !== "blazor") return false;
    const key = meta.scriptTypeName;
    if (this.registered.has(key) || (meta.pack && this.registered.has(meta.pack))) return true;

    const host = this.host();
    let ok = false;

    if (host && meta.assemblyBase64) {
      ok = host.RegisterScriptType(key, meta.assemblyBase64);
    } else if (host && meta.pack) {
      const regBuiltin = host.RegisterBuiltin;
      if (typeof regBuiltin === "function") {
        ok = regBuiltin.call(host, meta.pack);
      } else if (isForgeBuiltinPack(meta.pack) && FALLBACK_PACKS[meta.pack]) {
        this.log(
          "warn",
          `RegisterBuiltin missing in WASM — using JS fallback for pack '${meta.pack}'. Rebuild: bash csharp/GameForgeRuntime/build.sh`,
        );
        ok = true;
        this.registered.add(`fallback:${meta.pack}`);
      } else {
        this.log("error", "RegisterBuiltin missing — rebuild csharp/GameForgeRuntime (build.sh)");
      }
    } else if (meta.pack && isForgeBuiltinPack(meta.pack) && FALLBACK_PACKS[meta.pack]) {
      // No WASM at all — still allow production packs via JS fallback.
      this.log("warn", `Blazor WASM offline — JS fallback pack '${meta.pack}'`);
      ok = true;
      this.registered.add(`fallback:${meta.pack}`);
    }

    if (ok) {
      this.registered.add(key);
      if (meta.pack) this.registered.add(meta.pack);
    } else {
      this.log("error", `Failed to register Blazor pack '${key}'`);
    }
    return ok;
  }

  attach(
    entityId: string,
    entityName: string,
    scriptTypeName: string,
    transform: BlazorTransform,
  ): boolean {
    if (this.attached.has(entityId) || this.fallbackEntities.has(entityId)) return true;

    const pack = isForgeBuiltinPack(scriptTypeName) ? scriptTypeName : scriptTypeName;
    const useFallback =
      this.registered.has(`fallback:${pack}`) ||
      (isForgeBuiltinPack(pack) && !this.host()?.RegisterBuiltin);

    if (useFallback && isForgeBuiltinPack(pack) && FALLBACK_PACKS[pack]) {
      this.fallbackEntities.set(entityId, { pack, state: { elapsed: 0 } });
      this.attached.add(entityId);
      return true;
    }

    const host = this.host();
    if (!host) return false;
    const ok = host.AttachScript(entityId, entityName, scriptTypeName, serializeTransform(transform));
    if (ok) this.attached.add(entityId);
    else this.log("error", `AttachScript failed for ${entityName} (${scriptTypeName})`);
    return ok;
  }

  tick(entityId: string, delta: number, transform: BlazorTransform): BlazorTransform {
    const fb = this.fallbackEntities.get(entityId);
    if (fb) {
      const fn = FALLBACK_PACKS[fb.pack];
      return fn ? fn(transform, delta, this.keysSnapshot, fb.state) : transform;
    }
    const host = this.host();
    if (!host || !this.attached.has(entityId)) return transform;
    const out = host.TickEntity(entityId, delta, serializeTransform(transform));
    return parseTransformJson(out, transform);
  }

  detach(entityId: string): void {
    const host = this.host();
    if (host && this.attached.has(entityId) && !this.fallbackEntities.has(entityId)) {
      try {
        host.DetachEntity(entityId);
      } catch {
        /* noop */
      }
    }
    this.attached.delete(entityId);
    this.fallbackEntities.delete(entityId);
  }

  /** Push keyboard state into C# Input (and snapshot for JS pack fallbacks). */
  syncKeys(keys: Record<string, boolean>): void {
    this.keysSnapshot = keys;
    const host = this.host();
    if (!host) return;
    const seen = new Set<string>();
    for (const [k, down] of Object.entries(keys)) {
      seen.add(k);
      const prev = this.lastKeys.get(k) ?? false;
      if (prev !== down) {
        host.SetKey(k, down);
        this.lastKeys.set(k, down);
      }
    }
    for (const [k, down] of this.lastKeys) {
      if (!seen.has(k) && down) {
        host.SetKey(k, false);
        this.lastKeys.set(k, false);
      }
    }
  }

  clear(): void {
    resetBlazorRuntime();
    this.registered.clear();
    this.attached.clear();
    this.fallbackEntities.clear();
    this.lastKeys.clear();
    this.keysSnapshot = {};
    this.ready = null;
  }
}

/** Singleton for the active play session (reset on clear). */
let activeSession: BlazorScriptSession | null = null;

export function getBlazorScriptSession(
  log?: (level: "log" | "warn" | "error", msg: string) => void,
): BlazorScriptSession {
  if (!activeSession) activeSession = new BlazorScriptSession(log);
  return activeSession;
}

export function disposeBlazorScriptSession(): void {
  if (activeSession) {
    activeSession.clear();
    activeSession = null;
  }
}
