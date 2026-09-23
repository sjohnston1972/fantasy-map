// Stage 3 (first part): land and sea (spec step 3). Anything below sea level is water.
// Biomes (forest, grassland, marsh) are added to this stage in a later milestone.

import type { HeightMap } from "./heightmap";

export interface LandSea {
  cols: number;
  rows: number;
  land: Uint8Array; // 1 land, 0 water, one value per height-map cell
  coast: Uint8Array; // 1 where a land cell touches water (the coastline)
  landShare: number; // fraction of cells that are land
}

export function landAndSea(m: HeightMap): LandSea {
  const { cols, rows, heights, seaLevel } = m;
  const land = new Uint8Array(cols * rows);
  let count = 0;
  for (let i = 0; i < land.length; i++) {
    if (heights[i] >= seaLevel) {
      land[i] = 1;
      count++;
    }
  }
  const coast = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!land[i]) continue;
      if ((c > 0 && !land[i - 1]) || (c < cols - 1 && !land[i + 1]) || (r > 0 && !land[i - cols]) || (r < rows - 1 && !land[i + cols])) {
        coast[i] = 1;
      }
    }
  }
  return { cols, rows, land, coast, landShare: count / land.length };
}
