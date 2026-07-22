/**
 * Query key factories and URL helpers — mirrors the non-hook exports from
 * the original @workspace/api-client-react that some editor files import.
 */

export const getGetPublicObjectUrl = (filePath: string) =>
  `https://assets.grudge-studio.com/${filePath}`;

export const getGetStorageObjectUrl = (objectPath: string) =>
  `https://assets.grudge-studio.com/${objectPath}`;

/**
 * Templates: prefer production API Worker (`/api/templates/:key` — verified 200).
 * Static fallback: `/builtin/templates/:key.json` shipped in public/ for offline.
 */
export const getGetTemplateUrl = (key: string) =>
  `/api/templates/${encodeURIComponent(key)}`;

export const getGetTemplateQueryKey = (key: string) =>
  [`/api/templates/${key}`] as const;

/** Static fallback URL when API is unavailable. */
export const getGetTemplateStaticUrl = (key: string) =>
  `/builtin/templates/${encodeURIComponent(key)}.json`;

export const getListProjectsQueryKey = () => ["projects"] as const;
export const getGetProjectQueryKey = (id: number) => ["projects", id] as const;
export const getGetProjectSummaryQueryKey = (id: number) =>
  ["projects", id, "summary"] as const;
export const getListScenesQueryKey = (id: number) => ["scenes", id] as const;
export const getGetSceneQueryKey = (projectId: number, sceneId: number) =>
  ["scenes", projectId, sceneId] as const;
export const getListScriptsQueryKey = (id: number) => ["scripts", id] as const;
export const getListAssetsQueryKey = (id: number) => ["assets", id] as const;
export const getListPrefabsQueryKey = (id: number) => ["prefabs", id] as const;
export const getListTemplatesQueryKey = () => ["templates"] as const;
