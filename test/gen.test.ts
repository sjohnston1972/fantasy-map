import { describe, expect, it } from "vitest";
import { generateHeightMap, toSeaLevel } from "../src/gen/heightmap";
import { landAndSea } from "../src/gen/landsea";
import { fbm, ridged, simplex } from "../src/gen/noise";
import { generate } from "../src/gen/pipeline";
import { renderRelief } from "../src/gen/render";
import { rng, stageSeed } from "../src/gen/rng";
import { cleanSettings, DEFAULT_SETTINGS } from "../src/gen/settings";

// A fingerprint of a whole array, so two maps can be compared exactly.
function hash(a: ArrayLike<number>): string {
  let h = 2166136261;
  const view = new Uint8Array(new Float32Array(Array.from(a)).buffer);
  for (let i = 0; i < view.length; i++) h = Math.imul(h ^ view[i], 16777619);
  return (h >>> 0).toString(16);
}

const small = { ...DEFAULT_SETTINGS, width: 800, height: 1200 };

describe("seeded randomness", () => {
  it("repeats exactly for the same seed and differs for another", () => {
    const a = rng(42);
    const b = rng(42);
    const c = rng(43);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
    for (const v of seqA) expect(v >= 0 && v < 1).toBe(true);
  });

  it("gives each stage its own seed", () => {
    expect(stageSeed(1, "height:base")).not.toBe(stageSeed(1, "height:detail"));
    expect(stageSeed(1, "height:base")).not.toBe(stageSeed(2, "height:base"));
    expect(stageSeed(1, "height:base")).toBe(stageSeed(1, "height:base"));
  });
});

describe("noise", () => {
  const n = simplex(7);
  it("stays within -1 to 1 and is smooth", () => {
    let maxStep = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.01;
      const v = n(x, 0.3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      maxStep = Math.max(maxStep, Math.abs(v - n(x + 0.001, 0.3)));
    }
    expect(maxStep).toBeLessThan(0.05); // no jumps between neighbouring points
  });

  it("depends on the seed", () => {
    expect(simplex(1)(0.37, 0.61)).not.toBe(simplex(2)(0.37, 0.61));
  });

  it("layers octaves and ridges within range", () => {
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(fbm(n, i * 0.13, i * 0.07, 5))).toBeLessThanOrEqual(1);
      const r = ridged(n, i * 0.13, i * 0.07, 5);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe("height map", () => {
  it("is identical for the same seed and settings (spec: determinism)", () => {
    expect(hash(generateHeightMap(small).heights)).toBe(hash(generateHeightMap(small).heights));
  });

  it("changes with the seed", () => {
    expect(hash(generateHeightMap({ ...small, seed: 1 }).heights)).not.toBe(hash(generateHeightMap({ ...small, seed: 2 }).heights));
  });

  it("keeps heights between 0 and 1", () => {
    const m = generateHeightMap(small);
    let lo = 1;
    let hi = 0;
    for (const v of m.heights) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeCloseTo(0, 5);
    expect(hi).toBeCloseTo(1, 5);
  });

  it("makes the sea level setting the share of the map under water", () => {
    for (const sea of [0.2, 0.35, 0.6]) {
      for (const seed of [1, 99, 123456]) {
        const ls = landAndSea(generateHeightMap({ ...small, seed, sea_level: sea }));
        expect(1 - ls.landShare).toBeCloseTo(sea, 2);
      }
    }
  });

  it("gives more high, rugged ground with a higher mountain density", () => {
    const highShare = (density: number) => {
      const m = generateHeightMap({ ...small, seed: 5, mountain_density: density });
      // Roughness: average height change between neighbouring land cells.
      let rough = 0;
      let n = 0;
      for (let r = 0; r < m.rows; r++) {
        for (let c = 1; c < m.cols; c++) {
          const i = r * m.cols + c;
          if (m.heights[i] < m.seaLevel) continue;
          rough += Math.abs(m.heights[i] - m.heights[i - 1]);
          n++;
        }
      }
      return rough / n;
    };
    expect(highShare(0.9)).toBeGreaterThan(highShare(0.1));
  });

  it("keeps its character at any map size", () => {
    // The same seed at double the size is the same landscape, sampled more finely.
    const a = landAndSea(generateHeightMap({ ...small, width: 400, height: 600 }));
    const b = landAndSea(generateHeightMap({ ...small, width: 800, height: 1200 }));
    let same = 0;
    for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) if (a.land[r * a.cols + c] === b.land[r * 2 * b.cols + c * 2]) same++;
    expect(same / (a.rows * a.cols)).toBeGreaterThan(0.9);
  });

  it("rescaling to the sea level keeps the order of heights", () => {
    const raw = Float32Array.from([0.3, -0.2, 0.9, 0.1, 0.5]);
    const out = toSeaLevel(raw, 0.4);
    const order = (a: Float32Array) => Array.from(a.keys()).sort((i, j) => a[i] - a[j]);
    expect(order(out)).toEqual(order(raw));
  });
});

describe("land and sea", () => {
  it("marks the coastline only on land cells that touch water", () => {
    const ls = landAndSea(generateHeightMap(small));
    let coastCells = 0;
    for (let r = 1; r < ls.rows - 1; r++) {
      for (let c = 1; c < ls.cols - 1; c++) {
        const i = r * ls.cols + c;
        if (!ls.coast[i]) continue;
        coastCells++;
        expect(ls.land[i]).toBe(1);
        const touchesWater = !ls.land[i - 1] || !ls.land[i + 1] || !ls.land[i - ls.cols] || !ls.land[i + ls.cols];
        expect(touchesWater).toBe(true);
      }
    }
    expect(coastCells).toBeGreaterThan(50);
  });
});

describe("pipeline and render", () => {
  it("builds a default 1600 by 2400 map quickly and identically twice", () => {
    const a = generate(DEFAULT_SETTINGS);
    const b = generate(DEFAULT_SETTINGS);
    expect(hash(a.height.heights)).toBe(hash(b.height.heights));
    const total = Object.values(a.timings).reduce((x, y) => x + y, 0);
    // About 0.4 s on its own; the limit leaves room for the other test files running in
    // parallel. The spec budget for a whole finished map is 10 s.
    expect(total).toBeLessThan(5000);
  });

  it("renders one RGBA pixel per cell, fully opaque", () => {
    const m = generate(small);
    const px = renderRelief(m.height, m.landSea);
    expect(px.length).toBe(m.height.cols * m.height.rows * 4);
    for (let i = 3; i < px.length; i += 4 * 97) expect(px[i]).toBe(255);
  });

  it("clamps settings to safe values", () => {
    const s = cleanSettings({ seed: -5, width: 99999, sea_level: 2, mountain_density: Number.NaN });
    expect(s.seed).toBe(0);
    expect(s.width).toBe(4000);
    expect(s.sea_level).toBe(0.9);
    expect(s.mountain_density).toBe(DEFAULT_SETTINGS.mountain_density);
  });
});
