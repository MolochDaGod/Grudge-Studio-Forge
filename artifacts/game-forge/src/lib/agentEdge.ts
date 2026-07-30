/**
 * Client for Forge edge agent/catalog APIs (Cloudflare Worker).
 *
 * Routes (same-origin under forge.grudge-studio.com):
 *   GET  /api/catalog/fast-assets
 *   GET  /api/catalog/search?q=&category=&prefix=&format=&limit=
 *   GET  /api/catalog/gamedata?kind=weapons|equipment|materials&q=
 *   GET  /api/catalog/status
 *   GET  /api/agent/jobs
 *   POST /api/agent/jobs
 *   GET  /api/agent/jobs/:id
 *
 * Falls back to local Fast assets + in-memory jobs when edge is offline.
 */

import { FAST_ASSETS, type FastAsset } from "@/lib/fastAssets";

export interface AgentJob {
  id: string;
  kind: string;
  status: "pending" | "running" | "ready" | "failed";
  prompt?: string;
  resultUrl?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface CatalogStatus {
  ok: boolean;
  service: string;
  d1: boolean;
  fastAssetCount: number;
  fleetIndexCount?: number | null;
  stack: string[];
  policy?: Record<string, string>;
  routes?: Record<string, string>;
}

/** Fleet D1 registry hit (always assets.grudge-studio.com cdnUrl). */
export interface FleetAssetHit {
  id: string;
  name: string;
  category: string;
  r2Key: string;
  cdnUrl: string;
  grudgeUuid?: string | null;
  format?: string | null;
  fileSize?: number | null;
  source?: string;
}

export interface FleetSearchResult {
  ok: boolean;
  count: number;
  items: FleetAssetHit[];
  fleetIndex?: { count: number; fetchedAt?: string | null; error?: string | null };
  error?: string;
}

/** ObjectStore gamedata row (stats/icons; mesh may be null). */
export interface GamedataItem {
  id: string;
  name: string;
  kind: string;
  category?: string | null;
  iconUrl?: string | null;
  spritePath?: string | null;
  modelUrl?: string | null;
  lore?: string | null;
  primaryStat?: string | null;
}

export interface GamedataResult {
  ok: boolean;
  kind: string;
  count: number;
  items: GamedataItem[];
  error?: string;
  policy?: Record<string, string>;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Edge Fast catalog; local FAST_ASSETS if worker not deployed yet. */
export async function fetchFastCatalog(): Promise<{
  items: FastAsset[];
  source: "edge" | "local";
}> {
  const data = await getJson<{ items?: FastAsset[] }>("/api/catalog/fast-assets");
  if (data?.items && Array.isArray(data.items) && data.items.length > 0) {
    return { items: data.items, source: "edge" };
  }
  return { items: FAST_ASSETS, source: "local" };
}

export async function fetchCatalogStatus(): Promise<CatalogStatus> {
  const data = await getJson<CatalogStatus>("/api/catalog/status");
  if (data?.ok) return data;
  return {
    ok: true,
    service: "local-fallback",
    d1: false,
    fastAssetCount: FAST_ASSETS.length,
    fleetIndexCount: null,
    stack: ["local-fast-assets", "puter-or-local-projects", "r2-cdn"],
  };
}

/**
 * Search fleet D1 asset index via free-ai edge (filtered in Worker).
 * Prefer category=characters|weapons|maps|nature or prefix=models/grudge6
 */
export async function searchFleetAssets(params: {
  q?: string;
  category?: string;
  prefix?: string;
  format?: string;
  limit?: number;
}): Promise<FleetSearchResult> {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.category) sp.set("category", params.category);
  if (params.prefix) sp.set("prefix", params.prefix);
  if (params.format) sp.set("format", params.format);
  if (params.limit != null) sp.set("limit", String(params.limit));
  const qs = sp.toString();
  const data = await getJson<FleetSearchResult>(
    `/api/catalog/search${qs ? `?${qs}` : ""}`,
  );
  if (data?.ok && Array.isArray(data.items)) return data;
  return {
    ok: false,
    count: 0,
    items: [],
    error:
      "Fleet catalog search unavailable. Deploy free-ai with /api/catalog/search or use list_fast_assets.",
  };
}

/** ObjectStore weapons / equipment / materials (icons + stats). */
export async function fetchGamedata(params: {
  kind?: string;
  q?: string;
  limit?: number;
}): Promise<GamedataResult> {
  const kind = params.kind || "weapons";
  const sp = new URLSearchParams();
  sp.set("kind", kind);
  if (params.q) sp.set("q", params.q);
  if (params.limit != null) sp.set("limit", String(params.limit));
  const data = await getJson<GamedataResult>(
    `/api/catalog/gamedata?${sp.toString()}`,
  );
  if (data?.ok && Array.isArray(data.items)) return data;
  return {
    ok: false,
    kind,
    count: 0,
    items: [],
    error:
      data?.error ||
      "Gamedata edge unavailable. Deploy free-ai /api/catalog/gamedata.",
  };
}

export async function createAgentJob(input: {
  kind: string;
  prompt?: string;
  meta?: Record<string, unknown>;
}): Promise<AgentJob | null> {
  try {
    const r = await fetch("/api/agent/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) return null;
    return (await r.json()) as AgentJob;
  } catch {
    return null;
  }
}

export async function listAgentJobs(): Promise<AgentJob[]> {
  const data = await getJson<{ jobs?: AgentJob[] }>("/api/agent/jobs");
  return Array.isArray(data?.jobs) ? data!.jobs! : [];
}

export async function getAgentJob(id: string): Promise<AgentJob | null> {
  return getJson<AgentJob>(`/api/agent/jobs/${encodeURIComponent(id)}`);
}
