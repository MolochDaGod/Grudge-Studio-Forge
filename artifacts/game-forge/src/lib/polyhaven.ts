import { useQuery } from "@tanstack/react-query";

/**
 * Poly Haven client.
 *
 * Talks to the api-server proxy (`/api/polyhaven/...`) rather than the public
 * polyhaven.com API directly so that:
 *   - thumbnails / list responses get cached server-side (the catalog rarely
 *     changes), and
 *   - the editor stays decoupled from upstream JSON shape changes.
 *
 * The listing endpoints return *just* a slug + display metadata — they do NOT
 * include download URLs, because resolving them requires an extra `/files/:slug`
 * call per asset (700+ calls). We resolve files lazily, only when the user
 * actually clicks an asset.
 */

export type PolyHavenAssetKind = "textures" | "hdris" | "models";

export type PolyHavenAsset = {
  slug: string;
  name: string;
  kind: PolyHavenAssetKind;
  categories: string[];
  tags: string[];
  dimensions: number[] | null;
  download_count: number;
  authors: Record<string, string>;
  thumbnail_url: string;
};

export type PolyHavenList = {
  items: PolyHavenAsset[];
  kind: PolyHavenAssetKind;
  total: number;
};

export type PolyHavenFileRef = {
  url: string;
  ext: string;
  resolution: string;
};

export type PolyHavenFiles = {
  slug: string;
  model: PolyHavenFileRef | null;
  hdri: PolyHavenFileRef | null;
  texture:
    | {
        diffuse?: PolyHavenFileRef;
        normal?: PolyHavenFileRef;
        roughness?: PolyHavenFileRef;
        ao?: PolyHavenFileRef;
        displacement?: PolyHavenFileRef;
      }
    | null;
};

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

export function usePolyHaven(kind: PolyHavenAssetKind) {
  return useQuery({
    queryKey: ["polyhaven", kind],
    queryFn: () => getJson<PolyHavenList>(`/api/polyhaven/${kind}`),
    // The catalog is effectively static; let it sit for a long time.
    staleTime: 60 * 60 * 1000,
  });
}

export async function fetchPolyHavenFiles(slug: string): Promise<PolyHavenFiles> {
  return getJson<PolyHavenFiles>(`/api/polyhaven/files/${slug}`);
}
