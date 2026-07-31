/**
 * Puter cloud tools for the AI Worker.
 *
 *   - `cloud_save_project`     — snapshot the current scene to the user's
 *                                Puter drive at a stable per-project key.
 *                                No-ops with a structured "guest" reason
 *                                when the user isn't signed in with Puter.
 *   - `publish_to_puter`       — wraps `publishScene` from `lib/puterPublish`.
 *                                Returns the share URL.
 *   - `list_my_puter_projects` — list every project the AI has saved on
 *                                this user's Puter drive.
 *
 * All three feature-detect Puter sign-in via `cloud.isAvailable()`. Guest
 * users get `{ ok: false, error: "Sign in with Puter…" }` which the model
 * surfaces back to the user.
 */
import { useEditor } from "@/store/editor";
import { cloud, path as cloudPath } from "@/lib/cloud/puterCloud";
import { publishScene } from "@/lib/puterPublish";
import { listScripts } from "@workspace/api-client-react";

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
type ToolResult = { ok: boolean; data?: unknown; error?: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

const PROJECT_ROOT = "Grudge/projects";
const PROJECT_INDEX_KEY = "grudge:projects:index";

interface ProjectIndexEntry {
  projectId: number;
  name: string;
  updatedAt: string;
  scenePath: string;
}

async function readProjectIndex(): Promise<ProjectIndexEntry[]> {
  const r = await cloud.kv.get<ProjectIndexEntry[]>(PROJECT_INDEX_KEY);
  if (!r.ok) return [];
  if (!Array.isArray(r.data)) return [];
  return r.data.filter(
    (e): e is ProjectIndexEntry =>
      !!e && typeof e.projectId === "number" && typeof e.scenePath === "string",
  );
}

async function upsertProjectIndex(entry: ProjectIndexEntry): Promise<void> {
  const idx = await readProjectIndex();
  const without = idx.filter((e) => e.projectId !== entry.projectId);
  without.push(entry);
  // KV may be unavailable on guest builds — we ignore the result; the
  // FS write above is the source of truth, the KV index is just a
  // fast lookup convenience.
  await cloud.kv.set(PROJECT_INDEX_KEY, without);
}

const CLOUD_SAVE_PROJECT: ToolDef = {
  name: "cloud_save_project",
  description:
    "Save the current scene to the signed-in user's Puter cloud drive at a stable per-project path. Re-saves overwrite the previous snapshot. Requires Puter sign-in (returns a structured error for guests).",
  input_schema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description:
          "Optional human label stored in the cloud index (e.g. 'fort-royale-v3'). Defaults to the current scene name.",
      },
    },
  },
};

const cloudSaveProjectHandler: ToolHandler = async (input) => {
  if (!cloud.isAvailable()) {
    return {
      ok: false,
      error: "Sign in with Puter to save projects to the cloud.",
    };
  }
  const s = useEditor.getState();
  const projectId = s.projectId;
  if (!projectId) return { ok: false, error: "No project open." };
  const label =
    typeof input.label === "string" && input.label.trim().length > 0
      ? input.label.trim().slice(0, 64)
      : s.sceneName;
  const scenePath = cloudPath(PROJECT_ROOT, String(projectId), "scene.json");
  const metaPath = cloudPath(PROJECT_ROOT, String(projectId), "meta.json");
  const meta = {
    projectId,
    label,
    name: s.sceneName,
    sceneId: s.sceneId ?? null,
    entityCount: s.sceneData.entities.length,
    updatedAt: new Date().toISOString(),
  };
  const fsRes = await cloud.fs.write(scenePath, JSON.stringify(s.sceneData));
  if (!fsRes.ok) {
    return { ok: false, error: `Cloud save failed: ${fsRes.message ?? fsRes.reason}` };
  }
  await cloud.fs.write(metaPath, JSON.stringify(meta));
  await upsertProjectIndex({
    projectId,
    name: label,
    updatedAt: meta.updatedAt,
    scenePath,
  });
  return {
    ok: true,
    data: {
      scenePath,
      metaPath,
      label,
      bytes: JSON.stringify(s.sceneData).length,
    },
  };
};

const PUBLISH_TO_PUTER: ToolDef = {
  name: "publish_to_puter",
  description:
    "Publish the current scene as a free, shareable site on `<sub>.puter.site`. Re-publishing the same scene reuses the same URL so bookmarks keep working. Requires Puter sign-in.",
  input_schema: { type: "object", properties: {} },
};

const publishToPuterHandler: ToolHandler = async () => {
  if (!cloud.isAvailable()) {
    return { ok: false, error: "Sign in with Puter to publish." };
  }
  const s = useEditor.getState();
  if (!s.sceneData || !Array.isArray(s.sceneData.entities)) {
    return { ok: false, error: "No scene to publish." };
  }
  try {
    const editorOrigin = `${window.location.origin}${import.meta.env.BASE_URL || "/"}`;
    // Pull the project's scripts so the published player bundle runs
    // the same start/update tick + nav-agent FSMs as editor play mode.
    // Best-effort — failure here shouldn't block publish.
    let scripts: Awaited<ReturnType<typeof listScripts>> = [];
    if (s.projectId) {
      try {
        scripts = await listScripts(s.projectId);
      } catch {
        scripts = [];
      }
    }
    const result = await publishScene({
      sceneData: s.sceneData,
      sceneId: s.sceneId ?? null,
      editorOrigin,
      scripts,
    });
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

const LIST_MY_PUTER_PROJECTS: ToolDef = {
  name: "list_my_puter_projects",
  description:
    "List every project this AI has saved to the signed-in user's Puter drive (via cloud_save_project). Returns the per-project label, scenePath, and updatedAt timestamp. Requires Puter sign-in.",
  input_schema: { type: "object", properties: {} },
};

const listMyPuterProjectsHandler: ToolHandler = async () => {
  if (!cloud.isAvailable()) {
    return { ok: false, error: "Sign in with Puter to list cloud projects." };
  }
  const idx = await readProjectIndex();
  // Sort newest-first so the model sees recent projects first.
  idx.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return { ok: true, data: { count: idx.length, projects: idx } };
};

const PROJECT_STORAGE_STATUS: ToolDef = {
  name: "project_storage_status",
  description:
    "Report where Forge projects live for this user: local (guest IndexedDB/localStorage) vs Puter cloud (Grudge/forge KV+FS). " +
    "Also lists migration hints. Call when diagnosing missing projects, quota, or after sign-in.",
  input_schema: { type: "object", properties: {} },
};

const projectStorageStatusHandler: ToolHandler = async () => {
  const {
    getProjectStorageStatus,
    listLocalIdbPayloadKeys,
  } = await import("@/lib/cloud/projectStorage");
  const { forgeEnvSnapshot } = await import("@/lib/forgeEnv");
  const status = getProjectStorageStatus();
  const idbKeys = await listLocalIdbPayloadKeys();
  return {
    ok: true,
    data: {
      ...status,
      idbPayloadKeys: idbKeys.slice(0, 40),
      env: forgeEnvSnapshot({
        isPuterSignedIn: status.puterSignedIn,
        storageBackend: status.backend,
      }),
    },
  };
};

const MIGRATE_LOCAL_TO_PUTER: ToolDef = {
  name: "migrate_local_projects_to_puter",
  description:
    "Copy guest/local Forge projects (indexes + scene payloads) into the signed-in user's Puter cloud (Grudge/forge/*). " +
    "Does not delete local data. Requires Puter sign-in. Use after user signs in so Grudge cloud users keep offline work.",
  input_schema: { type: "object", properties: {} },
};

const migrateLocalToPuterHandler: ToolHandler = async () => {
  if (!cloud.isAvailable()) {
    return {
      ok: false,
      error: "Sign in with Puter to migrate local projects to Grudge cloud.",
    };
  }
  const { syncLocalProjectsToPuterCloud } = await import(
    "@/lib/cloud/puterDataProvider"
  );
  const result = await syncLocalProjectsToPuterCloud();
  return {
    ok: result.ok,
    data: result,
    error: result.error,
  };
};

export const defs: ToolDef[] = [
  CLOUD_SAVE_PROJECT,
  PUBLISH_TO_PUTER,
  LIST_MY_PUTER_PROJECTS,
  PROJECT_STORAGE_STATUS,
  MIGRATE_LOCAL_TO_PUTER,
];

export const handlers: Record<string, ToolHandler> = {
  cloud_save_project: cloudSaveProjectHandler,
  publish_to_puter: publishToPuterHandler,
  list_my_puter_projects: listMyPuterProjectsHandler,
  project_storage_status: projectStorageStatusHandler,
  migrate_local_projects_to_puter: migrateLocalToPuterHandler,
};

export const destructiveToolNames: string[] = [
  // Writes to the user's cloud — confirm before clobbering.
  "cloud_save_project",
  "publish_to_puter",
  "migrate_local_projects_to_puter",
];
