// Debug render for milestone 2: a grey-shaded terrain image (spec build order, row 2).
// Land is shaded by height and lit from the top left, the same light direction the
// symbol style guide uses, so slopes facing away from the light are darker. Water is a
// flat pale tone with the coastline inked. The real ink renderer replaces this later.

import type { HeightMap } from "./heightmap";
import type { LandSea } from "./landsea";

// Returns RGBA pixels at one pixel per height-map cell; the page scales it up smoothly.
export function renderRelief(m: HeightMap, ls: LandSea): Uint8ClampedArray<ArrayBuffer> {
  const { cols, rows, heights, seaLevel } = m;
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
      if (!ls.land[i]) {
        // Water: pale, slightly darker in deep water.
        const depth = seaLevel > 0 ? 1 - heights[i] / seaLevel : 0;
        const v = 236 - depth * 26;
        out[o] = v - 6;
        out[o + 1] = v;
        out[o + 2] = v + 6;
        out[o + 3] = 255;
        continue;
      }
      if (ls.coast[i]) {
        out[o] = out[o + 1] = out[o + 2] = 30;
        out[o + 3] = 255;
        continue;
      }
      // Surface normal from the slope, then how directly it faces the light.
      const dx = (h(c + 1, r) - h(c - 1, r)) * relief;
      const dy = (h(c, r + 1) - h(c, r - 1)) * relief;
      const len = Math.hypot(dx, dy, 1);
      const shade = Math.max(0, (-dx * lx - dy * ly + lz) / len);
      const elevation = (heights[i] - seaLevel) / (1 - seaLevel);
      const v = 40 + shade * 175 + elevation * 45;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}
