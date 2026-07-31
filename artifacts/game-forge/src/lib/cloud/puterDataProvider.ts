/**
 * Puter-backed data provider — replaces the Express + PostgreSQL api-server.
 *
 * Storage planes (see projectStorage.ts + forgeEnv.ts):
 *   Puter signed-in → KV indexes + FS payloads under Grudge/forge/
 *   Guest / local    → localStorage indexes + IndexedDB payloads (large scenes)
 *
 * Edge free-ai D1 is for agent jobs only — never project bodies.
 * Railway is player bag SSOT — never Forge editor projects.
 */
import { cloud, isPuterSignedIn } from "./puterCloud";
import {
  localJsonGet,
  localJsonSet,
  localJsonDelete,
  localPayloadRead,
  localPayloadWrite,
  localPayloadDelete,
  getProjectStorageStatus,
  migrateLocalProjectsToPuter,
  activeStorageBackend,
} from "./projectStorage";

// ── ID generation ──────────────────────────────────────────────────────
const LOCAL_COUNTER_KEY = "grudge.forge.nextId";

async function nextId(): Promise<number> {
  if (isPuterSignedIn()) {
    const r = await cloud.kv.get<number>("grudge:forge:nextId");
    const current = r.ok ? (r.data ?? 0) : 0;
    const next = current + 1;
    await cloud.kv.set("grudge:forge:nextId", next);
    return next;
  }
  // Guest fallback: localStorage counter
  const current = parseInt(localStorage.getItem(LOCAL_COUNTER_KEY) ?? "0", 10);
  const next = current + 1;
  localStorage.setItem(LOCAL_COUNTER_KEY, String(next));
  return next;
}

function now(): string {
  return new Date().toISOString();
}

// ── Generic KV-backed collection ───────────────────────────────────────
// Each entity type stores:
//   KV index:  grudge:forge:<collection>:index  →  <T>[]
//   FS payload (optional, for large data like scene JSON):
//              Grudge/forge/<collection>/<id>.json
//   Local guest: same keys in localStorage; scene payloads may live in IDB.

type HasId = { id: number };

async function readIndex<T extends HasId>(collection: string): Promise<T[]> {
  const kvKey = `grudge:forge:${collection}:index`;

  if (isPuterSignedIn()) {
    const r = await cloud.kv.get<T[]>(kvKey);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }
  return localJsonGet<T[]>(kvKey) ?? [];
}

async function writeIndex<T extends HasId>(collection: string, items: T[]): Promise<void> {
  const kvKey = `grudge:forge:${collection}:index`;

  if (isPuterSignedIn()) {
    await cloud.kv.set(kvKey, items);
  } else {
    localJsonSet(kvKey, items);
  }
}

async function readPayload<T>(collection: string, id: number): Promise<T | null> {
  const fsPath = cloud.path("Grudge", "forge", collection, `${id}.json`);

  if (isPuterSignedIn()) {
    const r = await cloud.fs.readJson<T>(fsPath);
    return r.ok ? r.data : null;
  }
  return localPayloadRead<T>(collection, id);
}

async function writePayload(collection: string, id: number, data: unknown): Promise<void> {
  const fsPath = cloud.path("Grudge", "forge", collection, `${id}.json`);

  if (isPuterSignedIn()) {
    await cloud.fs.write(fsPath, JSON.stringify(data), {
      overwrite: true,
      createMissingParents: true,
    });
  } else {
    const where = await localPayloadWrite(collection, id, data);
    if (where === "none") {
      console.warn(
        `[puterDataProvider] failed to persist ${collection}/${id} (quota). Sign in with Puter for cloud storage.`,
      );
    }
  }
}

async function deletePayload(collection: string, id: number): Promise<void> {
  const fsPath = cloud.path("Grudge", "forge", collection, `${id}.json`);

  if (isPuterSignedIn()) {
    await cloud.fs.delete(fsPath).catch(() => {});
  } else {
    await localPayloadDelete(collection, id);
  }
}

// ── Storage status / migrate (Grudge cloud users) ──────────────────────

export { getProjectStorageStatus, activeStorageBackend };

/** Upload local guest projects into Puter after sign-in. */
export async function syncLocalProjectsToPuterCloud(): Promise<{
  ok: boolean;
  migratedProjects: number;
  migratedScenes: number;
  error?: string;
  backend: string;
}> {
  const result = await migrateLocalProjectsToPuter({
    kvSet: async (key, value) => {
      const r = await cloud.kv.set(key, value);
      return r.ok;
    },
    fsWrite: async (path, body) => {
      const r = await cloud.fs.write(path, body, {
        overwrite: true,
        createMissingParents: true,
      });
      return r.ok;
    },
  });
  return { ...result, backend: activeStorageBackend() };
}

// ── Projects ───────────────────────────────────────────────────────────
export interface ProjectRecord {
  id: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return readIndex<ProjectRecord>("projects");
}

export async function createProject(body: {
  name: string;
  description?: string;
}): Promise<ProjectRecord> {
  const id = await nextId();
  const ts = now();
  const project: ProjectRecord = {
    id,
    name: body.name,
    description: body.description ?? "",
    createdAt: ts,
    updatedAt: ts,
  };
  const existing = await readIndex<ProjectRecord>("projects");
  await writeIndex("projects", [...existing, project]);
  // Seed an empty Main scene so Save / AI Worker work immediately
  // (localStorage guest or Puter FS when signed in).
  try {
    await createScene({
      projectId: id,
      name: "Main",
      data: {
        entities: [],
        environment: {
          sky: "clear",
          ambientIntensity: 0.45,
          sunIntensity: 1.1,
        },
      },
    });
  } catch {
    /* non-fatal — user can create a scene later */
  }
  return project;
}

export async function getProject(id: number): Promise<ProjectRecord | null> {
  const all = await readIndex<ProjectRecord>("projects");
  return all.find((p) => p.id === id) ?? null;
}

export async function updateProject(
  id: number,
  body: { name?: string; description?: string },
): Promise<ProjectRecord | null> {
  const all = await readIndex<ProjectRecord>("projects");
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const updated = {
    ...all[idx],
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
    updatedAt: now(),
  };
  all[idx] = updated;
  await writeIndex("projects", all);
  return updated;
}

export async function deleteProject(id: number): Promise<void> {
  const all = await readIndex<ProjectRecord>("projects");
  await writeIndex(
    "projects",
    all.filter((p) => p.id !== id),
  );
  // Cascade delete scenes, scripts, assets, prefabs for this project
  for (const col of ["scenes", "scripts", "assets", "prefabs"]) {
    const items = await readIndex<{ id: number; projectId: number }>(col);
    const remaining = items.filter((i) => i.projectId !== id);
    if (remaining.length !== items.length) {
      const removed = items.filter((i) => i.projectId === id);
      await writeIndex(col, remaining);
      for (const r of removed) {
        await deletePayload(col, r.id);
      }
    }
  }
}

export async function getProjectSummary(id: number): Promise<{
  projectId: number;
  sceneCount: number;
  scriptCount: number;
  assetCount: number;
  entityCount: number;
  lastUpdated: string;
} | null> {
  const project = await getProject(id);
  if (!project) return null;
  const scenes = (await readIndex<{ id: number; projectId: number }>("scenes")).filter(
    (s) => s.projectId === id,
  );
  const scripts = (await readIndex<{ id: number; projectId: number }>("scripts")).filter(
    (s) => s.projectId === id,
  );
  const assets = (await readIndex<{ id: number; projectId: number }>("assets")).filter(
    (a) => a.projectId === id,
  );

  let entityCount = 0;
  for (const s of scenes) {
    const data = await readPayload<{ entities?: unknown[] }>("scenes", s.id);
    if (data && Array.isArray(data.entities)) entityCount += data.entities.length;
  }

  return {
    projectId: id,
    sceneCount: scenes.length,
    scriptCount: scripts.length,
    assetCount: assets.length,
    entityCount,
    lastUpdated: project.updatedAt,
  };
}

// ── Scenes ─────────────────────────────────────────────────────────────
export interface SceneRecord {
  id: number;
  projectId: number;
  name: string;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

export async function listScenes(projectId: number): Promise<SceneRecord[]> {
  const all = await readIndex<SceneRecord>("scenes");
  const forProject = all.filter((s) => s.projectId === projectId);
  // Index keeps data:null for size — hydrate FS/localStorage payloads so
  // Hierarchy auto-load and scene switch get real entities.
  const hydrated = await Promise.all(
    forProject.map(async (entry) => {
      const data = await readPayload("scenes", entry.id);
      return {
        ...entry,
        data:
          data ??
          entry.data ?? {
            entities: [],
            environment: {},
          },
      };
    }),
  );
  return hydrated;
}

export async function createScene(body: {
  projectId: number;
  name: string;
  data?: unknown;
}): Promise<SceneRecord> {
  const id = await nextId();
  const ts = now();
  const scene: SceneRecord = {
    id,
    projectId: body.projectId,
    name: body.name,
    data: body.data ?? { entities: [], environment: {} },
    createdAt: ts,
    updatedAt: ts,
  };
  const existing = await readIndex<SceneRecord>("scenes");
  // Store the scene data in FS, keep index lightweight
  await writePayload("scenes", id, scene.data);
  const indexEntry = { ...scene, data: null };
  await writeIndex("scenes", [...existing, indexEntry]);
  return scene;
}

export async function getScene(id: number): Promise<SceneRecord | null> {
  const all = await readIndex<SceneRecord>("scenes");
  const entry = all.find((s) => s.id === id);
  if (!entry) return null;
  const data = await readPayload("scenes", id);
  return { ...entry, data: data ?? entry.data };
}

export async function updateScene(
  id: number,
  body: { name?: string; data?: unknown },
): Promise<SceneRecord | null> {
  const all = await readIndex<SceneRecord>("scenes");
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const updated = { ...all[idx], updatedAt: now() };
  if (body.name !== undefined) updated.name = body.name;
  if (body.data !== undefined) {
    await writePayload("scenes", id, body.data);
    updated.data = body.data;
  }
  all[idx] = { ...updated, data: null }; // index stays lightweight
  await writeIndex("scenes", all);
  return updated;
}

export async function deleteScene(id: number): Promise<void> {
  const all = await readIndex<SceneRecord>("scenes");
  await writeIndex(
    "scenes",
    all.filter((s) => s.id !== id),
  );
  await deletePayload("scenes", id);
}

// ── Scripts ────────────────────────────────────────────────────────────
export interface ScriptRecord {
  id: number;
  projectId: number;
  name: string;
  code: string;
  language: "js" | "ts" | "cs";
  createdAt: string;
  updatedAt: string;
}

export async function listScripts(projectId: number): Promise<ScriptRecord[]> {
  const all = await readIndex<ScriptRecord>("scripts");
  return all
    .filter((s) => s.projectId === projectId)
    .map((s) => ({
      ...s,
      language: s.language ?? "js",
    }));
}

export async function createScript(body: {
  projectId: number;
  name: string;
  code?: string;
  language?: "js" | "ts" | "cs";
}): Promise<ScriptRecord> {
  const id = await nextId();
  const ts = now();
  const script: ScriptRecord = {
    id,
    projectId: body.projectId,
    name: body.name,
    code: body.code ?? "",
    language: body.language ?? "js",
    createdAt: ts,
    updatedAt: ts,
  };
  const existing = await readIndex<ScriptRecord>("scripts");
  await writeIndex("scripts", [...existing, script]);
  return script;
}

export async function getScript(id: number): Promise<ScriptRecord | null> {
  const all = await readIndex<ScriptRecord>("scripts");
  return all.find((s) => s.id === id) ?? null;
}

export async function updateScript(
  id: number,
  body: { name?: string; code?: string },
): Promise<ScriptRecord | null> {
  const all = await readIndex<ScriptRecord>("scripts");
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const updated = {
    ...all[idx],
    ...(body.name !== undefined && { name: body.name }),
    ...(body.code !== undefined && { code: body.code }),
    updatedAt: now(),
  };
  all[idx] = updated;
  await writeIndex("scripts", all);
  return updated;
}

export async function deleteScript(id: number): Promise<void> {
  const all = await readIndex<ScriptRecord>("scripts");
  await writeIndex(
    "scripts",
    all.filter((s) => s.id !== id),
  );
}

// ── Assets (aligned with api-client Asset shape for UI/AI tools) ───────
export type AssetType = "model" | "texture" | "audio" | "image" | "other";
export type AssetSource = "grudge" | "upload" | "url" | "generated" | "builtin";

export interface AssetRecord {
  id: number;
  projectId: number;
  name: string;
  /** Public or puter:// URL the editor can load */
  url: string;
  type: AssetType;
  source: AssetSource;
  contentType?: string;
  size?: number;
  objectPath?: string;
  createdAt: string;
}

export async function listAssets(projectId: number): Promise<AssetRecord[]> {
  const all = await readIndex<AssetRecord>("assets");
  return all
    .filter((a) => a.projectId === projectId)
    .map((a) => ({
      ...a,
      // Back-compat for older local rows that only had objectPath
      url: a.url || a.objectPath || "",
      type: a.type || "other",
      source: a.source || "upload",
    }));
}

export async function createAsset(body: {
  projectId: number;
  name: string;
  url?: string;
  type?: AssetType | string;
  source?: AssetSource | string;
  contentType?: string;
  size?: number;
  objectPath?: string;
}): Promise<AssetRecord> {
  const id = await nextId();
  const objectPath = body.objectPath ?? body.url ?? "";
  const url = body.url ?? objectPath;
  const asset: AssetRecord = {
    id,
    projectId: body.projectId,
    name: body.name,
    url,
    type: (body.type as AssetType) || "other",
    source: (body.source as AssetSource) || "upload",
    contentType: body.contentType,
    size: body.size,
    objectPath,
    createdAt: now(),
  };
  const existing = await readIndex<AssetRecord>("assets");
  await writeIndex("assets", [...existing, asset]);
  return asset;
}

export async function deleteAsset(id: number): Promise<void> {
  const all = await readIndex<AssetRecord>("assets");
  const asset = all.find((a) => a.id === id);
  await writeIndex(
    "assets",
    all.filter((a) => a.id !== id),
  );
  // Try to delete the file from Puter FS
  const path = asset?.objectPath;
  if (path && !path.startsWith("blob:") && isPuterSignedIn()) {
    await cloud.fs.delete(path).catch(() => {});
  }
}

// ── Prefabs ────────────────────────────────────────────────────────────
/** Prefab graph payload — keep loose for Puter JSON; UI casts to PrefabData. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PrefabDataLoose = any;

export interface PrefabRecord {
  id: number;
  projectId: number;
  name: string;
  data: PrefabDataLoose;
  thumbnail?: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listPrefabs(projectId: number): Promise<PrefabRecord[]> {
  const all = await readIndex<PrefabRecord>("prefabs");
  return all.filter((p) => p.projectId === projectId);
}

export async function createPrefab(body: {
  projectId: number;
  name: string;
  data?: PrefabDataLoose;
  thumbnail?: string | null;
}): Promise<PrefabRecord> {
  const id = await nextId();
  const ts = now();
  const prefab: PrefabRecord = {
    id,
    projectId: body.projectId,
    name: body.name,
    data: body.data ?? { entities: [] },
    thumbnail: body.thumbnail ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
  const existing = await readIndex<PrefabRecord>("prefabs");
  await writeIndex("prefabs", [...existing, prefab]);
  return prefab;
}

export async function getPrefab(id: number): Promise<PrefabRecord | null> {
  const all = await readIndex<PrefabRecord>("prefabs");
  return all.find((p) => p.id === id) ?? null;
}

export async function updatePrefab(
  id: number,
  body: { name?: string; data?: PrefabDataLoose; thumbnail?: string | null },
): Promise<PrefabRecord | null> {
  const all = await readIndex<PrefabRecord>("prefabs");
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const updated = {
    ...all[idx],
    ...(body.name !== undefined && { name: body.name }),
    ...(body.data !== undefined && { data: body.data }),
    ...(body.thumbnail !== undefined && { thumbnail: body.thumbnail }),
    updatedAt: now(),
  };
  all[idx] = updated;
  await writeIndex("prefabs", all);
  return updated;
}

export async function deletePrefab(id: number): Promise<void> {
  const all = await readIndex<PrefabRecord>("prefabs");
  await writeIndex(
    "prefabs",
    all.filter((p) => p.id !== id),
  );
}

// ── Asset upload (Puter FS instead of R2 presigned URLs) ───────────────
export async function uploadAssetToPuter(
  projectId: number,
  file: File,
): Promise<{ objectPath: string; url: string }> {
  const objectPath = cloud.path(
    "Grudge",
    "forge",
    "uploads",
    String(projectId),
    `${Date.now()}-${file.name}`,
  );

  if (isPuterSignedIn()) {
    await cloud.fs.write(objectPath, file, {
      overwrite: true,
      createMissingParents: true,
    });
    // Return a puter:// path — the editor resolves these via cloud.fs.read()
    return { objectPath, url: `puter://${objectPath}` };
  }
  // Guest fallback: create object URL (session-only)
  const url = URL.createObjectURL(file);
  return { objectPath: url, url };
}
