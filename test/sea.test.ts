import { describe, expect, it } from "vitest";
import { WATER_LAKE, WATER_SEA } from "../src/gen/hydrology";
import { deltaPlan } from "../src/gen/deltas";
import { generate } from "../src/gen/pipeline";
import { SEA_ROLES } from "../src/gen/sea";
import { overlapShare } from "../src/gen/symbols";
import { DEFAULT_SETTINGS } from "../src/gen/settings";
import { renderSvg } from "../src/gen/svg";

const SEEDS = [482913, 77, 2024];
const maps = SEEDS.map((seed) => generate({ ...DEFAULT_SETTINGS, seed }));
const isSea = (r: string) => (SEA_ROLES as readonly string[]).includes(r);

describe("land and the frame (generator version 6)", () => {
  it("keeps open sea between every coast and the frame", () => {
    for (const m of maps) {
      const { cols, rows } = m.water;
      const band = Math.ceil(Math.min(cols, rows) * 0.03);
      let land = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) if ((c < band || r < band || c >= cols - band || r >= rows - band) && m.water.water[r * cols + c] !== WATER_SEA) land++;
      expect(land, `seed ${m.settings.seed}`).toBe(0);
    }
  });
});

describe("ships and sea life (generator versions 6 and 7)", () => {
  it("puts ships, creatures and reefs at sea and lighthouses on the coast", () => {
    for (const m of maps) {
      const sea = m.symbols.filter((s) => isSea(s.role));
      expect(sea.length, `seed ${m.settings.seed}`).toBeGreaterThan(0);
      const { cols, rows } = m.water;
      const cell = (x: number, y: number) => m.water.water[Math.min(rows - 1, Math.floor((y / m.settings.height) * rows)) * cols + Math.min(cols - 1, Math.floor((x / m.settings.width) * cols))];
      for (const s of sea) {
        const middle = cell(s.x, s.y - s.h / 2);
        if (s.role === "lighthouses-and-beacons") expect(middle).not.toBe(WATER_SEA);
        else expect(middle, s.role).toBe(WATER_SEA);
      }
    }
  });

  it("follows the setting, and earlier versions have none", () => {
    const count = (o: object) => generate({ ...DEFAULT_SETTINGS, seed: 482913, ...o }).symbols.filter((s) => isSea(s.role)).length;
    expect(count({ sea_life: 0 })).toBe(0);
    expect(count({ sea_life: 1 })).toBeGreaterThan(count({ sea_life: 0.3 }));
    expect(count({ v: 5, sea_life: 1 })).toBe(0);
  });

  it("from version 7 finds headlands for lighthouses, clearing the trees and hills from them", () => {
    const lights = (m: ReturnType<typeof generate>) => m.symbols.filter((s) => s.role === "lighthouses-and-beacons");
    for (const seed of [7919, 15838, 23757, 31676, 39595]) {
      const m = generate({ ...DEFAULT_SETTINGS, seed, sea_life: 1 });
      expect(lights(m).length, `seed ${seed}`).toBeGreaterThan(0);
      for (const l of lights(m))
        for (const s of m.symbols) if (s !== l && !isSea(s.role)) expect(overlapShare(l, s), `seed ${seed} ${s.role}`).toBe(0);
    }
    // Version 6 maps keep the stricter rule, so their symbols (and edits to them) stay put.
    expect(lights(generate({ ...DEFAULT_SETTINGS, v: 6, seed: 482913, sea_life: 1 }))).toHaveLength(0);
  });
});

describe("drawing the sea", () => {
  const m = maps[0];
  const draw = (sea?: Parameters<typeof renderSvg>[0]["sea"]) => renderSvg({ width: m.settings.width, height: m.settings.height, water: m.water, symbols: m.symbols, towns: m.towns, labels: m.labels, sea });
  const none = { waves: 0, compassLines: false, shallows: false, deltas: false };

  it("draws nothing extra with every option off", () => {
    expect(draw(none)).toBe(draw());
  });

  it("adds each option's marks on its own", () => {
    const base = draw(none).length;
    for (const option of [{ waves: 0.5 }, { compassLines: true, roses: [[800, 800]] as [number, number][] }, { shallows: true }, { deltas: true }]) {
      expect(draw({ ...none, ...option }).length, JSON.stringify(option)).toBeGreaterThan(base);
    }
    expect(draw({ ...none, waves: 1 }).length).toBeGreaterThan(draw({ ...none, waves: 0.2 }).length);
  });

  it("draws wave marks on larger lakes as well as the sea, and none with waves off", () => {
    const withLakes = maps.filter((mm) => mm.water.water.some((w) => w === WATER_LAKE));
    expect(withLakes.length).toBeGreaterThan(0);
    const svg = draw({ ...none, waves: 1 });
    expect(svg).toContain('data-waves="sea"');
    expect(svg).toContain('data-waves="lake"');
    expect(draw({ ...none, waves: 0 })).not.toContain("data-waves");
  });

  it("varies the wave marks, so neighbours are not copies of one glyph", () => {
    const d = draw({ ...none, waves: 1 }).match(/data-waves="sea" d="([^"]+)"/)![1];
    // Each swell's shape relative to its own start point.
    const shapes = d.split("M").filter(Boolean).map((part) => {
      const nums = part.match(/-?[\d.]+/g)!.map(Number);
      return nums.map((v, k) => (v - nums[k % 2]).toFixed(1)).join(",");
    });
    expect(shapes.length).toBeGreaterThan(50);
    expect(new Set(shapes).size).toBeGreaterThan(shapes.length * 0.5);
  });

  it("keeps compass lines inside the map", () => {
    const svg = draw({ ...none, compassLines: true, roses: [[800, 1100]] });
    const path = svg.match(/<path d="(M800.0 1100.0L[^"]+)"/)![1];
    let checked = 0;
    for (const [, x, y] of path.matchAll(/L(-?[\d.]+) (-?[\d.]+)/g)) {
      checked++;
      expect(Number(x)).toBeGreaterThanOrEqual(-0.1);
      expect(Number(x)).toBeLessThanOrEqual(m.settings.width + 0.1);
      expect(Number(y)).toBeGreaterThanOrEqual(-0.1);
      expect(Number(y)).toBeLessThanOrEqual(m.settings.height + 0.1);
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("river deltas (drawing only)", () => {
  it("builds fans of land out of sea at the larger mouths, and channels that end at the new shore", () => {
    for (const m of maps) {
      const hy = m.water;
      const { water, deltas } = deltaPlan(hy, m.towns.places, m.settings.width);
      expect(deltas.length, `seed ${m.settings.seed}`).toBeGreaterThan(0);
      expect(deltas.length).toBeLessThanOrEqual(6);
      for (const d of deltas) {
        expect(d.channels.length).toBeGreaterThanOrEqual(2);
        for (const i of d.land) {
          expect(hy.water[i]).toBe(WATER_SEA); // only sea becomes delta land
          expect(water[i]).toBe(0);
        }
        for (const ch of d.channels) {
          // The end is on the shore: land and sea both within a cell and a half.
          const [x, y] = ch.to;
          let land = false;
          let sea = false;
          for (let dy = -1.5; dy <= 1.5; dy += 0.5)
            for (let dx = -1.5; dx <= 1.5; dx += 0.5) {
              const w = water[Math.floor(y + dy) * hy.cols + Math.floor(x + dx)];
              if (w === WATER_SEA) sea = true;
              else land = true;
            }
          expect(land && sea, `seed ${m.settings.seed} channel end ${x},${y}`).toBe(true);
        }
      }
      // The generated map itself is untouched.
      expect(water).not.toBe(hy.water);
    }
  });

  it("leaves a river that reaches the sea at a town without a delta", () => {
    const m = maps[0];
    const all = deltaPlan(m.water, [], m.settings.width).deltas;
    const mouth = all[0].river.cells[all[0].river.cells.length - 1];
    const town = { x: ((mouth % m.water.cols) + 0.5) * (m.settings.width / m.water.cols), y: (Math.floor(mouth / m.water.cols) + 0.5) * (m.settings.width / m.water.cols) };
    const near = deltaPlan(m.water, [town], m.settings.width).deltas;
    expect(near.map((d) => d.river)).not.toContain(all[0].river);
  });
});
