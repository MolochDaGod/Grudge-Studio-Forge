/**
 * Query key factories and URL helpers — mirrors the non-hook exports from
 * the original @workspace/api-client-react that some editor files import.
 */

export const getGetPublicObjectUrl = (filePath: string) =>
  `https://assets.grudge-studio.com/${filePath}`;

export const getGetStorageObjectUrl = (objectPath: string) =>
  `https://assets.grudge-studio.com/${objectPath}`;

// Prefer the live API seeder (Railway R2 templates). Static SPA copies under
// /builtin/templates/ are a cold-cache fallback only.
export const getGetTemplateUrl = (key: string) =>
  `/api/templates/${encodeURIComponent(key)}`;

export const getGetTemplateQueryKey = (key: string) =>
  [`/api/templates/${key}`] as const;

export const getListProjectsQueryKey = () => ["projects"] as const;
export const getListScenesQueryKey = (id: number) => ["scenes", id] as const;
export const getListScriptsQueryKey = (id: number) => ["scripts", id] as const;
export const getListAssetsQueryKey = (id: number) => ["assets", id] as const;
export const getListPrefabsQueryKey = (id: number) => ["prefabs", id] as const;
export const getListTemplatesQueryKey = () => ["templates"] as const;
