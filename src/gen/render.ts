// Debug render for milestone 2: a grey-shaded terrain image (spec build order, row 2).
// Land is shaded by height and lit from the top left, the same light direction the
// symbol style guide uses, so slopes facing away from the light are darker. Water is a
// flat pale tone with the coastline inked. The real ink renderer replaces this later.

import type { HeightMap } from "./heightmap";
import { WATER_LAKE, WATER_SEA, type Hydrology } from "./hydrology";
import type { LandSea } from "./landsea";

// Returns RGBA pixels at one pixel per height-map cell; the page scales it up smoothly.
export function renderRelief(m: HeightMap, ls: LandSea, hy?: Hydrology): Uint8ClampedArray<ArrayBuffer> {
  const { cols, rows, seaLevel } = m;
  // With rivers worked out, shade the adjusted terrain (gorges show) and take water from it.
  const heights: ArrayLike<number> = hy ? hy.heights : m.heights;
  const isWater = (i: number) => (hy ? hy.water[i] === WATER_SEA : !ls.land[i]);
  const isCoast = (i: number, c: number, r: number) =>
    hy
      ? hy.water[i] === 0 && ((c > 0 && hy.water[i - 1] !== 0) || (c < cols - 1 && hy.water[i + 1] !== 0) || (r > 0 && hy.water[i - cols] !== 0) || (r < rows - 1 && hy.water[i + cols] !== 0))
      : ls.coast[i] === 1;
  const out = new Uint8ClampedArray(cols * rows * 4);
  // Light from the top left (north-west), 45 degrees up.
  const lx = -Math.SQRT1_2 * Math.SQRT1_2;
  const ly = -Math.SQRT1_2 * Math.SQRT1_2;
  const lz = Math.SQRT1_2;
  const relief = 18; // exaggerates slopes so hills read clearly at map scale
  const h = (c: number, r: number) => heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const o = i * 4;
      if (hy && hy.water[i] === WATER_LAKE) {
        // Lakes: debug blue, so they stand apart from the sea.
        out[o] = 150;
        out[o + 1] = 185;
        out[o + 2] = 225;
        out[o + 3] = 255;
        continue;
      }
      if (isWater(i)) {
        // Water: pale, slightly darker in deep water.
        const depth = seaLevel > 0 ? 1 - heights[i] / seaLevel : 0;
        const v = 236 - depth * 26;
        out[o] = v - 6;
        out[o + 1] = v;
        out[o + 2] = v + 6;
        out[o + 3] = 255;
        continue;
      }
      if (isCoast(i, c, r)) {
        out[o] = out[o + 1] = out[o + 2] = 30;
        out[o + 3] = 255;
        continue;
      }
      // Surface normal from the slope, then how directly it faces the light.
      const dx = (h(c + 1, r) - h(c - 1, r)) * relief;
      const dy = (h(c, r + 1) - h(c, r - 1)) * relief;
      const len = Math.hypot(dx, dy, 1);
      const shade = Math.max(0, (-dx * lx - dy * ly + lz) / len);
      const elevation = Math.max(0, (heights[i] - seaLevel) / (1 - seaLevel));
      const v = 40 + shade * 175 + elevation * 45;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}

// Debug rivers (milestone 3): blue lines, wider where more water has gathered. Drawn in
// cell units on a canvas that has one pixel per height-map cell, scaled by `scale`.
export function drawRivers(ctx: CanvasRenderingContext2D, hy: Hydrology, scale = 1) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#1f5fbf";
  const minFlow = Math.min(...hy.rivers.map((r) => r.flow[0] ?? Infinity));
  for (const river of hy.rivers) {
    const pts = smooth(river.cells.map((i) => [((i % hy.cols) + 0.5) * scale, (Math.floor(i / hy.cols) + 0.5) * scale] as [number, number]));
    // Draw in short pieces so the width can grow downstream.
    for (let k = 1; k < pts.length; k++) {
      const f = river.flow[Math.min(river.flow.length - 1, Math.floor(k / 2))];
      // Hairline at the source, widening slowly (logarithmically) with the water carried.
      ctx.lineWidth = Math.min(2.2, 0.3 + 0.25 * Math.log2(Math.max(1, f / minFlow))) * scale;
      ctx.beginPath();
      ctx.moveTo(pts[k - 1][0], pts[k - 1][1]);
      ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Chaikin corner cutting: one pass turns grid staircases into gentle curves while keeping
// both ends where they were. Purely cosmetic; the river's cells are unchanged.
export function smooth(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
