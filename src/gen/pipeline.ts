// The generator pipeline (spec "How the generator works"). Each stage reads only what
// earlier stages produced. Later milestones add rivers, towns, symbols and labels here.

import { generateHeightMap, type HeightMap } from "./heightmap";
import { hydrology, type Hydrology } from "./hydrology";
import { landAndSea, type LandSea } from "./landsea";
import { cleanSettings, type MapSettings } from "./settings";

export interface GeneratedMap {
  settings: MapSettings;
  height: HeightMap;
  landSea: LandSea;
  water: Hydrology;
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
  return { settings, height, landSea, water, timings };
}
