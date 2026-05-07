/**
 * Thin wrapper around `puter.fs` and `puter.kv` with a uniform
 * "guest-aware" no-op pattern.
 *
 * Every operation transparently no-ops (returning a structured
 * `{ ok: false, reason: "guest" | "sdk-unavailable" }`) when the user
 * isn't signed in via Puter, so call sites don't need to gate every
 * line on `if (signedIn)`. They just check `result.ok`.
 *
 * Read ops return `null` (or `[]` for list) on a no-op so `??` chains
 * keep working without exception handling.
 */
import { useAuth } from "@/store/auth";
import { getPuter, loadPuterSdk, type PuterSdk } from "@/lib/puterSdk";

export type CloudReason = "guest" | "sdk-unavailable" | "error";
export interface CloudOk<T = unknown> {
  ok: true;
  data: T;
}
export interface CloudErr {
  ok: false;
  reason: CloudReason;
  message?: string;
}
export type CloudResult<T = unknown> = CloudOk<T> | CloudErr;

/** True when the editor's auth store reports a real Puter session. */
export function isPuterSignedIn(): boolean {
  return useAuth.getState().isPuterSignedIn;
}

let warnedGuest = false;
function warnGuestOnce(op: string): void {
  if (warnedGuest) return;
  warnedGuest = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[puterCloud] '${op}' skipped — sign in with Puter to enable cloud features.`,
  );
}

async function requireSdk(op: string): Promise<PuterSdk | CloudErr> {
  if (!isPuterSignedIn()) {
    warnGuestOnce(op);
    return { ok: false, reason: "guest", message: "Not signed in with Puter." };
  }
  let sdk = getPuter();
  if (!sdk) {
    try {
      sdk = await loadPuterSdk();
    } catch {
      return {
        ok: false,
        reason: "sdk-unavailable",
        message: "Puter SDK failed to load.",
      };
    }
  }
  return sdk;
}

/** Build a stable absolute path under the user's drive, e.g.
 *  `path("Grudge", "projects", "42", "scene.json")`. */
export function path(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter((s) => s.length > 0)
    .join("/");
}

// ── KV ───────────────────────────────────────────────────────────────
// Some SDK builds expose `puter.kv`, others `puter.kv.get/set/delete`. We
// reach for either shape and treat absence as `sdk-unavailable`.
type KvFns = {
  get?: (k: string) => Promise<unknown> | unknown;
  set?: (k: string, v: unknown) => Promise<unknown> | unknown;
  del?: (k: string) => Promise<unknown> | unknown;
  delete?: (k: string) => Promise<unknown> | unknown;
  list?: (pattern?: string) => Promise<string[]> | string[];
};

function kvFns(sdk: PuterSdk): KvFns | null {
  const kv = (sdk as unknown as { kv?: KvFns }).kv;
  return kv ?? null;
}

async function withSdk<T>(
  op: string,
  body: (sdk: PuterSdk) => Promise<CloudResult<T>>,
): Promise<CloudResult<T>> {
  const r = await requireSdk(op);
  if ("ok" in r && r.ok === false) return r;
  try {
    return await body(r as PuterSdk);
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export const cloud = {
  /** Reachability flag. Useful for UI gating. */
  isAvailable: isPuterSignedIn,

  kv: {
    get: <T = unknown>(key: string): Promise<CloudResult<T | null>> =>
      withSdk("kv.get", async (sdk) => {
        const fns = kvFns(sdk);
        if (!fns?.get) {
          return {
            ok: false,
            reason: "sdk-unavailable",
            message: "puter.kv unavailable",
          };
        }
        const raw = await Promise.resolve(fns.get(key));
        return { ok: true, data: (raw ?? null) as T | null };
      }),
    set: (key: string, value: unknown): Promise<CloudResult<true>> =>
      withSdk("kv.set", async (sdk) => {
        const fns = kvFns(sdk);
        if (!fns?.set) {
          return { ok: false, reason: "sdk-unavailable" };
        }
        await Promise.resolve(fns.set(key, value));
        return { ok: true, data: true };
      }),
    delete: (key: string): Promise<CloudResult<true>> =>
      withSdk("kv.delete", async (sdk) => {
        const fns = kvFns(sdk);
        const del = fns?.delete ?? fns?.del;
        if (!del) return { ok: false, reason: "sdk-unavailable" };
        await Promise.resolve(del(key));
        return { ok: true, data: true };
      }),
    list: (pattern?: string): Promise<CloudResult<string[]>> =>
      withSdk("kv.list", async (sdk) => {
        const fns = kvFns(sdk);
        if (!fns?.list) {
          return { ok: false, reason: "sdk-unavailable", message: "puter.kv.list unavailable" };
        }
        const keys = await Promise.resolve(fns.list(pattern));
        return { ok: true, data: Array.isArray(keys) ? keys : [] };
      }),
  },

  fs: {
    read: (p: string): Promise<CloudResult<Blob>> =>
      withSdk("fs.read", async (sdk) => {
        const blob = await sdk.fs.read(p);
        return { ok: true, data: blob };
      }),
    readJson: <T = unknown>(p: string): Promise<CloudResult<T>> =>
      withSdk("fs.readJson", async (sdk) => {
        const blob = await sdk.fs.read(p);
        const text = await blob.text();
        return { ok: true, data: JSON.parse(text) as T };
      }),
    write: (
      p: string,
      data: Blob | string | ArrayBuffer,
      opts?: { overwrite?: boolean; createMissingParents?: boolean },
    ): Promise<CloudResult<true>> =>
      withSdk("fs.write", async (sdk) => {
        await sdk.fs.write(p, data, {
          overwrite: opts?.overwrite ?? true,
          createMissingParents: opts?.createMissingParents ?? true,
        });
        return { ok: true, data: true };
      }),
    mkdir: (p: string): Promise<CloudResult<true>> =>
      withSdk("fs.mkdir", async (sdk) => {
        await sdk.fs.mkdir(p, { createMissingParents: true, overwrite: false }).catch(
          () => undefined,
        );
        return { ok: true, data: true };
      }),
    list: (
      p: string,
    ): Promise<CloudResult<Array<{ name: string; is_dir: boolean }>>> =>
      withSdk("fs.list", async (sdk) => {
        const entries = await sdk.fs.readdir(p);
        return { ok: true, data: entries };
      }),
    delete: (p: string): Promise<CloudResult<true>> =>
      withSdk("fs.delete", async (sdk) => {
        const fs = (sdk.fs as unknown as { delete?: (p: string) => Promise<unknown> }).delete;
        if (!fs) return { ok: false, reason: "sdk-unavailable" };
        await fs.call(sdk.fs, p);
        return { ok: true, data: true };
      }),
  },

  path,
};

export type Cloud = typeof cloud;
