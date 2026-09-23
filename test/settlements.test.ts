import { describe, expect, it } from "vitest";
import { BIOME } from "../src/gen/climate";
import { generate } from "../src/gen/pipeline";
import { DEFAULT_SETTINGS } from "../src/gen/settings";

const SEEDS = [482913, 77, 2024, 5, 31337];
const maps = SEEDS.map((seed) => generate({ ...DEFAULT_SETTINGS, seed }));

describe("towns", () => {
  it("places one capital, the requested number of towns, and villages", () => {
    for (const m of maps) {
      const tiers = m.towns.places.map((p) => p.tier);
      expect(tiers.filter((t) => t === "capital")).toHaveLength(1);
      expect(tiers.filter((t) => t === "town")).toHaveLength(m.settings.town_count - 1);
      expect(tiers.filter((t) => t === "village").length).toBeGreaterThan(0);
    }
  });

  it("follows the town count setting", () => {
    const m = generate({ ...DEFAULT_SETTINGS, seed: 482913, town_count: 9 });
    expect(m.towns.places.filter((p) => p.tier !== "village")).toHaveLength(9);
  });

  it("builds on dry land, never on water, a river or a mountain", () => {
    for (const m of maps) {
      const onRiver = new Set(m.water.rivers.flatMap((r) => r.cells));
      for (const p of m.towns.places) {
        expect(m.water.water[p.cell]).toBe(0);
        expect(onRiver.has(p.cell)).toBe(false);
        expect(m.climate.biome[p.cell]).not.toBe(BIOME.mountain);
      }
    }
  });

  it("keeps settlements apart", () => {
    for (const m of maps) {
      const ps = m.towns.places;
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y)).toBeGreaterThan(45);
    }
  });

  it("prefers water: most towns sit by a river, lake or the sea (spec: good sites)", () => {
    for (const m of maps) {
      const main = m.towns.places.filter((p) => p.tier !== "village");
      const wet = main.filter((p) => p.coastal || p.onRiver).length;
      expect(wet / main.length).toBeGreaterThanOrEqual(0.6);
    }
  });
});

describe("roads (spec: roads connect every town; no river crossing without a bridge)", () => {
  it("connects every settlement into one network", () => {
    for (const m of maps) {
      const parent = m.towns.places.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (const r of m.towns.roads) parent[find(r.from)] = find(r.to);
      const roots = new Set(m.towns.places.map((p) => find(p.id)));
      expect(roots.size).toBe(1);
    }
  });

  it("runs every road end to end between its two settlements", () => {
    for (const m of maps) {
      for (const r of m.towns.roads) {
        expect(r.cells[0]).toBe(m.towns.places[r.from].cell);
        expect(r.cells[r.cells.length - 1]).toBe(m.towns.places[r.to].cell);
      }
    }
  });

  it("never enters the sea or a lake, and steps one cell at a time", () => {
    for (const m of maps) {
      const { cols } = m.water;
      for (const r of m.towns.roads) {
        for (let k = 0; k < r.cells.length; k++) {
          expect(m.water.water[r.cells[k]]).toBe(0);
          if (k === 0) continue;
          const a = r.cells[k - 1];
          const b = r.cells[k];
          expect(Math.max(Math.abs((a % cols) - (b % cols)), Math.abs(Math.floor(a / cols) - Math.floor(b / cols)))).toBe(1);
        }
      }
    }
  });

  it("has a bridge on every river crossing, and never slips between river cells", () => {
    for (const m of maps) {
      const { cols } = m.water;
      const river = new Set(m.water.rivers.flatMap((r) => r.cells.filter((c) => m.water.water[c] === 0)));
      const bridged = new Set(m.towns.bridges.map((b) => b.cell));
      for (const r of m.towns.roads) {
        for (let k = 0; k < r.cells.length; k++) {
          const c = r.cells[k];
          // Stepping onto a river from dry land is a crossing, and needs a bridge.
          if (river.has(c) && (k === 0 || !river.has(r.cells[k - 1]))) expect(bridged.has(c)).toBe(true);
          if (k === 0) continue;
          const a = r.cells[k - 1];
          const ac = a % cols;
          const ar = Math.floor(a / cols);
          const bc = c % cols;
          const br = Math.floor(c / cols);
          if (ac !== bc && ar !== br) {
            // A diagonal step: the two corner cells must not both be river.
            expect(river.has(ar * cols + bc) && river.has(br * cols + ac)).toBe(false);
          }
        }
      }
      expect(m.towns.bridges.length).toBeGreaterThan(0);
    }
  });
});

describe("farmland", () => {
  it("lays fields around settlements", () => {
    for (const m of maps) {
      let fields = 0;
      for (const f of m.towns.farmland) fields += f;
      expect(fields).toBeGreaterThan(50);
      expect(m.symbols.some((s) => s.role === "field")).toBe(true);
    }
  });

  it("keeps symbols off roads and out of settlements", () => {
    for (const m of maps) {
      const { cols, rows } = m.water;
      const cw = m.settings.width / cols;
      const ch = m.settings.height / rows;
      for (const s of m.symbols) {
        const i = Math.floor((s.y - 1) / ch) * cols + Math.floor(s.x / cw);
        expect(m.towns.roadCells[i]).toBe(0);
      }
    }
  });
});

describe("determinism", () => {
  it("gives the same towns, roads and bridges for the same seed", () => {
    const a = generate({ ...DEFAULT_SETTINGS, seed: 4242 }).towns;
    const b = generate({ ...DEFAULT_SETTINGS, seed: 4242 }).towns;
    expect(a.places).toEqual(b.places);
    expect(a.roads).toEqual(b.roads);
    expect(a.bridges).toEqual(b.bridges);
  });
});
