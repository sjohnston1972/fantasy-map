// Stage 6: symbol placement (spec step 6). Stamps symbols onto the map: mountains on high
// ground, clusters of trees in forests, reeds in marshes, dunes in deserts. Random size,
// variant and mirroring stop it looking repetitive. Until real ink symbols arrive
// (milestone 7), the renderer draws simple placeholder shapes for each role.
//
// Every symbol stands on its anchor: the middle of its base (spec: "Set the point where
// the symbol meets the ground"). No two symbols may overlap by more than 20% of the smaller
// one's area (spec acceptance criteria).

import { BIOME, type Climate } from "./climate";
import type { Hydrology } from "./hydrology";
import { rng, stageSeed } from "./rng";
import type { MapSettings } from "./settings";

export const ROLES = ["mountain", "hill", "conifer", "broadleaf", "reeds", "dune", "cactus", "grass", "snow", "field"] as const;
export type Role = (typeof ROLES)[number];

export interface PlacedSymbol {
  role: Role;
  x: number; // anchor, map pixels: middle of the base
  y: number;
  w: number;
  h: number;
  variant: number; // which drawing of this role, 0 to 1 (picked from the pack later)
  flip: boolean; // mirrored left to right
  key?: string; // set by editing ("sym:12"), so an item keeps its name when others move
}

export const MAX_OVERLAP = 0.2;

interface Rule {
  role: Role;
  spacing: number; // grid step in map pixels; smaller packs symbols closer
  size: [number, number]; // width range in map pixels at the default map size
  aspect: number; // height divided by width
  where: (i: number) => number; // chance (0 to 1) of a symbol on this cell
}

export function placeSymbols(hy: Hydrology, cl: Climate, s: MapSettings, blocked?: Uint8Array): PlacedSymbol[] {
  const { cols, rows } = hy;
  const cellW = s.width / cols;
  const cellH = s.height / rows;
  const scale = Math.min(s.width, s.height) / 1600; // symbols grow with the map
  const nearRiver = riverBuffer(hy, 1);
  const land = (i: number) => hy.water[i] === 0 && !nearRiver[i] && !(blocked && blocked[i]);
  const b = cl.biome;
  const e = cl.elevation;

  // Order matters: big features claim their ground first, small ones fill in around them.
  const rules: Rule[] = [
    { role: "mountain", spacing: 30, size: [58, 104], aspect: 0.72, where: (i) => (b[i] === BIOME.mountain ? 0.35 + e[i] * 0.6 : 0) },
    { role: "hill", spacing: 34, size: [32, 46], aspect: 0.5, where: (i) => (b[i] !== BIOME.mountain && e[i] > 0.3 ? 0.5 : 0) },
    { role: "conifer", spacing: 11, size: [11, 15], aspect: 1.6, where: (i) => (b[i] === BIOME.forest && (cl.temperature[i] < 0.45 || e[i] > 0.4) ? 0.85 : b[i] === BIOME.tundra ? 0.08 : 0) },
    { role: "broadleaf", spacing: 12, size: [13, 18], aspect: 1.05, where: (i) => (b[i] === BIOME.forest && !(cl.temperature[i] < 0.45 || e[i] > 0.4) ? 0.85 : 0) },
    { role: "reeds", spacing: 14, size: [10, 14], aspect: 0.8, where: (i) => (b[i] === BIOME.marsh ? 0.6 : 0) },
    { role: "dune", spacing: 34, size: [26, 40], aspect: 0.35, where: (i) => (b[i] === BIOME.desert ? 0.5 : 0) },
    { role: "cactus", spacing: 22, size: [6, 9], aspect: 1.6, where: (i) => (b[i] === BIOME.desert ? 0.12 : 0) },
    { role: "snow", spacing: 28, size: [12, 18], aspect: 0.4, where: (i) => (b[i] === BIOME.tundra ? 0.25 : 0) },
    { role: "field", spacing: 17, size: [14, 20], aspect: 0.55, where: (i) => (b[i] === BIOME.farmland ? 0.8 : 0) },
    { role: "grass", spacing: 26, size: [7, 10], aspect: 0.7, where: (i) => (b[i] === BIOME.grassland ? 0.12 : 0) },
  ];

  const placed: PlacedSymbol[] = [];
  const grid = new BoxGrid(s.width, s.height, 96 * scale);
  for (const rule of rules) {
    const next = rng(stageSeed(s.seed, `symbols:${rule.role}`));
    const step = rule.spacing * scale;
    for (let gy = step / 2; gy < s.height; gy += step) {
      for (let gx = step / 2; gx < s.width; gx += step) {
        // Jitter each grid point so symbols never line up in rows.
        const x = gx + (next() - 0.5) * step;
        const y = gy + (next() - 0.5) * step;
        const roll = next();
        const w = (rule.size[0] + next() * (rule.size[1] - rule.size[0])) * scale;
        const variant = next();
        const flip = next() < 0.5;
        const c = Math.floor(x / cellW);
        const r = Math.floor(y / cellH);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const i = r * cols + c;
        if (!land(i) || roll > rule.where(i)) continue;
        const h = w * rule.aspect;
        // The whole base must stand on dry land, clear of rivers.
        if (!footOnLand(x, y, w, cellW, cellH, cols, rows, land)) continue;
        const sym: PlacedSymbol = { role: rule.role, x, y, w, h, variant, flip };
        if (grid.overlapsTooMuch(sym)) continue;
        grid.add(sym);
        placed.push(sym);
      }
    }
  }
  // Draw from the back (top of the map) to the front, so nearer symbols overlap further ones.
  placed.sort((a, b2) => a.y - b2.y || a.x - b2.x);
  return placed;
}

function footOnLand(x: number, y: number, w: number, cellW: number, cellH: number, cols: number, rows: number, land: (i: number) => boolean): boolean {
  for (const fx of [x - w * 0.4, x, x + w * 0.4]) {
    const c = Math.floor(fx / cellW);
    const r = Math.floor((y - 1) / cellH);
    if (c < 0 || r < 0 || c >= cols || r >= rows || !land(r * cols + c)) return false;
  }
  return true;
}

// Cells on or right beside a river, where no symbol should stand.
function riverBuffer(hy: Hydrology, radius: number): Uint8Array {
  const out = new Uint8Array(hy.cols * hy.rows);
  for (const r of hy.rivers) {
    for (const i of r.cells) {
      const c = i % hy.cols;
      const rr = (i - c) / hy.cols;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cc = c + dx;
          const ry = rr + dy;
          if (cc >= 0 && ry >= 0 && cc < hy.cols && ry < hy.rows) out[ry * hy.cols + cc] = 1;
        }
      }
    }
  }
  return out;
}

// Overlap of two symbols as a share of the smaller one's box.
export function overlapShare(a: PlacedSymbol, b: PlacedSymbol): number {
  const ix = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
  const iy = Math.max(0, Math.min(a.y, b.y) - Math.max(a.y - a.h, b.y - b.h));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
}

// A spatial index: the map is cut into square buckets, and each symbol is listed in every
// bucket its box touches, so an overlap check only looks at nearby symbols.
class BoxGrid {
  private buckets = new Map<number, PlacedSymbol[]>();
  private cols: number;
  constructor(
    width: number,
    private height: number,
    private size: number,
  ) {
    this.cols = Math.ceil(width / size) + 1;
  }
  private keys(s: PlacedSymbol): number[] {
    const out: number[] = [];
    const c0 = Math.floor((s.x - s.w / 2) / this.size);
    const c1 = Math.floor((s.x + s.w / 2) / this.size);
    const r0 = Math.floor((s.y - s.h) / this.size);
    const r1 = Math.floor(s.y / this.size);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * this.cols + c);
    return out;
  }
  overlapsTooMuch(s: PlacedSymbol): boolean {
    for (const k of this.keys(s)) for (const o of this.buckets.get(k) ?? []) if (overlapShare(s, o) > MAX_OVERLAP) return true;
    return false;
  }
  add(s: PlacedSymbol) {
    for (const k of this.keys(s)) {
      const list = this.buckets.get(k);
      if (list) list.push(s);
      else this.buckets.set(k, [s]);
    }
  }
}
