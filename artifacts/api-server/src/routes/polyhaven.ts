import { Router, type IRouter } from "express";

const router: IRouter = Router();

/**
 * Poly Haven proxy.
 *
 * Poly Haven (polyhaven.com) is a CC0 asset library: ~756 PBR textures,
 * ~965 HDRIs, ~436 GLTF models, all free for any use including commercial.
 * Their public REST API requires no auth and is CORS-enabled, so we *could*
 * call it directly from the browser, but proxying through this server gives
 * us three things for free:
 *
 *   1. Caching — the catalog rarely changes; a 30-minute in-memory TTL keeps
 *      the editor snappy and is gentle on Poly Haven's CDN.
 *   2. Shape normalization — the upstream API returns a map keyed by slug.
 *      We flatten it to an array of `{ slug, name, type, categories, …,
 *      thumbnail_url }` records so the client renders one card per item
 *      without doing extra work.
 *   3. A single source of truth for the thumbnail URL pattern (the upstream
 *      endpoint doesn't include `thumbnail_url`; we synthesize it from the
 *      slug here).
 */

const POLYHAVEN_API = "https://api.polyhaven.com";
const POLYHAVEN_THUMB = "https://cdn.polyhaven.com/asset_img/thumbs";

const TTL = 30 * 60 * 1000;
const cache = new Map<string, { data: unknown; ts: number }>();

async function cachedFetch(path: string): Promise<unknown> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const r = await fetch(`${POLYHAVEN_API}${path}`);
  if (!r.ok) throw new Error(`Poly Haven fetch failed (${path}): ${r.status}`);
  const data = await r.json();
  cache.set(path, { data, ts: Date.now() });
  return data;
}

type RawAsset = {
  name?: string;
  type?: number;
  categories?: string[];
  tags?: string[];
  dimensions?: number[];
  download_count?: number;
  authors?: Record<string, string>;
  date_published?: number;
};

function flattenAssets(raw: unknown, kind: "textures" | "hdris" | "models") {
  if (!raw || typeof raw !== "object") return { items: [] as unknown[], kind };
  const map = raw as Record<string, RawAsset>;
  const items = Object.entries(map).map(([slug, a]) => ({
    slug,
    name: a.name ?? slug,
    kind,
    categories: Array.isArray(a.categories) ? a.categories : [],
    tags: Array.isArray(a.tags) ? a.tags : [],
    dimensions: Array.isArray(a.dimensions) ? a.dimensions : null,
    download_count: typeof a.download_count === "number" ? a.download_count : 0,
    authors: a.authors ?? {},
    thumbnail_url: `${POLYHAVEN_THUMB}/${slug}.png?width=256`,
  }));
  // Default sort: most downloaded first, so the editor's first page is the
  // canon "good" assets users will recognize.
  items.sort((a, b) => b.download_count - a.download_count);
  return { items, kind, total: items.length };
}

router.get("/polyhaven/textures", async (req, res, next) => {
  try {
    const data = await cachedFetch("/assets?t=textures");
    res.json(flattenAssets(data, "textures"));
  } catch (err) {
    req.log.error({ err }, "polyhaven textures fetch failed");
    next(err);
  }
});

router.get("/polyhaven/hdris", async (req, res, next) => {
  try {
    const data = await cachedFetch("/assets?t=hdris");
    res.json(flattenAssets(data, "hdris"));
  } catch (err) {
    req.log.error({ err }, "polyhaven hdris fetch failed");
    next(err);
  }
});

router.get("/polyhaven/models", async (req, res, next) => {
  try {
    const data = await cachedFetch("/assets?t=models");
    res.json(flattenAssets(data, "models"));
  } catch (err) {
    req.log.error({ err }, "polyhaven models fetch failed");
    next(err);
  }
});

/**
 * Resolve the actual download URLs for a single asset. We don't hit this
 * during listing (the upstream call is per-asset and would multiply the
 * request count by 700+), only when the user actually clicks "spawn" or
 * "import".
 *
 * Response shape (slim — we drop the high-resolution variants the editor
 * never uses to keep responses small):
 *   {
 *     slug: "brick_wall_001",
 *     model: { url, format } | null,         // for models
 *     hdri:  { url, format, resolution } | null,  // for HDRIs
 *     texture: {
 *       diffuse?:  { url, ext },
 *       normal?:   { url, ext },
 *       roughness?:{ url, ext },
 *       ao?:       { url, ext },
 *       displacement?: { url, ext },
 *     } | null
 *   }
 */
router.get("/polyhaven/files/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug ?? "").replace(/[^a-z0-9_-]/gi, "");
    if (!slug) {
      res.status(400).json({ error: "missing slug" });
      return;
    }
    const raw = (await cachedFetch(`/files/${slug}`)) as Record<string, unknown>;

    // Pick the cheapest resolution that exists for the chosen file kind.
    const pickResolution = (
      group: Record<string, unknown> | undefined,
    ): { res: string; node: Record<string, unknown> } | null => {
      if (!group) return null;
      for (const r of ["1k", "2k", "4k", "8k"]) {
        const node = group[r];
        if (node && typeof node === "object") {
          return { res: r, node: node as Record<string, unknown> };
        }
      }
      return null;
    };

    const pickFile = (
      group: Record<string, unknown> | undefined,
      preferredFormats: string[],
    ): { url: string; ext: string; resolution: string } | null => {
      const r = pickResolution(group);
      if (!r) return null;
      for (const fmt of preferredFormats) {
        const f = r.node[fmt];
        if (f && typeof f === "object" && typeof (f as { url?: unknown }).url === "string") {
          return {
            url: (f as { url: string }).url,
            ext: fmt,
            resolution: r.res,
          };
        }
      }
      return null;
    };

    /**
     * Some Poly Haven texture entries don't expose a "Diffuse" map at all —
     * they ship multiple per-pattern colour variants under keys like `col1`,
     * `col_01`, `coll1`, `diff_png`, etc. (e.g. `book_pattern`, `leather_red_02`,
     * `fabric_pattern_05`). We try a prioritized list of candidate keys per
     * map kind so single-variant calls still land on a real download URL
     * for those textures.
     */
    const tryKeys = (
      keys: string[],
      formats: string[],
    ): { url: string; ext: string; resolution: string } | null => {
      for (const k of keys) {
        const node = raw[k];
        if (node && typeof node === "object") {
          const hit = pickFile(node as Record<string, unknown>, formats);
          if (hit) return hit;
        }
      }
      return null;
    };

    const IMG = ["jpg", "png", "exr"];
    const gltf = tryKeys(["gltf"], ["gltf"]);
    const hdri = tryKeys(["hdri"], ["hdr", "exr"]);
    const diffuse = tryKeys(
      [
        "Diffuse",
        "diffuse",
        "diff",
        "diff_png",
        "col",
        "col_1",
        "col_01",
        "col1",
        "coll1",
        "col_2",
        "col_02",
        "col2",
        "coll2",
        "col_03",
        "color",
      ],
      IMG,
    );
    const normal = tryKeys(["nor_gl", "nor_dx", "Normal", "normal"], IMG);
    const rough = tryKeys(["Rough", "rough", "roughness"], IMG);
    const ao = tryKeys(["AO", "ao"], IMG);
    const disp = tryKeys(["Displacement", "displacement", "disp"], IMG);

    res.json({
      slug,
      model: gltf,
      hdri,
      texture:
        diffuse || normal || rough || ao || disp
          ? {
              diffuse: diffuse ?? undefined,
              normal: normal ?? undefined,
              roughness: rough ?? undefined,
              ao: ao ?? undefined,
              displacement: disp ?? undefined,
            }
          : null,
    });
  } catch (err) {
    req.log.error({ err }, "polyhaven files fetch failed");
    next(err);
  }
});

export default router;
