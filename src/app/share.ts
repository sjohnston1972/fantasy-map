// Share codes (spec: "The settings are compressed into a short code in the URL. Opening the
// URL rebuilds the identical map, so no maps are stored on the server."). Like a short
// config string, each setting is one field, separated by dots:
//
//   1.acm9.p.35.50.60.5
//   | |    | |  |  |  number of towns
//   | |    | |  |  forest density, per cent
//   | |    | |  mountain density, per cent
//   | |    | sea level, per cent
//   | |    shape: p (A portrait), l (A landscape), or a size such as 2000x1400
//   | seed, in base 36 to keep it short
//   generator version (the settings' v field)
//
// The sliders work in whole per cents, so the per cent values round-trip exactly and the
// map rebuilt from a code is the same map.

import { cleanSettings, type MapSettings } from "../gen/settings";

const SHAPES: Record<string, [number, number]> = { p: [1600, 2263], l: [2263, 1600] };
const pct = (x: number) => Math.round(x * 100);

export function encodeSettings(s: MapSettings): string {
  const shape = Object.keys(SHAPES).find((k) => SHAPES[k][0] === s.width && SHAPES[k][1] === s.height) ?? `${s.width}x${s.height}`;
  return [s.v, s.seed.toString(36), shape, pct(s.sea_level), pct(s.mountain_density), pct(s.forest_density), s.town_count].join(".");
}

// Read a share code back into settings. Returns null for anything that is not a code; the
// values are checked and kept in bounds like any other settings.
export function decodeSettings(code: string): { settings: MapSettings; version: number } | null {
  const parts = code.trim().split(".");
  if (parts.length < 7 || !parts.every((p) => /^[0-9a-z]+$/i.test(p))) return null;
  const [v, seed, shape, sea, mountains, forest, towns] = parts;
  const version = Number(v);
  const size = SHAPES[shape] ?? shape.match(/^(\d+)x(\d+)$/)?.slice(1).map(Number);
  const seedNum = parseInt(seed, 36);
  if (!Number.isInteger(version) || !size || !Number.isFinite(seedNum)) return null;
  const settings = cleanSettings({
    seed: seedNum,
    width: size[0],
    height: size[1],
    sea_level: Number(sea) / 100,
    mountain_density: Number(mountains) / 100,
    forest_density: Number(forest) / 100,
    town_count: Number(towns),
  });
  return { settings, version };
}

// A short fingerprint of a drawn map, shown under it, so two people can check at a glance
// that a shared link gave them the same map (FNV-1a hash of the SVG, as 6 characters).
export function fingerprint(svg: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < svg.length; i++) {
    h ^= svg.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, "0").slice(-6);
}
