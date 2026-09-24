import { describe, expect, it } from "vitest";
import { WATER_SEA } from "../src/gen/hydrology";
import { generate } from "../src/gen/pipeline";
import { SEA_ROLES } from "../src/gen/sea";
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

describe("ships and sea life (generator version 6)", () => {
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

  it("keeps compass lines inside the map", () => {
    const svg = draw({ ...none, compassLines: true, roses: [[800, 1100]] });
    const path = svg.match(/<path d="(M800.0 1100.0L[^"]+)"/)![1];
    for (const [, x, y] of path.matchAll(/L(-?[d.]+) (-?[d.]+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(-0.1);
      expect(Number(x)).toBeLessThanOrEqual(m.settings.width + 0.1);
      expect(Number(y)).toBeGreaterThanOrEqual(-0.1);
      expect(Number(y)).toBeLessThanOrEqual(m.settings.height + 0.1);
    }
  });
});
