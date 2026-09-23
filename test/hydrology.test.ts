import { describe, expect, it } from "vitest";
import type { HeightMap } from "../src/gen/heightmap";
import { hydrology, WATER_LAKE, WATER_SEA, type Hydrology } from "../src/gen/hydrology";
import { landAndSea } from "../src/gen/landsea";
import { generate } from "../src/gen/pipeline";
import { DEFAULT_SETTINGS } from "../src/gen/settings";

const SEEDS = [482913, 1, 77, 2024, 99999];
const maps = SEEDS.map((seed) => generate({ ...DEFAULT_SETTINGS, seed, width: 1200, height: 1800 }));

describe("rivers (spec: rivers always flow downhill and end at the sea or a lake)", () => {
  it("every river runs strictly downhill from source to mouth", () => {
    for (const { water: hy } of maps) {
      expect(hy.rivers.length).toBeGreaterThan(10);
      for (const r of hy.rivers) {
        for (let k = 1; k < r.cells.length; k++) {
          expect(hy.heights[r.cells[k]], `river from cell ${r.cells[0]}`).toBeLessThan(hy.heights[r.cells[k - 1]]);
        }
      }
    }
  });

  it("every river ends in the sea, a lake, or another river that does", () => {
    for (const { water: hy } of maps) {
      const onRiver = new Set(hy.rivers.flatMap((r) => r.cells));
      for (const r of hy.rivers) {
        const last = r.cells[r.cells.length - 1];
        if (r.end === "sea") expect(hy.water[last]).toBe(WATER_SEA);
        else if (r.end === "lake") expect(hy.water[last]).toBe(WATER_LAKE);
        else expect(onRiver.has(last)).toBe(true);
      }
    }
  });

  it("carries more water downstream", () => {
    for (const { water: hy } of maps) {
      for (const r of hy.rivers) for (let k = 1; k < r.flow.length; k++) expect(r.flow[k]).toBeGreaterThanOrEqual(r.flow[k - 1]);
    }
  });

  it("runs over land, apart from where it leaves a lake or reaches water", () => {
    for (const { water: hy } of maps) {
      for (const r of hy.rivers) for (const i of r.cells.slice(1, -1)) expect(hy.water[i]).toBe(0);
    }
  });
});

describe("drainage", () => {
  it("drains every cell to the sea, always downhill, with no loops", () => {
    for (const { water: hy } of maps) {
      const reaches = new Uint8Array(hy.flowTo.length); // 1 once known to reach the sea
      let dead = 0; // cells with nowhere to drain
      let uphill = 0; // steps that go up instead of down
      let loops = 0;
      for (let s = 0; s < hy.flowTo.length; s++) {
        const path: number[] = [];
        let i = s;
        while (hy.water[i] !== WATER_SEA && !reaches[i]) {
          path.push(i);
          const to = hy.flowTo[i];
          if (to < 0) {
            dead++;
            break;
          }
          if (hy.heights[to] >= hy.heights[i]) uphill++;
          if (path.length > hy.flowTo.length) {
            loops++;
            break;
          }
          i = to;
        }
        for (const p of path) reaches[p] = 1;
      }
      expect({ dead, uphill, loops }).toEqual({ dead: 0, uphill: 0, loops: 0 });
    }
  });
});

describe("lakes", () => {
  it("keeps the number of lakes modest (spec: water that cannot escape pools into a lake)", () => {
    for (const { water: hy } of maps) {
      expect(hy.lakes).toBeGreaterThan(0);
      expect(hy.lakes).toBeLessThanOrEqual(12);
    }
  });

  it("gives each lake a level surface", () => {
    for (const { water: hy } of maps) {
      const lo = new Map<number, number>();
      const hi = new Map<number, number>();
      for (let i = 0; i < hy.lakeId.length; i++) {
        const id = hy.lakeId[i];
        if (id < 0) continue;
        lo.set(id, Math.min(lo.get(id) ?? Infinity, hy.heights[i]));
        hi.set(id, Math.max(hi.get(id) ?? -Infinity, hy.heights[i]));
      }
      for (const [id, l] of lo) expect(hi.get(id)! - l).toBeLessThan(0.002);
    }
  });

  it("makes a lake in a bowl and drains it over the rim", () => {
    // A synthetic island: a ring of hills around a deep bowl, sea outside.
    const cols = 60;
    const rows = 60;
    const heights = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.hypot(c - 30, r - 30);
        heights[r * cols + c] = d > 26 ? 0.1 : d > 14 ? 0.6 - (d - 14) * 0.02 : 0.45 + d * 0.01;
      }
    }
    heights[30 * cols + 44] = 0.5; // a low notch in the rim, where the lake overflows
    const m: HeightMap = { cols, rows, cell: 4, heights, seaLevel: 0.2 };
    const hy: Hydrology = hydrology(m, landAndSea(m), { minLakeDepth: 0.01, minLakeCells: 10, maxLakeShare: 0.9, lakesPer100k: 1e6, fillDepth: 0.004, fillCells: 12, riverShare: 0.01 });
    const centre = 30 * cols + 30;
    expect(hy.water[centre]).toBe(WATER_LAKE);
    // Water from the middle of the lake leaves through the notch.
    let i = centre;
    const visited = new Set<number>();
    while (hy.water[i] !== WATER_SEA) {
      visited.add(i);
      i = hy.flowTo[i];
    }
    expect(visited.has(30 * cols + 44)).toBe(true);
  });
});

describe("determinism", () => {
  it("gives identical rivers and lakes for the same seed", () => {
    const a = generate({ ...DEFAULT_SETTINGS, seed: 31337, width: 800, height: 1200 }).water;
    const b = generate({ ...DEFAULT_SETTINGS, seed: 31337, width: 800, height: 1200 }).water;
    expect(a.rivers).toEqual(b.rivers);
    expect(Array.from(a.water)).toEqual(Array.from(b.water));
  });

  it("finishes the default map quickly", () => {
    const m = generate(DEFAULT_SETTINGS);
    // About 0.25 s on its own; room left for other test files running in parallel.
    expect(m.timings["rivers and lakes"]).toBeLessThan(4000);
  });
});
