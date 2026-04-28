import { Router, type IRouter } from "express";

const router: IRouter = Router();

const GRUDGE_BASE = "https://molochdagod.github.io/ObjectStore";

const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 5 * 60 * 1000;

async function fetchGrudge(path: string): Promise<unknown> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const r = await fetch(`${GRUDGE_BASE}${path}`);
  if (!r.ok) throw new Error(`Grudge fetch failed: ${r.status}`);
  const data = await r.json();
  cache.set(path, { data, ts: Date.now() });
  return data;
}

/**
 * Flatten the Grudge catalog into a flat array of items so the UI can
 * render one card per weapon / item / enemy / quest. The Grudge feeds
 * tend to have shape:
 *   { categories: { swords: { iconBase, items: [...] }, axes: { items: [...] } }, tiers, version }
 * We walk the tree and pull out every leaf that has at least an `id` /
 * `name` / `key` field, attaching the parent category for color / sort.
 */
function toCatalog(raw: unknown, source: string) {
  const out: Record<string, unknown>[] = [];
  const walk = (
    node: unknown,
    parentCategory: string | null,
    parentIconBase: string | null,
  ) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v, parentCategory, parentIconBase);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const looksLikeItem =
      ("id" in obj || "name" in obj || "key" in obj) &&
      // not just a wrapper around `items`
      !(Array.isArray(obj.items) && Object.keys(obj).length <= 4);
    if (looksLikeItem) {
      // Promote a few canonical fields the editor UI relies on so it doesn't
      // have to know the Grudge schema's quirks:
      //   `imageUrl`  — absolute URL of the sprite (resolved from spritePath)
      //   `categoryIcon` — the category's iconBase (e.g. "Sword") used as a
      //                    fallback when the sprite 404s and there's no emoji
      //   `description` — folded in from `lore` so the card has something to
      //                    show under the name
      const spritePath = typeof obj.spritePath === "string" ? obj.spritePath : null;
      const lore = typeof obj.lore === "string" ? obj.lore : null;
      out.push({
        ...obj,
        category: obj.category ?? parentCategory ?? undefined,
        categoryIcon: obj.categoryIcon ?? parentIconBase ?? undefined,
        imageUrl: spritePath ? `${GRUDGE_BASE}${spritePath}` : (obj.imageUrl ?? undefined),
        description: obj.description ?? lore ?? undefined,
      });
    }
    // Track iconBase as we descend; categories define it on their wrapper
    // and it should propagate down to leaf items.
    const childIconBase =
      typeof obj.iconBase === "string" ? obj.iconBase : parentIconBase;
    for (const [k, v] of Object.entries(obj)) {
      if (k === "version" || k === "updated" || k === "tiers" || k === "iconBase" || k === "iconMax" || k === "total") continue;
      const nextParent = looksLikeItem ? parentCategory : (typeof v === "object" && v !== null && !Array.isArray(v) ? k : parentCategory);
      walk(v, nextParent, childIconBase);
    }
  };
  walk(raw, null, null);
  // Dedupe by id+name
  const seen = new Set<string>();
  const items = out.filter((it) => {
    const key = `${it.id ?? ""}|${it.name ?? ""}|${it.key ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, source };
}

router.get("/grudge/weapons", async (req, res, next) => {
  try {
    const data = await fetchGrudge("/api/v1/weapons.json");
    res.json(toCatalog(data, "grudge:weapons"));
  } catch (err) {
    req.log.error({ err }, "grudge weapons fetch failed");
    next(err);
  }
});

router.get("/grudge/items", async (req, res, next) => {
  try {
    const data = await fetchGrudge("/api/v1/equipment.json");
    res.json(toCatalog(data, "grudge:equipment"));
  } catch (err) {
    req.log.error({ err }, "grudge items fetch failed");
    next(err);
  }
});

router.get("/grudge/enemies", async (req, res, next) => {
  try {
    const data = await fetchGrudge("/api/v1/enemyTemplates.json");
    res.json(toCatalog(data, "grudge:enemies"));
  } catch (err) {
    req.log.error({ err }, "grudge enemies fetch failed");
    next(err);
  }
});

router.get("/grudge/quests", async (req, res, next) => {
  try {
    const data = await fetchGrudge("/api/v1/quests.json");
    res.json(toCatalog(data, "grudge:quests"));
  } catch (err) {
    req.log.error({ err }, "grudge quests fetch failed");
    next(err);
  }
});

export default router;
