import { describe, it, expect } from "vitest";
import {
  PALETTES,
  getPalette,
  resolvePalette,
  assignPaletteColors,
} from "../palette";

describe("palette catalog", () => {
  it("ships several non-empty palettes with unique ids", () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(PALETTES.map((p) => p.id));
    expect(ids.size).toBe(PALETTES.length);
    for (const p of PALETTES) {
      expect(p.colors.length).toBeGreaterThanOrEqual(3);
      for (const c of p.colors) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("getPalette returns undefined for unknown ids", () => {
    expect(getPalette("not-a-palette")).toBeUndefined();
    expect(getPalette("grudge-gold")).toBeDefined();
  });
});

describe("resolvePalette", () => {
  it("expands a known id to its colors (lowercase)", () => {
    const colors = resolvePalette("grudge-gold");
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) expect(c).toBe(c.toLowerCase());
  });

  it("accepts a custom hex array", () => {
    const out = resolvePalette(["#ABCDEF", "#001122"]);
    expect(out).toEqual(["#abcdef", "#001122"]);
  });

  it("rejects unknown ids", () => {
    expect(() => resolvePalette("nope-palette")).toThrow();
  });

  it("rejects malformed hex entries", () => {
    expect(() => resolvePalette(["not-hex"])).toThrow();
    expect(() => resolvePalette([])).toThrow();
  });
});

describe("assignPaletteColors", () => {
  const palette = ["#000000", "#aa0000", "#00aa00", "#0000aa"];
  const targets = [
    { id: "a", position: [0, 0, 0] as [number, number, number] },
    { id: "b", position: [1, 0, 0] as [number, number, number] },
    { id: "c", position: [10, 0, 0] as [number, number, number] },
    { id: "d", position: [100, 0, 0] as [number, number, number] },
  ];

  it("returns empty for no targets", () => {
    expect(assignPaletteColors(palette, [], { assignment: "by-index" })).toEqual([]);
  });

  it("by-index cycles through palette colors past background", () => {
    const out = assignPaletteColors(palette, targets, { assignment: "by-index" });
    // Default skipBackground=true → never assigns palette[0]
    for (const c of out) expect(c).not.toBe("#000000");
    expect(out[0]).toBe("#aa0000");
    expect(out[3]).toBe("#aa0000"); // wraps after 3 useable colors
  });

  it("random is deterministic for a fixed seed", () => {
    const a = assignPaletteColors(palette, targets, { assignment: "random", seed: 7 });
    const b = assignPaletteColors(palette, targets, { assignment: "random", seed: 7 });
    expect(a).toEqual(b);
    // skipBackground default → still no '#000000' in random output
    for (const c of a) expect(c).not.toBe("#000000");
  });

  it("by-distance-from-origin sorts colors radially", () => {
    const out = assignPaletteColors(palette, targets, {
      assignment: "by-distance-from-origin",
    });
    // Closest target ('a' at origin) should get the first useable color.
    expect(out[0]).toBe("#aa0000");
    // Farthest target ('d') should get the last useable color.
    expect(out[3]).toBe("#0000aa");
  });

  it("skipBackground=false uses the full palette", () => {
    const out = assignPaletteColors(palette, targets, {
      assignment: "by-index",
      skipBackground: false,
    });
    expect(out[0]).toBe("#000000");
    expect(out[1]).toBe("#aa0000");
  });
});
