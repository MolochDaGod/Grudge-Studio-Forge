/**
 * Curated color palettes + assignment strategies for `apply_palette`.
 *
 * The tool accepts either a named palette id or a literal `string[]` of
 * hex colors so the model can also pass a custom palette (e.g. derived
 * from existing scene colors during `polish_scene`).
 */

export interface Palette {
  id: string;
  name: string;
  description: string;
  colors: string[];
}

export const PALETTES: readonly Palette[] = [
  {
    id: "grudge-gold",
    name: "Grudge Gold",
    description: "Brand palette: deep charcoal with brass / gold highlights.",
    colors: ["#0a0a14", "#1a1a2e", "#3a2a08", "#7a5e2e", "#d4af37", "#fff5d8"],
  },
  {
    id: "sunset-warm",
    name: "Sunset Warm",
    description: "Warm reds, oranges, and dusky violets.",
    colors: ["#1d0f1a", "#3b1c2a", "#7a2e3e", "#d35d2a", "#ff8a3d", "#ffd070"],
  },
  {
    id: "forest-cool",
    name: "Forest Cool",
    description: "Mossy greens, slate, and cool earth tones.",
    colors: ["#0f1a14", "#1f3326", "#3e6b46", "#5cb85c", "#a3c98c", "#dfead0"],
  },
  {
    id: "neon-noir",
    name: "Neon Noir",
    description: "Deep blue night with cyan and magenta neon accents.",
    colors: ["#06061a", "#0f1a3a", "#2a1a4e", "#ff2a8a", "#2af0ff", "#e0e8ff"],
  },
  {
    id: "desert-day",
    name: "Desert Day",
    description: "Pale sand, terracotta, sun-bleached blue sky.",
    colors: ["#dccba4", "#c79a5a", "#a14b2e", "#5e3220", "#7ea5c8", "#f0e6d2"],
  },
  {
    id: "monochrome-steel",
    name: "Monochrome Steel",
    description: "Greyscale industrial — for prototyping shapes without color noise.",
    colors: ["#0d0d10", "#22232a", "#3f424c", "#6c707a", "#a8acb6", "#e4e6eb"],
  },
] as const;

export function getPalette(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Normalize any palette input — named id or `string[]` of hex — into an
 *  array of validated lowercase hex colors. Throws if invalid. */
export function resolvePalette(input: string | readonly string[]): string[] {
  if (typeof input === "string") {
    const p = getPalette(input);
    if (!p) throw new Error(`Unknown palette id '${input}'`);
    return p.colors.map((c) => c.toLowerCase());
  }
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Palette must be a non-empty array of hex strings or a known palette id.");
  }
  const out: string[] = [];
  for (const c of input) {
    if (typeof c !== "string" || !HEX_RE.test(c)) {
      throw new Error(`Invalid hex color in palette: ${JSON.stringify(c)}`);
    }
    out.push(c.toLowerCase());
  }
  return out;
}

export type PaletteAssignment = "random" | "by-index" | "by-distance-from-origin";

export interface AssignTarget {
  id: string;
  position: readonly [number, number, number];
}

/** Mulberry32 PRNG (deterministic for a fixed seed). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AssignOpts {
  assignment: PaletteAssignment;
  /** Skip the first palette color (commonly the dark background). */
  skipBackground?: boolean;
  /** Seed used by 'random' assignment. */
  seed?: number;
}

/** Assign a palette color to each target according to the strategy.
 *  Returns an array `result[i]` matching `targets[i]`. */
export function assignPaletteColors(
  palette: readonly string[],
  targets: readonly AssignTarget[],
  opts: AssignOpts,
): string[] {
  if (targets.length === 0) return [];
  const useable =
    opts.skipBackground !== false && palette.length > 1 ? palette.slice(1) : palette.slice();
  if (useable.length === 0) return targets.map(() => palette[0] ?? "#ffffff");

  switch (opts.assignment) {
    case "by-index": {
      return targets.map((_t, i) => useable[i % useable.length]);
    }
    case "random": {
      const rng = mulberry32(opts.seed ?? 1);
      return targets.map(() => useable[Math.floor(rng() * useable.length) % useable.length]);
    }
    case "by-distance-from-origin": {
      const ranked = targets
        .map((t, i) => ({
          i,
          d: Math.hypot(t.position[0], t.position[1], t.position[2]),
        }))
        .sort((a, b) => a.d - b.d);
      const out = new Array<string>(targets.length);
      const n = targets.length;
      for (let rank = 0; rank < n; rank++) {
        // Map rank linearly across useable palette indices so close-to-
        // origin targets get the first color, farthest get the last.
        const slot =
          useable.length === 1
            ? 0
            : Math.min(useable.length - 1, Math.floor((rank / Math.max(1, n - 1)) * (useable.length - 1) + 0.0001));
        out[ranked[rank].i] = useable[slot];
      }
      return out;
    }
    default:
      throw new Error(`Unknown assignment '${opts.assignment as string}'`);
  }
}
