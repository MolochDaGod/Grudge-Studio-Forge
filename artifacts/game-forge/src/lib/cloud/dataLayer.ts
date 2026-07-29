/**
 * Drop-in data layer — replaces `@workspace/api-client-react`.
 *
 * Exports the EXACT same hook names and type exports so every file that
 * imports from `@workspace/api-client-react` works without changes when
 * Vite's resolve.alias points here.
 *
 * Data is stored in Puter KV + FS (signed-in users) or localStorage (guests).
 * Templates and Grudge catalogs are fetched from static JSON in /builtin/.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  UseQueryResult,
  UseMutationResult,
  QueryKey,
} from "@tanstack/react-query";
import * as dp from "./puterDataProvider";

// ── Re-export ALL schemas (types, enums, constants) ────────────────────
// The original api-client-react re-exports everything from api.schemas.
// We re-export from the actual schemas file so consumers get the same types.
// Import schemas directly from the file (not through the aliased package
// name, which would create a circular import since this file IS the alias).
export {
  EntityType,
  PhysicsComponentBodyType,
  PhysicsComponentColliderType,
  MaterialComponentKind,
  LightComponentKind,
  EntityControllerKind,
} from "../../../../../lib/api-client-react/src/generated/api.schemas";

export type {
  HealthStatus,
  AuthConfig,
  GrudgeUser,
  PuterSyncRequest,
  PuterSyncResponse,
  Project,
  CreateProjectBody,
  UpdateProjectBody,
  ProjectSummary,
  Transform,
  PhysicsComponent,
  MaterialComponent,
  LightComponent,
  ModelComponent,
  Scene,
  CreateSceneBody,
  UpdateSceneBody,
  SceneData,
  Script,
  CreateScriptBody,
  UpdateScriptBody,
  Asset,
  CreateAssetBody,
  Prefab,
  CreatePrefabBody,
  UpdatePrefabBody,
  GrudgeCatalog,
  TemplateManifestEntry,
  UploadUrlRequest,
  UploadUrlResponse,
} from "../../../../../lib/api-client-react/src/generated/api.schemas";

// Stub exports that some files reference
export function setBaseUrl(_url: string | null): void {
  /* no-op — Puter data layer has no base URL */
}
export function setAuthTokenGetter(_getter: unknown): void {
  /* no-op — Puter handles auth client-side */
}
export type AuthTokenGetter = () => Promise<string | null> | string | null;

// ── Helper types ───────────────────────────────────────────────────────
type HookResult<T> = UseQueryResult<T, Error> & { queryKey: QueryKey };

function queryResult<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  enabled = true,
): HookResult<T> {
  const q = useQuery<T, Error>({ queryKey, queryFn, enabled });
  return { ...q, queryKey } as HookResult<T>;
}

// ── Projects ───────────────────────────────────────────────────────────
export function useListProjects(_opts?: unknown) {
  return queryResult(["projects"], dp.listProjects);
}

export function useCreateProject(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["createProject"],
    mutationFn: async ({ data }: { data: { name: string; description?: string } }) =>
      dp.createProject(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useGetProject(id: number, _opts?: unknown) {
  return queryResult(["projects", id], () => dp.getProject(id).then((p) => p!), !!id);
}

export function useUpdateProject(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateProject"],
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { name?: string; description?: string };
    }) => dp.updateProject(id, data).then((p) => p!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteProject"],
    mutationFn: async ({ id }: { id: number }) => dp.deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useGetProjectSummary(id: number, _opts?: unknown) {
  return queryResult(
    ["projects", id, "summary"],
    () => dp.getProjectSummary(id).then((s) => s!),
    !!id,
  );
}

// ── Scenes ─────────────────────────────────────────────────────────────
export function useListScenes(projectId: number, _opts?: unknown) {
  return queryResult(["scenes", projectId], () => dp.listScenes(projectId), !!projectId);
}

export function useCreateScene(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["createScene"],
    mutationFn: async ({
      data,
    }: {
      data: { projectId: number; name: string; data?: unknown };
    }) => dp.createScene(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes"] }),
  });
}

export function useGetScene(id: number, _opts?: unknown) {
  return queryResult(["scenes", "detail", id], () => dp.getScene(id).then((s) => s!), !!id);
}

export function useUpdateScene(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateScene"],
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { name?: string; data?: unknown };
    }) => dp.updateScene(id, data).then((s) => s!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes"] }),
  });
}

export function useDeleteScene(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteScene"],
    mutationFn: async ({ id }: { id: number }) => dp.deleteScene(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes"] }),
  });
}

// ── Scripts ────────────────────────────────────────────────────────────
export function useListScripts(projectId: number, _opts?: unknown) {
  return queryResult(
    ["scripts", projectId],
    () => dp.listScripts(projectId),
    !!projectId,
  );
}

export function useCreateScript(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["createScript"],
    mutationFn: async ({
      data,
    }: {
      data: {
        projectId: number;
        name: string;
        code?: string;
        language?: "js" | "ts" | "cs";
      };
    }) => dp.createScript(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scripts"] }),
  });
}

export function useGetScript(id: number, _opts?: unknown) {
  return queryResult(
    ["scripts", "detail", id],
    () => dp.getScript(id).then((s) => s!),
    !!id,
  );
}

export function useUpdateScript(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateScript"],
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { name?: string; code?: string };
    }) => dp.updateScript(id, data).then((s) => s!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scripts"] }),
  });
}

export function useDeleteScript(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteScript"],
    mutationFn: async ({ id }: { id: number }) => dp.deleteScript(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scripts"] }),
  });
}

// ── Assets ─────────────────────────────────────────────────────────────
export function useListAssets(projectId: number, _opts?: unknown) {
  return queryResult(
    ["assets", projectId],
    () => dp.listAssets(projectId),
    !!projectId,
  );
}

export function useCreateAsset(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["createAsset"],
    mutationFn: async ({
      data,
    }: {
      data: {
        projectId: number;
        name: string;
        contentType: string;
        size: number;
        objectPath: string;
      };
    }) => dp.createAsset(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDeleteAsset(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteAsset"],
    mutationFn: async ({ id }: { id: number }) => dp.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
}

// ── Prefabs ────────────────────────────────────────────────────────────
export function useListPrefabs(projectId: number, _opts?: unknown) {
  return queryResult(
    ["prefabs", projectId],
    () => dp.listPrefabs(projectId),
    !!projectId,
  );
}

export function useCreatePrefab(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["createPrefab"],
    mutationFn: async ({
      data,
    }: {
      data: {
        projectId: number;
        name: string;
        data: unknown;
        thumbnail?: string | null;
      };
    }) => dp.createPrefab(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefabs"] }),
  });
}

export function useGetPrefab(id: number, _opts?: unknown) {
  return queryResult(
    ["prefabs", "detail", id],
    () => dp.getPrefab(id).then((p) => p!),
    !!id,
  );
}

export function useUpdatePrefab(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updatePrefab"],
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { name?: string; data?: unknown; thumbnail?: string | null };
    }) => dp.updatePrefab(id, data).then((p) => p!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefabs"] }),
  });
}

export function useDeletePrefab(_opts?: unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deletePrefab"],
    mutationFn: async ({ id }: { id: number }) => dp.deletePrefab(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefabs"] }),
  });
}

// ── Upload (Puter FS instead of R2 presigned URLs) ─────────────────────
export function useRequestUploadUrl(_opts?: unknown) {
  return useMutation({
    mutationKey: ["requestUploadUrl"],
    mutationFn: async ({
      data,
    }: {
      data: {
        name: string;
        size: number;
        contentType: string;
        projectId?: number;
      };
    }) => {
      // For Puter, we don't need presigned URLs — we upload directly.
      // Return a compatible shape so the upload flow still works.
      const objectPath = `Grudge/forge/uploads/${data.projectId ?? "shared"}/${Date.now()}-${data.name}`;
      return {
        uploadURL: objectPath,
        objectPath,
        metadata: { name: data.name, size: data.size, contentType: data.contentType },
      };
    },
  });
}

// ── Static data (no server needed) ─────────────────────────────────────
export function useHealthCheck(_opts?: unknown) {
  return queryResult(["health"], async () => ({ status: "ok" }));
}

export function useGetAuthConfig(_opts?: unknown) {
  return queryResult(["authConfig"], async () => ({
    puterSiteOrigin: "https://puter.com",
    puterBasePath: "/grudge-forge",
    enablePuterCloud: true,
    grudgeAuthUrl: "https://id.grudge-studio.com",
    assetsCdn: "https://assets.grudge-studio.com",
    objectStoreUrl: "https://objectstore.grudge-studio.com",
    projectStorage: "puter-or-local",
  }));
}

export function useSyncPuterUser(_opts?: unknown) {
  return useMutation({
    mutationKey: ["syncPuterUser"],
    mutationFn: async (_args: { data: { puterAccessToken: string } }) => {
      // No server needed — Puter auth is fully client-side
      return { user: null, created: false, grudgeAccountLinked: false };
    },
  });
}

// ── Storage object serving (direct fetch for builtin assets) ───────────
export function useGetPublicObject(filePath: string, _opts?: unknown) {
  return queryResult(
    ["publicObject", filePath],
    async () => {
      const url = `https://assets.grudge-studio.com/${filePath}`;
      const res = await fetch(url);
      return res.blob();
    },
    !!filePath,
  );
}

export function useGetStorageObject(objectPath: string, _opts?: unknown) {
  return queryResult(
    ["storageObject", objectPath],
    async () => {
      const url = `https://assets.grudge-studio.com/${objectPath}`;
      const res = await fetch(url);
      return res.blob();
    },
    !!objectPath,
  );
}

// ── Grudge catalogs ────────────────────────────────────────────────────
// Same-origin forge Worker (`/api/grudge/*`) — never api.grudge-studio.com
// (deprecated split-brain; 404 in production). Mirrors `lib/grudge.ts`.
const GRUDGE_CATALOG_BASE = "/api/grudge";

async function fetchGrudgeCatalog(path: string): Promise<unknown> {
  const res = await fetch(`${GRUDGE_CATALOG_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Grudge catalog ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function useGetGrudgeWeapons(_opts?: unknown) {
  return queryResult(["grudgeWeapons"], () => fetchGrudgeCatalog("/weapons"));
}

export function useGetGrudgeItems(_opts?: unknown) {
  return queryResult(["grudgeItems"], () => fetchGrudgeCatalog("/items"));
}

export function useGetGrudgeEnemies(_opts?: unknown) {
  return queryResult(["grudgeEnemies"], () => fetchGrudgeCatalog("/enemies"));
}

export function useGetGrudgeQuests(_opts?: unknown) {
  return queryResult(["grudgeQuests"], () => fetchGrudgeCatalog("/quests"));
}

// ── Templates (API first, static fallback) ─────────────────────────────
export function useListTemplates(_opts?: unknown) {
  return queryResult(["templates"], async () => {
    // Live Worker: GET /api/templates → array of manifest entries
    let res = await fetch("/api/templates");
    if (res.ok) {
      const body = await res.json();
      if (Array.isArray(body)) return body;
      if (Array.isArray(body?.templates)) return body.templates;
    }
    res = await fetch("/builtin/template-manifest.json");
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body : body?.templates ?? [];
  });
}

export function useGetTemplate(key: string, _opts?: unknown) {
  return queryResult(
    ["templates", key],
    async () => {
      let res = await fetch(`/api/templates/${encodeURIComponent(key)}`);
      if (res.ok) return res.json();
      res = await fetch(`/builtin/templates/${encodeURIComponent(key)}.json`);
      if (!res.ok) {
        throw new Error(`Template "${key}" not found (${res.status})`);
      }
      return res.json();
    },
    !!key,
  );
}

// ── Non-hook re-exports for direct function calls ──────────────────────
// Some files import the raw functions (not hooks) for AI tool use, etc.
export { listScripts } from "./puterDataProvider";
export {
  getGetPublicObjectUrl,
  getGetStorageObjectUrl,
  getGetTemplateUrl,
  getGetTemplateQueryKey,
  getListProjectsQueryKey,
  getGetProjectQueryKey,
  getGetProjectSummaryQueryKey,
  getListScenesQueryKey,
  getGetSceneQueryKey,
  getListScriptsQueryKey,
  getListAssetsQueryKey,
  getListPrefabsQueryKey,
  getListTemplatesQueryKey,
} from "./queryKeys";
