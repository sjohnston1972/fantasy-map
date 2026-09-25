// Sea life (generator version 6): ships under sail in open water, a sea creature or two far
// out, lighthouses on headlands and rocks and reefs just offshore, drawn with the matching
// kinds from the symbol library. How many is the Ships and sea life setting (0 to 1).
// From version 7 a lighthouse clears the trees or hills from its headland (they are removed
// from the symbols passed in), since the coast is so often covered by them.

import type { Hydrology } from "./hydrology";
import { WATER_SEA } from "./hydrology";
import { rng, stageSeed } from "./rng";
import type { MapSettings } from "./settings";
import type { Settlements } from "./settlements";
import { overlapShare, type PlacedSymbol } from "./symbols";

// The library kinds used (see scripts/import-sheets.ts: kinds are named from sheet titles).
export const SEA_ROLES = ["rocks-and-reefs", "lighthouses-and-beacons", "ships-and-boats", "sea-creatures"] as const;
export type SeaRole = (typeof SEA_ROLES)[number];

interface Kind {
  role: SeaRole;
  most: number; // how many at full sea life
  width: number; // on a 1600-pixel map
  aspect: number;
  spacing: number; // at least this far from another of the same kind (map pixels at 1600)
  clears?: boolean; // clears the land's symbols from its spot rather than giving way to them
  where: (i: number) => boolean;
}

export function placeSea(hy: Hydrology, towns: Settlements, symbols: PlacedSymbol[], s: MapSettings): PlacedSymbol[] {
  if (s.v < 6 || s.sea_life <= 0) return [];
  const { cols, rows } = hy;
  const cellW = s.width / cols;
  const cellH = s.height / rows;
  const px = Math.min(s.width, s.height) / 1600;
  const next = rng(stageSeed(s.seed, "sea"));
  const seaDist = distanceToLand(hy);
  const isSea = (i: number) => hy.water[i] === WATER_SEA;
  const edgeCells = Math.ceil((60 * px) / cellW); // keep clear of the frame
  const inside = (i: number) => {
    const c = i % cols;
    const r = (i - c) / cols;
    return c >= edgeCells && r >= edgeCells && c < cols - edgeCells && r < rows - edgeCells;
  };
  // A headland: a land cell on the shore that juts out to sea. Version 6 asked for sea on five
  // of the eight cells around it, which the coast's grid of cells hardly ever gives; from
  // version 7 it is a shore cell with sea on enough of the 24 cells within two steps.
  const headland = (i: number) => {
    if (hy.water[i] !== 0) return false;
    const c = i % cols;
    const r = (i - c) / cols;
    const reach = s.v >= 7 ? 2 : 1;
    let sea = 0;
    let shore = false;
    for (let dr = -reach; dr <= reach; dr++)
      for (let dc = -reach; dc <= reach; dc++) {
        if (!(dr || dc) || hy.water[(r + dr) * cols + c + dc] !== WATER_SEA) continue;
        sea++;
        if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1) shore = true;
      }
    return s.v >= 7 ? shore && sea >= 11 : sea >= 5;
  };

  const kinds: Kind[] = [
    { role: "rocks-and-reefs", most: 12, width: 18, aspect: 0.7, spacing: 80, where: (i) => isSea(i) && seaDist[i] >= 1 && seaDist[i] <= 3 },
    { role: "lighthouses-and-beacons", most: 3, width: 24, aspect: 1.4, spacing: 260, where: headland, clears: s.v >= 7 },
    { role: "ships-and-boats", most: 6, width: 46, aspect: 0.9, spacing: 200, where: (i) => isSea(i) && seaDist[i] >= 8 },
    { role: "sea-creatures", most: 3, width: 72, aspect: 0.7, spacing: 320, where: (i) => isSea(i) && seaDist[i] >= 14 },
  ];

  // Settlements and what is already placed are kept clear.
  const settled: PlacedSymbol[] = towns.places.map((p) => ({ role: "hill", x: p.x, y: p.y + 20 * px, w: 60 * px, h: 60 * px, variant: 0, flip: false }));
  const taken: PlacedSymbol[] = [...symbols, ...settled];

  const out: PlacedSymbol[] = [];
  for (const kind of kinds) {
    const want = Math.round(kind.most * s.sea_life);
    if (!want) continue;
    const mine: PlacedSymbol[] = [];
    // Try random cells until enough fit (or the tries run out).
    for (let tries = 0; tries < 4000 && mine.length < want; tries++) {
      const i = Math.floor(next() * cols * rows);
      const t = next();
      const variant = next();
      const flip = next() < 0.5;
      if (!inside(i) || !kind.where(i)) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      const w = kind.width * px * (0.85 + 0.3 * t);
      const sym: PlacedSymbol = { role: kind.role, x: (c + 0.5) * cellW, y: (r + 0.5) * cellH + (w * kind.aspect) / 2, w, h: w * kind.aspect, variant, flip };
      const gap = kind.spacing * px;
      if (mine.some((o) => Math.hypot(o.x - sym.x, o.y - sym.y) < gap)) continue;
      if (kind.clears) {
        // Only settlements and the sea's own items stand in its way; land symbols make room.
        if ([...settled, ...out, ...mine].some((o) => overlapShare(sym, o) > 0)) continue;
        for (let k = symbols.length - 1; k >= 0; k--) if (overlapShare(sym, symbols[k]) > 0) taken.splice(taken.indexOf(symbols[k]), 1), symbols.splice(k, 1);
      } else if (taken.some((o) => overlapShare(sym, o) > 0)) continue;
      mine.push(sym);
      taken.push(sym);
    }
    out.push(...mine);
  }
  return out;
}

// Distance in cells from the nearest land (breadth-first); land cells are 0.
function distanceToLand(hy: Hydrology): Float32Array {
  const { cols, rows } = hy;
  const dist = new Float32Array(cols * rows).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < cols * rows; i++) if (hy.water[i] !== WATER_SEA) (dist[i] = 0), queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const j = rr * cols + cc;
      if (dist[j] > dist[i] + 1) (dist[j] = dist[i] + 1), queue.push(j);
    }
  }
  return dist;
}
