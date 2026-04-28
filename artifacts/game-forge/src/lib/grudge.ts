/**
 * Grudge Studio SDK wrapper.
 *
 * In production this would import the real SDK from
 * https://molochdagod.github.io/ObjectStore/ — but to avoid CORS surprises
 * during prototyping we proxy through the api-server. The api-server caches
 * results for 5 minutes.
 *
 * Methods mirror the SDK signatures from the docs:
 *   sdk.getWeapons(), sdk.getItemsDatabase(), etc.
 */

const base = `${import.meta.env.BASE_URL || "/"}api`.replace(/\/+/g, "/");

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`Grudge fetch failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const grudge = {
  getWeapons: () => fetchJson<{ items: GrudgeItem[]; source: string }>("/grudge/weapons"),
  getItems: () => fetchJson<{ items: GrudgeItem[]; source: string }>("/grudge/items"),
  getEnemies: () => fetchJson<{ items: GrudgeItem[]; source: string }>("/grudge/enemies"),
  getQuests: () => fetchJson<{ items: GrudgeItem[]; source: string }>("/grudge/quests"),
};

export type GrudgeItem = Record<string, unknown> & {
  key?: string;
  id?: string | number;
  name?: string;
  tier?: number;
  category?: string;
  icon?: string;
  model?: string;
  description?: string;
};

const TIER_COLORS: Record<number, { name: string; hex: string }> = {
  1: { name: "Gray", hex: "#9ca3af" },
  2: { name: "Green", hex: "#4ade80" },
  3: { name: "Blue", hex: "#60a5fa" },
  4: { name: "Purple", hex: "#a78bfa" },
  5: { name: "Red", hex: "#ff4d4d" },
  6: { name: "Gold", hex: "#fbbf24" },
};

export function getTierColor(tier: number) {
  return TIER_COLORS[tier] ?? TIER_COLORS[1];
}
