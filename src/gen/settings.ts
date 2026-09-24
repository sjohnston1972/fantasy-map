// Map settings (spec "Data model: map settings"). Everything the generator needs is here,
// so a seed plus these values always rebuilds the same map. Milestone 10 packs this into
// the share code; `v` is the generator version so old links keep working.

// Generator versions. A share link records the version it was made with, and the
// generator keeps each version's behaviour, so an old link still draws the same map.
//   1: first release.
//   2: forests grow in stands of one kind of tree, drawn close and overlapping.
//   3: a title in a framed box and a compass rose.
//   4: a scale bar.
//   5: mountains massed into overlapping ranges, bigger where the ground is higher.
export const GENERATOR_VERSION = 5;

// How the map's frame is drawn. Only the drawing changes, not the map, so this is not part
// of the generator version.
export const BORDERS = ["classic", "chequered", "ornate", "plain"] as const;
export type Border = (typeof BORDERS)[number];

// How the sea is drawn along the coast: ripple lines following the shore, or a second fine
// shore line with stippled dots fading out to sea. Drawing only, like the border.
export const COASTS = ["ripples", "stipple"] as const;
export type Coast = (typeof COASTS)[number];

export interface MapSettings {
  v: number;
  scale: "region";
  seed: number;
  width: number; // map size in pixels
  height: number;
  sea_level: number; // 0 to 1: the share of the map that is water
  mountain_density: number; // 0 to 1: how much of the land is mountainous
  forest_density: number; // used from milestone 4
  town_count: number; // used from milestone 5
  border: Border; // frame style
  coast: Coast; // how the sea is drawn along the shore
}

export const DEFAULT_SETTINGS: MapSettings = {
  v: GENERATOR_VERSION,
  scale: "region",
  seed: 482913,
  width: 1600,
  height: 2263, // A-paper proportions (1 by 1.414), so maps print on A3 and A4 without margins
  sea_level: 0.35,
  mountain_density: 0.5,
  forest_density: 0.6,
  town_count: 5,
  border: "classic",
  coast: "ripples",
};

export const LIMITS = {
  width: [400, 4000],
  height: [400, 4000],
  sea_level: [0.05, 0.9],
  mountain_density: [0, 1],
  seed: [0, 999_999_999],
} as const;

// Keep settings inside safe bounds, whatever arrives (a form, a link, an old share code).
export function cleanSettings(s: Partial<MapSettings>): MapSettings {
  const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };
  const d = DEFAULT_SETTINGS;
  return {
    ...d,
    v: Math.round(clamp(s.v, [1, GENERATOR_VERSION], GENERATOR_VERSION)),
    seed: Math.round(clamp(s.seed, LIMITS.seed, d.seed)),
    width: Math.round(clamp(s.width, LIMITS.width, d.width)),
    height: Math.round(clamp(s.height, LIMITS.height, d.height)),
    sea_level: clamp(s.sea_level, LIMITS.sea_level, d.sea_level),
    mountain_density: clamp(s.mountain_density, LIMITS.mountain_density, d.mountain_density),
    forest_density: clamp(s.forest_density, [0, 1], d.forest_density),
    town_count: Math.round(clamp(s.town_count, [0, 30], d.town_count)),
    border: BORDERS.includes(s.border as Border) ? (s.border as Border) : d.border,
    coast: COASTS.includes(s.coast as Coast) ? (s.coast as Coast) : d.coast,
  };
}
