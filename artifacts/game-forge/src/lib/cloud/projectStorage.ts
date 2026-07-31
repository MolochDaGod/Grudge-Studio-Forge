/**
 * Project storage plane — local (guest/offline) vs Puter cloud (Grudge users).
 *
 * Responsibilities:
 *   - Resolve active backend from auth (Puter signed-in → puter, else local)
 *   - Persist indexes (small) and payloads (scenes) with IDB for large local data
 *   - Migrate local projects → Puter after sign-in (opt-in / one-shot)
 *   - Expose status for AI Worker + UI
 *
 * Not responsible for: R2 binaries, Railway player bag, edge agent D1 jobs.
 */

import { get, set, del, keys as idbKeys } from "idb-keyval";
import { isPuterSignedIn } from "./puterCloud";
import type { ProjectStorageBackend } from "@/lib/forgeEnv";
import { forgeEnvSnapshot } from "@/lib/forgeEnv";

const IDB_PREFIX = "grudge:forge:idb:";
const LOCAL_INDEX_PREFIX = "grudge:forge:";
const MIGRATE_FLAG = "grudge.forge.migratedToPuterAt";

export function activeStorageBackend(): ProjectStorageBackend {
  return isPuterSignedIn() ? "puter" : "local";
}

/** localStorage get with parse. */
export function localJsonGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function localJsonSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function localJsonDelete(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Write a large payload (scene graph). Tries localStorage first; on quota
 * falls back to IndexedDB so guests can still save multi-MB maps.
 */
export async function localPayloadWrite(
  collection: string,
  id: number,
  data: unknown,
): Promise<"local" | "idb" | "none"> {
  const lsKey = `${LOCAL_INDEX_PREFIX}${collection}:${id}:data`;
  const idbKey = `${IDB_PREFIX}${collection}:${id}`;
  const ok = localJsonSet(lsKey, data);
  if (ok) {
    // Mirror to IDB for resilience
    try {
      await set(idbKey, data);
    } catch {
      /* optional */
    }
    return "local";
  }
  try {
    await set(idbKey, data);
    // Mark pointer so readers know payload is in IDB
    localJsonSet(`${lsKey}:loc`, "idb");
    return "idb";
  } catch {
    return "none";
  }
}

export async function localPayloadRead<T>(
  collection: string,
  id: number,
): Promise<T | null> {
  const lsKey = `${LOCAL_INDEX_PREFIX}${collection}:${id}:data`;
  const fromLs = localJsonGet<T>(lsKey);
  if (fromLs != null) return fromLs;
  const idbKey = `${IDB_PREFIX}${collection}:${id}`;
  try {
    const v = await get<T>(idbKey);
    return v ?? null;
  } catch {
    return null;
  }
}

export async function localPayloadDelete(
  collection: string,
  id: number,
): Promise<void> {
  const lsKey = `${LOCAL_INDEX_PREFIX}${collection}:${id}:data`;
  localJsonDelete(lsKey);
  localJsonDelete(`${lsKey}:loc`);
  try {
    await del(`${IDB_PREFIX}${collection}:${id}`);
  } catch {
    /* ignore */
  }
}

export interface ProjectStorageStatus {
  backend: ProjectStorageBackend;
  puterSignedIn: boolean;
  localProjectCount: number;
  puterReady: boolean;
  migratedToPuterAt: string | null;
  planes: ReturnType<typeof forgeEnvSnapshot>["storage"];
  hints: string[];
}

/** Count projects in local index (even if currently signed into Puter). */
export function countLocalProjects(): number {
  const idx = localJsonGet<{ id: number }[]>("grudge:forge:projects:index");
  return Array.isArray(idx) ? idx.length : 0;
}

export function getProjectStorageStatus(): ProjectStorageStatus {
  const puter = isPuterSignedIn();
  const backend = activeStorageBackend();
  const localCount = countLocalProjects();
  const migrated = localStorage.getItem(MIGRATE_FLAG);
  const snap = forgeEnvSnapshot({ isPuterSignedIn: puter, storageBackend: backend });
  const hints: string[] = [];
  if (!puter && localCount > 0) {
    hints.push(
      "Projects are on this device only. Sign in with Puter to sync to Grudge cloud.",
    );
  }
  if (puter && localCount > 0 && !migrated) {
    hints.push(
      `${localCount} local project(s) can be uploaded to Puter (migrateLocalProjectsToPuter).`,
    );
  }
  if (puter) {
    hints.push("Cloud Save active — indexes in Puter KV, scenes in Puter FS.");
  }
  return {
    backend,
    puterSignedIn: puter,
    localProjectCount: localCount,
    puterReady: puter,
    migratedToPuterAt: migrated,
    planes: snap.storage,
    hints,
  };
}

/**
 * Copy local project indexes + scene/script payloads into Puter cloud.
 * Requires isPuterSignedIn(). Does not delete local copy (safe dual-write).
 *
 * Caller must pass Puter write fns to avoid circular imports with puterDataProvider.
 */
export async function migrateLocalProjectsToPuter(ops: {
  kvSet: (key: string, value: unknown) => Promise<boolean>;
  fsWrite: (path: string, body: string) => Promise<boolean>;
}): Promise<{
  ok: boolean;
  migratedProjects: number;
  migratedScenes: number;
  error?: string;
}> {
  if (!isPuterSignedIn()) {
    return {
      ok: false,
      migratedProjects: 0,
      migratedScenes: 0,
      error: "Sign in with Puter first.",
    };
  }

  try {
    const collections = ["projects", "scenes", "scripts", "assets", "prefabs"] as const;
    let migratedProjects = 0;
    let migratedScenes = 0;

    for (const col of collections) {
      const indexKey = `grudge:forge:${col}:index`;
      const localIndex = localJsonGet<Record<string, unknown>[]>(indexKey) ?? [];
      if (localIndex.length === 0) continue;

      // Merge with any existing Puter index (caller should pass empty if new)
      const wrote = await ops.kvSet(indexKey, localIndex);
      if (!wrote) {
        return {
          ok: false,
          migratedProjects,
          migratedScenes,
          error: `Failed to write Puter KV index for ${col}`,
        };
      }

      if (col === "projects") migratedProjects = localIndex.length;

      // Hydrate scene payloads into Puter FS
      if (col === "scenes") {
        for (const entry of localIndex) {
          const id = entry.id as number;
          if (typeof id !== "number") continue;
          const data = await localPayloadRead("scenes", id);
          if (data == null) continue;
          const fsPath = `Grudge/forge/scenes/${id}.json`;
          const ok = await ops.fsWrite(fsPath, JSON.stringify(data));
          if (ok) migratedScenes += 1;
        }
      }
    }

    // nextId counter
    const next =
      parseInt(localStorage.getItem("grudge.forge.nextId") ?? "0", 10) || 0;
    if (next > 0) await ops.kvSet("grudge:forge:nextId", next);

    localStorage.setItem(MIGRATE_FLAG, new Date().toISOString());
    return { ok: true, migratedProjects, migratedScenes };
  } catch (err) {
    return {
      ok: false,
      migratedProjects: 0,
      migratedScenes: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** List IDB keys for diagnostics (agent_stack_status). */
export async function listLocalIdbPayloadKeys(): Promise<string[]> {
  try {
    const all = await idbKeys();
    return all
      .map(String)
      .filter((k) => k.startsWith(IDB_PREFIX) || k.startsWith("gameforge:draft:"));
  } catch {
    return [];
  }
}
