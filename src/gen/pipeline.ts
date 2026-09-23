// The generator pipeline (spec "How the generator works"). Each stage reads only what
// earlier stages produced. Later milestones add rivers, towns, symbols and labels here.

import { climate, type Climate } from "./climate";
import { generateHeightMap, type HeightMap } from "./heightmap";
import { hydrology, type Hydrology } from "./hydrology";
import { landAndSea, type LandSea } from "./landsea";
import { cleanSettings, type MapSettings } from "./settings";
import { placeSymbols, type PlacedSymbol } from "./symbols";

export interface GeneratedMap {
  settings: MapSettings;
  height: HeightMap;
  landSea: LandSea;
  water: Hydrology;
  climate: Climate;
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
  const symbols = time("symbols", () => placeSymbols(water, clim, settings));
  return { settings, height, landSea, water, climate: clim, symbols, timings };
}
