import { describe, expect, it } from "vitest";
import { BIOME, BIOMES } from "../src/gen/climate";
import { outlines, simplify } from "../src/gen/contours";
import { WATER_SEA } from "../src/gen/hydrology";
import { generate } from "../src/gen/pipeline";
import { DEFAULT_SETTINGS } from "../src/gen/settings";
import { MAX_MOUNTAIN_OVERLAP, MAX_OVERLAP, MAX_TREE_OVERLAP, overlapLimit, overlapShare, type PlacedSymbol } from "../src/gen/symbols";
import { toInkSet } from "../src/gen/inkset";
import { renderSvg } from "../src/gen/svg";
import { SEA_ROLES } from "../src/gen/sea";

const SEEDS = [482913, 77, 2024, 5, 31337];
const maps = SEEDS.map((seed) => generate({ ...DEFAULT_SETTINGS, seed }));

describe("biomes", () => {
  it("gives every land cell a land biome and every water cell water", () => {
    for (const m of maps) {
      let wrong = 0;
      for (let i = 0; i < m.climate.biome.length; i++) if ((m.climate.biome[i] === BIOME.water) !== (m.water.water[i] !== 0)) wrong++;
      expect(wrong).toBe(0);
    }
  });

  it("uses the spec's four biomes, plus desert and tundra, across a handful of maps", () => {
    const seen = new Set<string>();
    for (const m of maps) for (const b of m.climate.biome) seen.add(BIOMES[b]);
    for (const b of ["forest", "grassland", "marsh", "mountain", "desert", "tundra"]) expect(seen, b).toContain(b);
  });

  it("grows more forest with a higher forest density", () => {
    const share = (d: number) => {
      const m = generate({ ...DEFAULT_SETTINGS, seed: 482913, forest_density: d });
      let forest = 0;
      let land = 0;
      for (let i = 0; i < m.climate.biome.length; i++) {
        if (m.water.water[i]) continue;
        land++;
        if (m.climate.biome[i] === BIOME.forest) forest++;
      }
      return forest / land;
    };
    expect(share(0.9)).toBeGreaterThan(share(0.2) + 0.1);
  });
});

describe("symbols", () => {
  it("places thousands of symbols, including mountains, hills and trees", () => {
    for (const m of maps) {
      expect(m.symbols.length).toBeGreaterThan(1000);
      const roles = new Set(m.symbols.map((s) => s.role));
      expect(roles.has("hill")).toBe(true);
    }
    const all = new Set(maps.flatMap((m) => m.symbols.map((s) => s.role)));
    for (const r of ["mountain", "hill", "conifer", "broadleaf", "reeds", "dune", "snow"]) expect(all, r).toContain(r);
  });

  // Spec acceptance: no two symbols overlap by more than 20%. Steven asked for forests of
  // overlapping trees (generator version 2) and massed mountain ranges and hills (version 5),
  // so those pairs may overlap more (see overlapLimit); every other pair keeps 20%.
  const isTree = (s: PlacedSymbol) => s.role === "conifer" || s.role === "broadleaf";
  const worstOverlaps = (symbols: PlacedSymbol[]) => {
    const s = [...symbols].sort((a, b) => a.x - a.w / 2 - (b.x - b.w / 2));
    let trees = 0;
    let mountains = 0;
    let other = 0;
    let hills = 0; // the most any pair involving a hill goes over its own limit
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length && s[j].x - s[j].w / 2 < s[i].x + s[i].w / 2; j++) {
        const o = overlapShare(s[i], s[j]);
        if (isTree(s[i]) && isTree(s[j])) trees = Math.max(trees, o);
        else if (s[i].role === "mountain" && s[j].role === "mountain") mountains = Math.max(mountains, o);
        else if (s[i].role === "hill" || s[j].role === "hill") hills = Math.max(hills, o - overlapLimit(s[i].role, s[j].role, 5));
        else other = Math.max(other, o);
      }
    }
    return { trees, mountains, hills, other };
  };

  it("never overlaps two symbols by more than 20%, except tree on tree and mountain on mountain (spec acceptance)", () => {
    for (const m of maps) {
      const w = worstOverlaps(m.symbols);
      expect(w.other).toBeLessThanOrEqual(MAX_OVERLAP);
      expect(w.trees).toBeLessThanOrEqual(MAX_TREE_OVERLAP);
      expect(w.mountains).toBeLessThanOrEqual(MAX_MOUNTAIN_OVERLAP);
      expect(w.hills).toBeLessThanOrEqual(1e-9);
      expect(w.trees).toBeGreaterThan(MAX_OVERLAP); // forests really do overlap now
    }
    // Ranges overlap on at least some maps (not every test map has mountains close together).
    expect(Math.max(...maps.map((m) => worstOverlaps(m.symbols).mountains))).toBeGreaterThan(MAX_OVERLAP);
    expect(overlapLimit("mountain", "mountain", 4)).toBe(MAX_OVERLAP);
    expect(overlapLimit("mountain", "conifer", 5)).toBe(MAX_OVERLAP);
    expect(overlapLimit("hill", "hill", 5)).toBeGreaterThan(MAX_OVERLAP);
    expect(overlapLimit("hill", "conifer", 5)).toBe(MAX_OVERLAP);
  });

  it("masses mountains into ranges, bigger on higher ground (generator version 5)", () => {
    const seed = 482913;
    const count = (v: number) => generate({ ...DEFAULT_SETTINGS, seed, v }).symbols.filter((s) => s.role === "mountain");
    const v4 = count(4);
    const v5 = count(5);
    expect(v5.length).toBeGreaterThan(v4.length * 1.5);
    // Bigger peaks where the ground is higher: the tallest third stands higher than the rest.
    const m = generate({ ...DEFAULT_SETTINGS, seed, v: 5 });
    const { cols, rows } = m.water;
    const height = (s: PlacedSymbol) => m.climate.elevation[Math.min(rows - 1, Math.floor((s.y / m.settings.height) * rows)) * cols + Math.min(cols - 1, Math.floor((s.x / m.settings.width) * cols))];
    const sorted = [...v5].sort((a, b) => b.w - a.w);
    const third = Math.floor(sorted.length / 3);
    const mean = (list: PlacedSymbol[]) => list.reduce((n, s) => n + height(s), 0) / list.length;
    expect(mean(sorted.slice(0, third))).toBeGreaterThan(mean(sorted.slice(-third)));
  });

  it("keeps the first generator's 20% rule for trees on version 1 links", () => {
    const w = worstOverlaps(generate({ ...DEFAULT_SETTINGS, v: 1, seed: 482913 }).symbols);
    expect(Math.max(w.trees, w.other)).toBeLessThanOrEqual(MAX_OVERLAP);
  });

  it("grows forests in stands of one kind of tree", () => {
    // Share of trees whose nearest tree is of the other kind: low means solid stands.
    const mixing = (symbols: PlacedSymbol[]) => {
      const trees = symbols.filter(isTree);
      let mixed = 0;
      for (const a of trees) {
        let best = Infinity;
        let kind = a.role;
        for (const b of trees) {
          if (b === a) continue;
          const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (d < best) (best = d), (kind = b.role);
        }
        if (kind !== a.role) mixed++;
      }
      return mixed / trees.length;
    };
    const seed = 482913;
    expect(mixing(generate({ ...DEFAULT_SETTINGS, seed, v: 2 }).symbols)).toBeLessThan(mixing(generate({ ...DEFAULT_SETTINGS, seed, v: 1 }).symbols));
    expect(mixing(generate({ ...DEFAULT_SETTINGS, seed, v: 2 }).symbols)).toBeLessThan(0.08);
  });

  it("stands every symbol on dry land, off the rivers", () => {
    for (const m of maps) {
      const { cols, rows } = m.water;
      const onRiver = new Set(m.water.rivers.flatMap((r) => r.cells));
      for (const s of m.symbols.filter((s) => !(SEA_ROLES as readonly string[]).includes(s.role))) {
        const i = Math.floor((s.y - 1) / (m.settings.height / rows)) * cols + Math.floor(s.x / (m.settings.width / cols));
        expect(m.water.water[i]).toBe(0);
        expect(onRiver.has(i)).toBe(false);
      }
    }
  });

  it("draws back to front, so nearer symbols overlap further ones", () => {
    for (const m of maps) for (let k = 1; k < m.symbols.length; k++) expect(m.symbols[k].y).toBeGreaterThanOrEqual(m.symbols[k - 1].y);
  });

  it("repeats exactly for the same seed", () => {
    const a = generate({ ...DEFAULT_SETTINGS, seed: 99, width: 800, height: 1131 }).symbols;
    const b = generate({ ...DEFAULT_SETTINGS, seed: 99, width: 800, height: 1131 }).symbols;
    expect(a).toEqual(b);
  });

  it("measures overlap as a share of the smaller symbol", () => {
    const box = (x: number, y: number, w: number, h: number): PlacedSymbol => ({ role: "hill", x, y, w, h, variant: 0, flip: false });
    expect(overlapShare(box(10, 10, 10, 10), box(10, 10, 10, 10))).toBe(1);
    expect(overlapShare(box(10, 10, 10, 10), box(30, 10, 10, 10))).toBe(0);
    expect(overlapShare(box(10, 10, 10, 10), box(18, 10, 10, 10))).toBeCloseTo(0.2);
  });
});

describe("SVG render", () => {
  const m = maps[0];
  const svg = renderSvg({ width: m.settings.width, height: m.settings.height, water: m.water, symbols: m.symbols });

  it("is one SVG sized to the map, with no broken numbers", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${m.settings.width} ${m.settings.height}"`);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect((svg.match(/<g/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
  });

  it("draws every symbol once", () => {
    expect((svg.match(/data-sym="/g) ?? []).length).toBe(m.symbols.length);
  });

  it("stays a sensible size for the browser", () => {
    expect(svg.length).toBeLessThan(2_500_000);
  });
});

describe("contours", () => {
  it("outlines a single cell as one closed loop", () => {
    const loops = outlines(3, 3, (i) => i === 4);
    expect(loops).toHaveLength(1);
    expect(loops[0].length).toBe(4);
  });

  it("outlines the land of a real map, one loop per island or lake edge", () => {
    const loops = outlines(maps[0].water.cols, maps[0].water.rows, (i) => maps[0].water.water[i] !== WATER_SEA);
    expect(loops.length).toBeGreaterThan(1);
    for (const l of loops) expect(l.length).toBeGreaterThanOrEqual(4);
  });

  it("simplifies a straight line to its ends", () => {
    expect(simplify([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 0.1)).toEqual([[0, 0], [4, 0]]);
  });
});

describe("SVG render with ink symbols", () => {
  const m = maps[0];
  const drawing = (id: string) => ({ id, w: 40, h: 30, anchorX: 0.5, anchorY: 1, facing: "none", viewBox: "0 0 40 30", body: '<path fill="#000" d="M0 0h40v30z"/>' });
  const ink = toInkSet([
    { role: "mountain", symbols: [drawing("m1"), drawing("m2")] },
    { role: "conifer", symbols: [drawing("c1")] },
    { role: "town", symbols: [drawing("t1")] },
  ]);
  const svg = renderSvg({ width: m.settings.width, height: m.settings.height, water: m.water, symbols: m.symbols, towns: m.towns, ink });

  it("defines each drawing once and places it by reference", () => {
    expect((svg.match(/<symbol /g) ?? []).length).toBeLessThanOrEqual(4);
    expect(svg).toContain("<defs data-layer=\"drawings\">");
    const mountains = m.symbols.filter((s) => s.role === "mountain").length;
    expect((svg.match(/<use /g) ?? []).length).toBeGreaterThanOrEqual(mountains * 2);
  });

  it("draws a white knockout behind each ink placement", () => {
    const uses = svg.match(/<use [^>]*>/g) ?? [];
    const white = uses.filter((u) => u.includes('color="#fff"')).length;
    expect(white).toBe(uses.length / 2);
  });

  it("switches pack drawings to currentColor so one drawing serves both passes", () => {
    expect(ink.mountain![0].body).toContain('fill="currentColor"');
  });

  it("still draws placeholders for roles with no drawings", () => {
    expect(svg).toContain('data-role="reeds"');
    expect(svg).not.toMatch(/NaN|undefined/);
  });
});
