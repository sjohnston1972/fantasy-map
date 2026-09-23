// Stage 2: height map (spec "How the generator works", step 2). Gives every point of
// the map an elevation from 0 (deepest sea) to 1 (highest peak).
//
// Heights are held on a grid, one value per CELL x CELL block of map pixels, which is
// plenty of detail for terrain and keeps generation fast.

import { stageSeed } from "./rng";
import { fbm, ridged, simplex } from "./noise";
import type { MapSettings } from "./settings";

export const CELL = 4; // map pixels per grid cell

export interface HeightMap {
  cols: number;
  rows: number;
  cell: number;
  heights: Float32Array; // row by row, 0 to 1
  seaLevel: number; // heights below this are water
}

export function generateHeightMap(s: MapSettings): HeightMap {
  const cols = Math.ceil(s.width / CELL);
  const rows = Math.ceil(s.height / CELL);
  const base = simplex(stageSeed(s.seed, "height:base"));
  const detail = simplex(stageSeed(s.seed, "height:detail"));
  const mountains = simplex(stageSeed(s.seed, "height:mountains"));
  const where = simplex(stageSeed(s.seed, "height:mountain-belts"));
  const warpX = simplex(stageSeed(s.seed, "height:warp-x"));
  const warpY = simplex(stageSeed(s.seed, "height:warp-y"));

  // Coordinates are measured in "map widths", so the landscape keeps the same character
  // at any map size; a larger map simply gets more pixels per hill.
  const unit = Math.min(s.width, s.height);
  const spanX = s.width / unit;
  const spanY = s.height / unit;
  const raw = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) * CELL) / unit;
      const y = ((r + 0.5) * CELL) / unit;
      // Domain warp: nudge the sample point by a slow noise field, which bends smooth
      // noise contours into irregular, natural coastlines. Kept gentle: strong warping
      // twists hills into swirls.
      const wx = x + 0.08 * fbm(warpX, x * 2, y * 2, 2);
      const wy = y + 0.08 * fbm(warpY, x * 2, y * 2, 2);
      const land = fbm(base, wx * 1.6, wy * 1.6, 6); // broad landmasses, with coastline detail
      // Hills and mountains use the unwarped position: warping fine detail smears it
      // into streaks. Only the coastline needs the warp.
      const hills = fbm(detail, x * 6, y * 6, 4); // rolling ground
      // Mountains rise only in belts where a slow noise field is high, so ranges form
      // in some places instead of peaks everywhere. Mountain density widens the belts.
      const beltNoise = fbm(where, x * 1.4, y * 1.4, 2) * 0.5 + 0.5;
      const belt = smoothstep(0.6 - s.mountain_density * 0.35, 0.78 - s.mountain_density * 0.3, beltNoise);
      const peaks = ridged(mountains, x * 4, y * 4, 6);
      // A region map is a stretch of land with sea around it (see the example maps), so
      // the ground sinks towards the map edges and rises gently towards the middle. The
      // edge distance is roughened by noise so the land does not follow the frame.
      const edge = Math.min(x, spanX - x, y, spanY - y) + 0.12 * fbm(warpY, x * 3, y * 3, 3);
      const shelf = smoothstep(0, 0.3, edge);
      const middle = 1 - Math.hypot((x - spanX / 2) / spanX, (y - spanY / 2) / spanY) * 1.6;
      raw[r * cols + c] =
        0.5 * land + 0.06 * hills + 0.25 * middle - 0.35 * (1 - shelf) + belt * peaks * (0.35 + 0.5 * s.mountain_density);
    }
  }
  return { cols, rows, cell: CELL, heights: toSeaLevel(raw, s.sea_level), seaLevel: s.sea_level };
}

// Rescale raw heights so that exactly `seaLevel` of the map lies below `seaLevel`.
// This makes the Sea level setting mean what it says: 0.35 gives 35% water, whatever
// the seed. Heights keep their order and shape; only the scale is stretched.
export function toSeaLevel(raw: Float32Array, seaLevel: number): Float32Array {
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const shore = sorted[Math.min(sorted.length - 1, Math.floor(seaLevel * sorted.length))];
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    out[i] = v < shore ? (shore > lo ? ((v - lo) / (shore - lo)) * seaLevel : 0) : hi > shore ? seaLevel + ((v - shore) / (hi - shore)) * (1 - seaLevel) : seaLevel;
  }
  return out;
}

export function heightAt(m: HeightMap, x: number, y: number): number {
  const c = Math.min(m.cols - 1, Math.max(0, Math.floor(x / m.cell)));
  const r = Math.min(m.rows - 1, Math.max(0, Math.floor(y / m.cell)));
  return m.heights[r * m.cols + c];
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
