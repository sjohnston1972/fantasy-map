// Stage 3 (second part): climate and biomes (spec step 3: "Elevation and moisture decide
// forest, grassland, marsh or mountain"). Desert and tundra were added on request; farmland
// is laid around towns by the settlement stage.
//
// Temperature: each map gets its own base climate from the seed (some regions are cold,
// some warm), cooler towards the top of the map (north) and with height.
// Moisture: a noise field, raised near rivers, lakes and the sea.

import type { Hydrology } from "./hydrology";
import { fbm, simplex } from "./noise";
import { rng, stageSeed } from "./rng";
import type { MapSettings } from "./settings";

export const BIOMES = ["water", "grassland", "forest", "marsh", "mountain", "desert", "tundra", "farmland"] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME = Object.fromEntries(BIOMES.map((b, i) => [b, i])) as Record<Biome, number>;

export interface Climate {
  cols: number;
  rows: number;
  temperature: Float32Array; // 0 cold to 1 hot
  moisture: Float32Array; // 0 dry to 1 wet
  biome: Uint8Array; // index into BIOMES
  elevation: Float32Array; // 0 at the shore to 1 at the highest peak (land only)
  baseTemperature: number; // this map's overall climate
  hillAt: number; // elevation above which ground that is not mountain has hills
}

// The share of the land that is mountain at the top of the Mountains setting (version 8).
export const MAX_MOUNTAIN_SHARE = 0.3;
// The share of the land with hills, just below the mountains (version 8).
export const HILL_SHARE = 0.15;

// The elevation above which lies `share` of the land (Infinity for none).
function highestShare(elevation: Float32Array, water: Uint8Array, share: number): number {
  if (share <= 0) return Infinity;
  const land: number[] = [];
  for (let i = 0; i < elevation.length; i++) if (!water[i]) land.push(elevation[i]);
  if (!land.length) return Infinity;
  land.sort((a, b) => b - a);
  return land[Math.min(land.length - 1, Math.floor(share * land.length))];
}

export function climate(hy: Hydrology, seaLevel: number, s: MapSettings): Climate {
  const { cols, rows, heights, water } = hy;
  const n = cols * rows;
  const unit = Math.min(s.width, s.height);
  const tempNoise = simplex(stageSeed(s.seed, "climate:temperature"));
  const wetNoise = simplex(stageSeed(s.seed, "climate:moisture"));
  // Most regions are temperate; a few lean cold or hot.
  const r = rng(stageSeed(s.seed, "climate:base"))();
  const baseTemperature = 0.5 + (r - 0.5) * 0.7;

  // Land elevation, 0 at the shore and 1 at the highest point on this map.
  let top = seaLevel;
  for (let i = 0; i < n; i++) if (!water[i]) top = Math.max(top, heights[i]);
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) elevation[i] = water[i] ? 0 : Math.max(0, (heights[i] - seaLevel) / (top - seaLevel || 1));

  // Which ground is mountainous. Up to version 7, land above half the highest peak; but the
  // Mountains setting also raises the peaks, which lowers everything else against them, so
  // the setting worked against itself. From version 8 the setting is the share of the land
  // that is mountain (none at 0, up to 30% at 1): the highest ground,
  // as Sea level is the share of the map under water.
  const mountainAt = s.v >= 8 ? highestShare(elevation, water, MAX_MOUNTAIN_SHARE * s.mountain_density) : 0.5;
  // Hills: up to version 7, land above 0.3; with no mountains that left most high ground a
  // sea of hills. From version 8, a band of the next HILL_SHARE of the land below the mountains.
  const hillAt = s.v >= 8 ? highestShare(elevation, water, MAX_MOUNTAIN_SHARE * s.mountain_density + HILL_SHARE) : 0.3;

  const wetness = distanceToWater(hy);
  const temperature = new Float32Array(n);
  const moisture = new Float32Array(n);
  const biome = new Uint8Array(n);
  // Forest density moves the moisture a cell needs before it grows trees.
  const forestAt = 0.62 - s.forest_density * 0.35;
  for (let rr = 0; rr < rows; rr++) {
    for (let c = 0; c < cols; c++) {
      const i = rr * cols + c;
      const x = ((c + 0.5) * (s.width / cols)) / unit;
      const y = ((rr + 0.5) * (s.height / rows)) / unit;
      const north = rr / rows; // 0 at the top edge
      const t = baseTemperature + (north - 0.5) * 0.35 - elevation[i] * 0.45 + 0.12 * fbm(tempNoise, x * 1.5, y * 1.5, 3);
      const m = 0.5 + 0.45 * fbm(wetNoise, x * 2, y * 2, 4) + 0.35 * wetness[i] - 0.15;
      temperature[i] = clamp01(t);
      moisture[i] = clamp01(m);
      if (water[i]) {
        biome[i] = BIOME.water;
        continue;
      }
      const e = elevation[i];
      const tt = temperature[i];
      const mm = moisture[i];
      if (e > mountainAt) biome[i] = BIOME.mountain;
      else if (tt < 0.22) biome[i] = BIOME.tundra;
      else if (tt > 0.66 && mm < 0.42) biome[i] = BIOME.desert;
      else if (e < 0.08 && wetness[i] > 0.7 && mm > 0.6) biome[i] = BIOME.marsh;
      else if (mm > forestAt) biome[i] = BIOME.forest;
      else biome[i] = BIOME.grassland;
    }
  }
  return { cols, rows, temperature, moisture, biome, elevation, baseTemperature, hillAt };
}

// How close each land cell is to fresh or salt water: 1 at the water's edge, fading to 0
// about 12 cells away. Rivers count, which is what makes river valleys green.
function distanceToWater(hy: Hydrology): Float32Array {
  const { cols, rows, water } = hy;
  const n = cols * rows;
  const REACH = 12;
  const dist = new Float32Array(n).fill(REACH);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (water[i]) (dist[i] = 0), queue.push(i);
  for (const r of hy.rivers) for (const i of r.cells) if (dist[i] > 0) (dist[i] = 0), queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const c = i % cols;
    const r = (i - c) / cols;
    const d = dist[i] + 1;
    if (d >= REACH) continue;
    for (const j of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1]) {
      if (j >= 0 && dist[j] > d) {
        dist[j] = d;
        queue.push(j);
      }
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 1 - dist[i] / REACH;
  return out;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
