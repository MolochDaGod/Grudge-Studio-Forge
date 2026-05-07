/**
 * Shared "bake current scene's navmesh" helper.
 *
 * Used by both:
 *   - the AI tool `bake_navmesh` (`src/ai/tools/nav/index.ts`), and
 *   - the "Bake NavMesh" button in the Layers panel
 *     (`src/editor/LayersPanel.tsx`).
 *
 * Walks every scene entity whose `surface` is set (and not "None"),
 * pulls the matching `THREE.Mesh` instances out of the live editor
 * scene graph (`window.__editorScene`, populated by Viewport), runs
 * Recast through `bakeNavmesh`, persists the resulting blob to the
 * server (`POST /api/navmesh/blob`), caches it on
 * `window.__navmeshBlobs` so the debug overlay + agent runtime can
 * read it without a re-fetch in this session, then reseats
 * `Environment.navmeshAssetId` through the CommandStack.
 *
 * Persistence note: bakes are content-addressed by SHA-1 on the
 * server, so re-baking an unchanged scene short-circuits to the same
 * blob with `written: false`. The id we store on the environment is
 * the server-assigned key (a 16-char hex string); we hash it into a
 * stable numeric id for the legacy `navmeshAssetId: number` schema
 * field via `idToNumber`.
 *
 * Returns the id + bake stats so callers can display "baked X polys
 * in Yms (asset Z)".
 */
import * as THREE from "three";
import { useEditor } from "@/store/editor";
import { bakeNavmesh, type NavmeshBakeOptions, type NavmeshBakeStats } from "@/lib/navmesh";
import type { SurfaceKind } from "@workspace/scene-schema";

export interface BakeSceneNavmeshResult {
  /** Numeric id stored on `Environment.navmeshAssetId`. Stable across
   *  reloads (derived from the server-assigned content hash). */
  assetId: number;
  /** Server-side blob id (hex). Available when persistence succeeded. */
  serverBlobId: string | null;
  /** True when the server reported the blob was already present and
   *  the upload was a no-op. */
  cached: boolean;
  stats: NavmeshBakeStats;
}

/** Stable, deterministic mapping from a hex blob id to a 32-bit
 *  numeric id (the schema slot we have today is `number`). FNV-1a
 *  keeps it dependency-free and collision-resistant enough for a
 *  per-project keyspace of bakes. */
function idToNumber(blobId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < blobId.length; i++) {
    h ^= blobId.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // Always positive, < Number.MAX_SAFE_INTEGER.
  return h >>> 0;
}

function getEditorScene(): THREE.Object3D | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { __editorScene?: THREE.Object3D }).__editorScene ??
    null
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  // Browser-side: chunk to keep `String.fromCharCode.apply` happy on
  // multi-MB blobs. 0x8000 chunk size matches MDN's recommendation.
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  return btoa(bin);
}

/** Run a fresh bake and persist the result. Throws on no-walkable-
 *  meshes / no-tagged-entities so callers (UI button + AI tool) can
 *  surface the same error string. */
export async function bakeSceneNavmesh(
  options: NavmeshBakeOptions = {},
  baseUrl: string = "/api",
): Promise<BakeSceneNavmeshResult> {
  const scene = getEditorScene();
  if (!scene) {
    throw new Error(
      "no editor scene mounted — open the 3D viewport before baking",
    );
  }
  const state = useEditor.getState();
  const walkable = state.sceneData.entities.filter(
    (e) => e.surface && e.surface !== "None",
  );
  if (walkable.length === 0) {
    throw new Error(
      "no entities have a surface tag — set a Surface in the Inspector first",
    );
  }
  const inputs: Array<{ mesh: THREE.Mesh; surface: SurfaceKind }> = [];
  // EntityRenderer tags its rendered group via `userData.entityId`,
  // not as a direct property — so `getObjectByProperty("entityId",
  // id)` returns nothing. We do an explicit traverse instead.
  const rootsById = new Map<string, THREE.Object3D>();
  scene.traverse((o) => {
    const ud = o.userData as { entityId?: string } | undefined;
    if (ud?.entityId && !rootsById.has(ud.entityId)) {
      rootsById.set(ud.entityId, o);
    }
  });
  for (const ent of walkable) {
    const root = rootsById.get(ent.id);
    if (!root) continue;
    root.traverse((o: THREE.Object3D) => {
      if ((o as THREE.Mesh).isMesh) {
        inputs.push({ mesh: o as THREE.Mesh, surface: ent.surface! });
      }
    });
  }
  if (inputs.length === 0) {
    throw new Error(
      "found tagged entities but none had geometry yet — wait for models to finish loading and try again",
    );
  }

  const bake = await bakeNavmesh(inputs, options);

  // Try to persist on the server (best-effort — if the bucket isn't
  // configured we still keep the blob in-memory so the editor stays
  // functional in dev environments without R2).
  const projectId = String(state.projectId ?? "");
  let serverBlobId: string | null = null;
  let cached = false;
  if (projectId) {
    try {
      const resp = await fetch(`${baseUrl}/navmesh/blob`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          bytes: bytesToBase64(bake.bytes),
        }),
      });
      if (resp.ok) {
        const json = (await resp.json()) as { id?: string; written?: boolean };
        serverBlobId = typeof json.id === "string" ? json.id : null;
        cached = json.written === false;
      }
    } catch {
      // Network / 503 — fall back to session-only id.
    }
  }

  // Always cache the blob on the window so this session's debug
  // overlay and agent runtime can read it without a server round trip.
  const w = window as unknown as {
    __navmeshBlobs?: Map<number, Uint8Array>;
    __navmeshAssetCounter?: number;
  };
  w.__navmeshBlobs ??= new Map();
  let assetId: number;
  if (serverBlobId) {
    assetId = idToNumber(serverBlobId);
  } else {
    w.__navmeshAssetCounter = (w.__navmeshAssetCounter ?? 0) + 1;
    assetId = w.__navmeshAssetCounter;
  }
  w.__navmeshBlobs.set(assetId, bake.bytes);
  // Persist BOTH the numeric asset id and the server-assigned hex
  // blob key together — the latter is what enables reload-hydration
  // (`hydrateNavmeshFromServer` re-derives the same numeric id via
  // FNV-1a and then re-fetches the blob from the API).
  useEditor.getState().cmdBakeNavmesh({
    assetId,
    blobKey: serverBlobId ?? undefined,
  });

  return { assetId, serverBlobId, cached, stats: bake.stats };
}

/** Fetch a previously-persisted navmesh blob by its server-assigned
 *  hex key, populate the in-memory cache so the agent runtime + debug
 *  overlay can read it, and return the numeric asset id derived from
 *  the key. Idempotent — repeated calls short-circuit when the cache
 *  already holds the blob. Used by `Viewport.tsx` on scene load to
 *  bring a pre-baked navmesh back online without forcing the user to
 *  re-bake.
 *
 *  Returns `null` when the request fails (network / 404 / corrupt
 *  body); callers fall back to the existing in-memory blob (or to a
 *  re-bake) in that case. */
export async function hydrateNavmeshFromServer(
  blobKey: string,
  projectId?: string | number | null,
  baseUrl: string = "/api",
): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __navmeshBlobs?: Map<number, Uint8Array> };
  const assetId = idToNumber(blobKey);
  w.__navmeshBlobs ??= new Map();
  if (w.__navmeshBlobs.has(assetId)) return assetId;
  // The server's GET /navmesh/blob/:id requires `?projectId=` for
  // tenant scoping. Fall back to the editor store when the caller
  // didn't pass one — Viewport passes it explicitly to keep this
  // helper pure-callable from tests.
  const pid = projectId ?? useEditor.getState().projectId;
  if (pid == null || pid === "") return null;
  const url = `${baseUrl}/navmesh/blob/${encodeURIComponent(blobKey)}?projectId=${encodeURIComponent(String(pid))}`;
  const resp = await fetch(url).catch(() => null);
  if (!resp || !resp.ok) return null;
  const buf = await resp.arrayBuffer();
  w.__navmeshBlobs.set(assetId, new Uint8Array(buf));
  return assetId;
}

/** Look up the in-memory navmesh blob for the current scene's
 *  `navmeshAssetId`. Used by the agent runtime + debug overlay. When
 *  not cached but a server id exists, callers can `await
 *  fetchPersistedBlob(assetId, projectId)` to hydrate. */
export function getCachedBlob(assetId: number): Uint8Array | null {
  const w = window as unknown as {
    __navmeshBlobs?: Map<number, Uint8Array>;
  };
  return w.__navmeshBlobs?.get(assetId) ?? null;
}

/** Resolve the navmesh blob for a given asset id, lazily fetching it
 *  from the server when the in-memory cache is empty. Returns null
 *  when no `blobKey` is available (legacy session-only id) or the
 *  fetch fails — callers should surface a "re-bake" error in that
 *  case. Used by the AI nav tools + debug overlay so a hard reload
 *  doesn't silently break path queries. */
export async function ensureNavmeshBlob(
  assetId: number,
  blobKey?: string | null,
  projectId?: string | number | null,
  baseUrl: string = "/api",
): Promise<Uint8Array | null> {
  const cached = getCachedBlob(assetId);
  if (cached) return cached;
  if (!blobKey) return null;
  const hydrated = await hydrateNavmeshFromServer(blobKey, projectId, baseUrl);
  if (hydrated == null) return null;
  return getCachedBlob(hydrated);
}
