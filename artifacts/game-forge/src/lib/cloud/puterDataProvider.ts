/**
 * Puter-backed data provider — replaces the Express + PostgreSQL api-server.
 *
 * All CRUD operations use Puter KV for indexes and Puter FS for payloads.
 * Numeric IDs are generated via a KV counter for backward compatibility with
 * the `Project.id`, `Scene.id`, `Script.id`, `Asset.id`, `Prefab.id` shapes.
 *
 * Guest users (not signed in via Puter) get local-only storage via
 * localStorage, so the editor stays fully functional offline or without
 * an account.
 */
import { cloud, isPuterSignedIn, type CloudResult } from "./puterCloud";

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

// ── Local storage helpers (guest fallback) ─────────────────────────────
function localGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function localSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — non-fatal */
  }
}

function localDelete(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

// ── Generic KV-backed collection ───────────────────────────────────────
// Each entity type stores:
//   KV index:  grudge:forge:<collection>:index  →  <T>[]
//   FS payload (optional, for large data like scene JSON):
//              Grudge/forge/<collection>/<id>.json

type HasId = { id: number };

async function readIndex<T extends HasId>(collection: string): Promise<T[]> {
  const kvKey = `grudge:forge:${collection}:index`;

  if (isPuterSignedIn()) {
    const r = await cloud.kv.get<T[]>(kvKey);
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }
  return localGet<T[]>(kvKey) ?? [];
}

async function writeIndex<T extends HasId>(collection: string, items: T[]): Promise<void> {
  const kvKey = `grudge:forge:${collection}:index`;

  if (isPuterSignedIn()) {
    await cloud.kv.set(kvKey, items);
  } else {
    localSet(kvKey, items);
  }
}

async function readPayload<T>(collection: string, id: number): Promise<T | null> {
  const fsPath = cloud.path("Grudge", "forge", collection, `${id}.json`);

  if (isPuterSignedIn()) {
    const r = await cloud.fs.readJson<T>(fsPath);
    return r.ok ? r.data : null;
  }
  return localGet<T>(`grudge:forge:${collection}:${id}:data`);
}

async function writePayload(collection: string, id: number, data: unknown): Promise<void> {
  const fsPath = cloud.path("Grudge", "forge", collection, `${id}.json`);

  if (isPuterSignedIn()) {
    await cloud.fs.write(fsPath, JSON.stringify(data), {
      overwrite: true,
      createMissingParents: true,
    });
  } else {
    localSet(`grudge:forge:${collection}:${id}:data`, data);
  }
}

async function deletePayload(collection: string, id: number): Promise<void> {
  const fsPath = cloud.path("Grudge", "forge", collection, `${id}.json`);

  if (isPuterSignedIn()) {
    await cloud.fs.delete(fsPath).catch(() => {});
  } else {
    localDelete(`grudge:forge:${collection}:${id}:data`);
  }
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
  return all.filter((s) => s.projectId === projectId);
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
  createdAt: string;
  updatedAt: string;
}

export async function listScripts(projectId: number): Promise<ScriptRecord[]> {
  const all = await readIndex<ScriptRecord>("scripts");
  return all.filter((s) => s.projectId === projectId);
}

export async function createScript(body: {
  projectId: number;
  name: string;
  code?: string;
}): Promise<ScriptRecord> {
  const id = await nextId();
  const ts = now();
  const script: ScriptRecord = {
    id,
    projectId: body.projectId,
    name: body.name,
    code: body.code ?? "",
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

// ── Assets ─────────────────────────────────────────────────────────────
export interface AssetRecord {
  id: number;
  projectId: number;
  name: string;
  contentType: string;
  size: number;
  objectPath: string;
  createdAt: string;
}

export async function listAssets(projectId: number): Promise<AssetRecord[]> {
  const all = await readIndex<AssetRecord>("assets");
  return all.filter((a) => a.projectId === projectId);
}

export async function createAsset(body: {
  projectId: number;
  name: string;
  contentType: string;
  size: number;
  objectPath: string;
}): Promise<AssetRecord> {
  const id = await nextId();
  const asset: AssetRecord = {
    id,
    projectId: body.projectId,
    name: body.name,
    contentType: body.contentType,
    size: body.size,
    objectPath: body.objectPath,
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
  if (asset?.objectPath && isPuterSignedIn()) {
    await cloud.fs.delete(asset.objectPath).catch(() => {});
  }
}

// ── Prefabs ────────────────────────────────────────────────────────────
export interface PrefabRecord {
  id: number;
  projectId: number;
  name: string;
  data: unknown;
  thumbnail: string | null;
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
  data: unknown;
  thumbnail?: string | null;
}): Promise<PrefabRecord> {
  const id = await nextId();
  const ts = now();
  const prefab: PrefabRecord = {
    id,
    projectId: body.projectId,
    name: body.name,
    data: body.data,
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
  body: { name?: string; data?: unknown; thumbnail?: string | null },
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
