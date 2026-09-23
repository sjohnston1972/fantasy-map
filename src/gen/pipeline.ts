// The generator pipeline (spec "How the generator works"). Each stage reads only what
// earlier stages produced. Later milestones add rivers, towns, symbols and labels here.

import { climate, type Climate } from "./climate";
import { generateHeightMap, type HeightMap } from "./heightmap";
import { hydrology, type Hydrology } from "./hydrology";
import { landAndSea, type LandSea } from "./landsea";
import { settle, type Settlements } from "./settlements";
import { cleanSettings, type MapSettings } from "./settings";
import { placeSymbols, type PlacedSymbol } from "./symbols";

export interface GeneratedMap {
  settings: MapSettings;
  height: HeightMap;
  landSea: LandSea;
  water: Hydrology;
  climate: Climate;
  towns: Settlements;
  symbols: PlacedSymbol[];
  timings: Record<string, number>; // milliseconds per stage
}

export function generate(input: Partial<MapSettings>): GeneratedMap {
  const settings = cleanSettings(input);
  const timings: Record<string, number> = {};
  const time = <T>(name: string, fn: () => T): T => {
    const t0 = performance.now();
    const v = fn();
    timings[name] = performance.now() - t0;
    return v;
  };
  const height = time("height map", () => generateHeightMap(settings));
  const landSea = time("land and sea", () => landAndSea(height));
  const water = time("rivers and lakes", () => hydrology(height, landSea));
  const clim = time("climate and biomes", () => climate(water, height.seaLevel, settings));
  const towns = time("towns and roads", () => settle(water, clim, settings));
  const symbols = time("symbols", () => placeSymbols(water, clim, settings, keepClear(towns, water.cols, water.rows)));
  return { settings, height, landSea, water, climate: clim, towns, symbols, timings };
}

// Ground no symbol should stand on: roads (and the cells beside them) and the settlements.
function keepClear(t: Settlements, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const mark = (i: number, radius: number) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const cc = c + dc;
        const rr = r + dr;
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) out[rr * cols + cc] = 1;
      }
    }
  };
  for (const road of t.roads) for (const i of road.cells) mark(i, 1);
  for (const p of t.places) mark(p.cell, p.tier === "capital" ? 9 : p.tier === "town" ? 7 : 5);
  for (const l of t.landmarks) mark(l.cell, 4);
  return out;
}
