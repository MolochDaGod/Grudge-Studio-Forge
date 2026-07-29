/**
 * Client for Forge edge agent/catalog APIs (Cloudflare Worker).
 *
 * Routes (same-origin under forge.grudge-studio.com):
 *   GET  /api/catalog/fast-assets
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
  stack: string[];
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
    stack: ["local-fast-assets", "puter-or-local-projects", "r2-cdn"],
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
